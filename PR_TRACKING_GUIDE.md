# FitTrack Pro — PR (Personal Record) Tracking Implementation Guide

## Overview

This guide documents the automatic PR tracking system implemented for FitTrack Pro using the **Epley formula** to calculate estimated 1RM (one-rep maximum) from any set.

Records are **per account**: every user is measured against their own previous performance, never against another user's lifts.

## The Epley Formula

$$1\text{RM} = w \times \left( 1 + \frac{r}{30} \right) \quad (r \ge 2), \qquad 1\text{RM} = w \quad (r = 1)$$

Where:

- **w** = weight lifted (kg)
- **r** = number of reps completed
- **1RM** = estimated one-rep maximum

### Examples:

- 5 reps @ 100 kg → 1RM = 100 × (1 + 5/30) = **116.7 kg**
- 10 reps @ 80 kg → 1RM = 80 × (1 + 10/30) = **86.7 kg**
- 1 rep @ 120 kg → 1RM = **120 kg** (a single is its own weight — the raw formula would add 3.3%)

The same formula is shared by the PR tracking (`server/db.js`), the strength
assessment, the live PR indicator (`public/js/core/one-rm.js`, tied to the server by a
test) and the Recovery Engine (`server/recovery.js` → `estimate1RM`, which adds the
RIR estimated from RPE).

## Implementation Details

### Database Changes

#### Table: `exercise_maxes`

```sql
CREATE TABLE exercise_maxes (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_name TEXT NOT NULL,       -- The exercise name
  max_1rm       REAL NOT NULL,       -- Maximum estimated 1RM (kg)
  date          TEXT NOT NULL,       -- Date of the workout that set this record
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  source        TEXT NOT NULL DEFAULT 'measured',  -- 'measured' or 'declared'
  PRIMARY KEY (user_id, exercise_name)
);
```

This table stores each user's highest estimated 1RM per exercise. (`source` is added by a migration via `ensureColumn`, which is why it comes last.)

- **`source = 'measured'`** — calculated from a logged set.
- **`source = 'declared'`** — entered on the strength assessment (`POST /api/strength-assessment`, `setDeclaredMax`). A declared value never overwrites a measured one, and it does not create a PR entry; it only sets the baseline a later lift has to beat. A logged set always overwrites a declared baseline.

#### Column: `workouts.pr_rule`

Tells which rule picked the record-setting set when the workout was saved:

- `1` — only completed (checked) sets count. Every new or edited workout is saved with this rule.
- `0` — legacy workouts from before sets had checkmarks: if no set is checked, the first set counts, so old records are not lost.

### Backend Functions (server/db.js)

#### 1. Calculate Epley 1RM

```javascript
export function calculateEpley1RM(weight, reps) {
  // Returns 0 for non-numeric input, weight ≤ 0 or reps < 1;
  // delegates to the shared estimate1RM (a single rep is the weight itself)
  return estimate1RM(Number(weight), Number(reps)) ?? 0;
}
```

#### 2. Pick the record-setting set

```javascript
export function bestCompletedSet(sets, { fallbackToFirst = false } = {}) {
  // Returns the completed set (set.done) with the highest Epley 1RM,
  // or null — or the first set when fallbackToFirst is true (pr_rule = 0)
}
```

This is the **single place** the rule lives: saving a workout, rebuilding records and the PR list endpoints all use it.

#### 3. Get Exercise Maximum

```javascript
export function getExerciseMax(userId, exerciseName) {
  // Returns: { max1rm: number, date: string, source: string } or null
}
```

#### 4. Update Exercise Maximum

```javascript
export function updateExerciseMax(userId, exerciseName, new1rm, currentDate) {
  // Compares new1rm with the user's stored max
  // Updates (as source = 'measured') if there is no record or new > old
  // Returns: { max1rm: number, date: string, isPr: boolean }
}
```

#### 5. Rebuild all records

