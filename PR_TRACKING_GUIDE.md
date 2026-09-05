# FitTrack Pro — PR (Personal Record) Tracking Implementation Guide

## Overview
This guide documents the automatic PR tracking system implemented for FitTrack Pro using the **Epley formula** to calculate estimated 1RM (one-rep maximum) from any set.

## The Epley Formula
$$1\text{RM} = w \times \left( 1 + \frac{r}{30} \right)$$

Where:
- **w** = weight lifted (kg)
- **r** = number of reps completed
- **1RM** = estimated one-rep maximum

### Examples:
- 5 reps @ 100 kg → 1RM = 100 × (1 + 5/30) = **116.7 kg**
- 10 reps @ 80 kg → 1RM = 80 × (1 + 10/30) = **86.7 kg**
- 1 rep @ 120 kg → 1RM = 120 × (1 + 1/30) = **124 kg**

## Implementation Details

### Database Changes

#### New Table: `exercise_maxes`
```sql
CREATE TABLE exercise_maxes (
  exercise_name TEXT PRIMARY KEY,    -- The exercise name
  max_1rm       REAL NOT NULL,        -- Maximum estimated 1RM (kg)
  date          TEXT NOT NULL,        -- When this record was achieved
  updated_at    TEXT NOT NULL         -- Last update timestamp
);
```

This table stores the highest estimated 1RM for each exercise, tracking personal records across all workouts.

### Backend Functions (server/db.js)

#### 1. Calculate Epley 1RM
```javascript
export function calculateEpley1RM(weight, reps) {
  return weight * (1 + reps / 30);
}
```

#### 2. Get Exercise Maximum
```javascript
export function getExerciseMax(exerciseName) {
  // Returns: { max1rm: number, date: string } or null
}
```

#### 3. Update Exercise Maximum
```javascript
export function updateExerciseMax(exerciseName, new1rm, currentDate) {
  // Compares new1rm with stored max
  // Updates if new > old
  // Returns: { max1rm: number, date: string, isPr: boolean }
}
```

### Automatic PR Detection

When a workout is saved via `/api/workouts` POST:

1. **Calculate 1RM for each set:**
   - Uses Epley formula: `weight × (1 + reps/30)`
   - Only considers completed sets (`set.done === true`)
   - Finds the set with the highest 1RM

2. **Compare with stored maximum:**
   - Queries `exercise_maxes` table for the exercise
   - If no record exists: This becomes the first PR
   - If new 1RM > stored max: Mark as PR and update the max

3. **Mark exercise as PR:**
   - Sets `exercise.pr = true` in the workout data
   - Updates `exercise_maxes` table with new maximum
   - Displays immediately in the PR list

### API Endpoint: GET /api/prs

Returns the 6 most recent PR-marked exercises with:

```json
{
  "exercise": "Squat",
  "detail": "5 ism. @ 100 kg • 1RM: 116.7 kg",
  "oneRM": 116.7,
  "maxOneRM": 150.0,
  "date": "2026.08.13"
}
```

- **exercise**: Exercise name
- **detail**: Reps, weight, and calculated 1RM
- **oneRM**: Calculated 1RM for this specific set
- **maxOneRM**: All-time maximum 1RM for this exercise
- **date**: When this workout was logged

## Frontend Implementation

### PR List Display
The `renderPrs()` function in `public/js/render/prs.js`:
- Fetches PR data from `/api/prs`
- Displays exercise name
- Shows set details with calculated 1RM value
- Shows workout date

### Visual Indicators
- PR flag button shows when an exercise is marked as PR
- 1RM values are displayed to 1 decimal place for precision
- List updates automatically after logging a workout

## Workflow

### User Perspective
1. **Log a workout:**
   - Enter exercise name, sets (reps × weight)
   - System automatically calculates 1RM during save

2. **System processes:**
   - Calculates: 1RM = weight × (1 + reps/30)
   - Compares with previous max
   - **Automatically marks as PR if new record achieved**

3. **View progress:**
   - PR list shows all personal records with 1RM values
   - See progression in estimated strength
   - No manual PR marking needed!

### Key Advantages
✅ **Automatic detection** — No manual PR marking required
✅ **Accurate estimation** — Epley formula works for any rep range
✅ **Complete history** — All records stored in database
✅ **Visual progress** — See 1RM progression over time
✅ **Seamless integration** — Works with existing workout system

## Data Flow

```
Workout Save (POST /api/workouts)
    ↓
normalizeExercises() validates input
    ↓
addWorkout() processes each exercise
    ├─→ For each set: calculateEpley1RM()
    ├─→ Find best completed set's 1RM
    └─→ updateExerciseMax() compares & stores
        ├─→ If new 1RM > max: isPr = true
        └─→ Update exercise_maxes table
    ↓
Marked exercise returned with pr = true
    ↓
Database persists workout with PR flag
    ↓
Frontend renders PR list with 1RM values
```

## Technical Notes

### Error Handling
- Invalid weight/reps values (non-numeric, ≤0) are skipped
- If no valid sets exist: No 1RM calculation
- Empty exercise lists rejected at API validation level

### Precision
- 1RM values stored as REAL (float) in database
- Displayed to 1 decimal place: `value.toFixed(1)`
- Stored with full precision for future calculations

### Database Consistency
- `exercise_maxes` uses exercise name as primary key
- Prevents duplicate tracking of same exercise
- `date` field tracks when max was achieved
- `updated_at` tracks last modification

## Testing the Implementation

### Test Scenario 1: First-Time PR
1. Create new exercise "Bench Press"
2. Log workout: 5 reps @ 100 kg
3. Expected: Marked as PR, 1RM calculated as 116.7 kg

### Test Scenario 2: Beat Previous PR
1. Previous max for "Squat": 150 kg (1RM)
2. New workout: 8 reps @ 130 kg → 1RM = 130 × (1 + 8/30) = 164.7 kg
3. Expected: Marked as PR, updated maximum shown

### Test Scenario 3: Miss Previous PR
1. Previous max for "Deadlift": 200 kg (1RM)
2. New workout: 3 reps @ 180 kg → 1RM = 180 × (1 + 3/30) = 198 kg
3. Expected: Not marked as PR, max stays 200 kg

## SQL Queries for Inspection

```sql
-- View all recorded exercise maxes
SELECT exercise_name, max_1rm, date 
FROM exercise_maxes 
ORDER BY date DESC;

-- View single exercise max
SELECT * FROM exercise_maxes 
WHERE exercise_name = 'Squat';

-- View all workouts with their exercises
SELECT id, name, date, exercises 
FROM workouts 
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