```javascript
export function recomputeExerciseMaxes(userId) {
  // Replays the user's whole workout log (ordered by date, id), rebuilds
  // exercise_maxes AND rewrites the `pr` flags stored in the workouts
}
```

`updateExerciseMax` only ever moves a record **up**. Once a workout is edited or deleted, the record could be stuck on a performance that no longer exists, blocking future real PRs — so both operations rebuild everything, inside the same transaction as the change.

### Automatic PR Detection

When a workout is saved via `POST /api/workouts`:

1. **Pick the record-setting set:**
   - `bestCompletedSet()`: only completed sets (`set.done === true`)
   - The one with the highest Epley 1RM wins

2. **Compare with the user's stored maximum:**
   - Queries `exercise_maxes` for this user and exercise
   - If no record exists: this becomes the first PR
   - If new 1RM > stored max: mark as PR and update the max

3. **Mark exercise as PR:**
   - Sets `exercise.pr = true` in the workout data (a PR flag the client already set while editing is kept)
   - Saves the workout with `pr_rule = 1`

**Duration-based exercises** (`logMode: 'duration'`, e.g. running — see `server/logmode.js`) never get a PR: `normalizeExercises()` forces `pr = false` even if the client sends `true`, and no maximum is recorded, because there is no weight × reps to compare.

When a workout is edited (`PUT /api/workouts/:id`) or deleted (`DELETE /api/workouts/:id`), `recomputeExerciseMaxes()` rebuilds the records and `pr` flags from the log. An edit keeps the workout on its original date.

### API Endpoints

#### GET /api/prs

The PR list is built from the `pr` flags stored in the workouts (not from `exercise_maxes`). For **each exercise**, it returns the most recently saved PR-marked entry — there is no count limit:

```json
{
  "exercise": "Squat",
  "detail": "5 ism. @ 100 kg",
  "oneRM": 116.7,
  "maxOneRM": 150.0,
  "date": "2026.08.13"
}
```

- **exercise**: Exercise name
- **detail**: Reps and weight of the record-setting set (the frontend appends the 1RM)
- **oneRM**: Calculated 1RM for this set, rounded to 1 decimal (`null` if it cannot be calculated)
- **maxOneRM**: The user's all-time maximum 1RM for this exercise, rounded to 1 decimal
- **date**: When this workout was logged

#### GET /api/prs/history?exercise=<name>

All PR-marked entries of one exercise, **newest first**, in the same shape as above. A missing or repeated `exercise` parameter returns `400`; an unknown exercise returns an empty list.

#### GET /api/exercise-maxes

The user's tracked maximums as an `{ exerciseName: max1rm }` map. The workout editor uses it to show the PR badge live while sets are being entered.

## Frontend Implementation

### PR List Display

The `renderPrs()` function in `public/js/render/prs.js`:

- Fetches PR data from `/api/prs`
- Displays exercise name
- Shows set details, appending ` • 1RM: … kg` when `oneRM` is available
- Shows workout date

Clicking a row opens the PR history modal (`setupPrModal`, `public/js/ui/modals.js`), which lists `/api/prs/history` for that exercise.

### Visual Indicators

- PR badge shows when an exercise is marked as PR
- 1RM values are displayed to 1 decimal place for precision
- List updates automatically after logging a workout

## Workflow

### User Perspective

1. **Log a workout:**
   - Enter exercise name, sets (reps × weight), and check the completed sets
   - System automatically calculates 1RM during save

2. **System processes:**
   - Calculates: 1RM = weight × (1 + reps/30), or the weight itself for a single
   - Compares with your previous max
   - **Automatically marks as PR if new record achieved**

3. **View progress:**
   - PR list shows your latest record per exercise with 1RM values
   - Tap an exercise to see its record history
   - No manual PR marking needed!

### Key Advantages

✅ **Automatic detection** — No manual PR marking required
✅ **Accurate estimation** — Epley formula works for any rep range
✅ **Per-account records** — Everyone is compared to their own history
✅ **Self-correcting** — Editing or deleting a workout rebuilds the records
✅ **Seamless integration** — Works with existing workout system

## Data Flow

```
Workout Save (POST /api/workouts)
    ↓
normalizeExercises() validates input
    ↓
addWorkout(userId, …) processes each exercise
    ├─→ bestCompletedSet(): best completed set by Epley 1RM
    └─→ updateExerciseMax(userId, …) compares & stores
        ├─→ If no record or new 1RM > max: isPr = true
        └─→ Update exercise_maxes row (source = 'measured')
    ↓
Marked exercise returned with pr = true
    ↓
Database persists workout with PR flag (pr_rule = 1)
    ↓
Frontend renders PR list with 1RM values

Workout Edit / Delete (PUT or DELETE /api/workouts/:id)
    ↓
Change + recomputeExerciseMaxes(userId) in one transaction
    ↓
exercise_maxes and the workouts' pr flags rebuilt from the log
```

## Technical Notes

### Error Handling

- Invalid weight/reps values (non-numeric, weight ≤ 0, reps < 1) give a 1RM of 0 and never set a record
- Unchecked sets are ignored on new workouts — a pre-filled but not performed set is not a record
- Duration-based exercises never set a record
- Empty exercise lists rejected at API validation level

### Precision

- 1RM values stored as REAL (float) in database
- API responses are rounded to 1 decimal place
- Stored with full precision for future calculations

### Database Consistency

- `exercise_maxes` uses `(user_id, exercise_name)` as primary key
- One record per exercise per user; deleting the account deletes the records
- `date` is the date of the workout that set the record (also after a rebuild — never the rebuild day)
- `updated_at` tracks when the record was actually written

## Testing the Implementation

Automated tests (`npm test`): `server/prs.test.js` covers the data layer — per-account separation, the best completed set, and rebuilding after edit/delete; `server/api.test.js` covers the `/api/prs` endpoints, the strength assessment and duration-based exercises.

### Test Scenario 1: First-Time PR

1. Create new exercise "Bench Press"
2. Log workout: 5 reps @ 100 kg, set checked as completed
3. Expected: Marked as PR, 1RM calculated as 116.7 kg

### Test Scenario 2: Beat Previous PR

1. Previous max for "Squat": 150 kg (1RM)
2. New workout: 8 reps @ 130 kg → 1RM = 130 × (1 + 8/30) = 164.7 kg
3. Expected: Marked as PR, updated maximum shown

### Test Scenario 3: Miss Previous PR

1. Previous max for "Deadlift": 200 kg (1RM)
2. New workout: 3 reps @ 180 kg → 1RM = 180 × (1 + 3/30) = 198 kg
3. Expected: Not marked as PR, max stays 200 kg

### Test Scenario 4: Delete the Record Workout

1. "Squat" record of 164.7 kg comes from the workout in Scenario 2
2. Delete that workout
3. Expected: The max falls back to the next best logged workout, and that workout's entry appears in the PR list

## SQL Queries for Inspection

```sql
-- View all recorded exercise maxes of one user
SELECT exercise_name, max_1rm, date, source
FROM exercise_maxes
WHERE user_id = 1
ORDER BY date DESC;

-- View single exercise max of one user
SELECT * FROM exercise_maxes
WHERE user_id = 1 AND exercise_name = 'Squat';

-- View all workouts of one user with their exercises
SELECT id, name, date, exercises, pr_rule
FROM workouts
WHERE user_id = 1
ORDER BY id DESC;
```

## Future Enhancements

- [ ] Graph showing 1RM progression over time
- [ ] Compare estimated 1RM with actual 1RM attempts
- [ ] Wilks coefficient or other strength standards
- [ ] Different formulas (Brzycki, Adams, etc.) selection
- [ ] Body weight normalization
- [ ] Exercise-specific max tracking by body weight class

## References

The Epley formula for estimating 1RM is a widely-used formula in strength training:

- Created by fitness researcher Boyd Epley
- Works well for reps 1-10
- More accurate than Brzycki for higher reps (8-15)
- Industry standard for gym software and apps
