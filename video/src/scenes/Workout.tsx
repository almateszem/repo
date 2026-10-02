import React from "react";
import {
  Easing,
  Interactive,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { C, MONO, OUT } from "../theme";
import { Label, SceneFrame } from "../ui/SceneFrame";

const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

const SETS = [
  { kg: 80, reps: 8 },
  { kg: 90, reps: 6 },
  { kg: 100, reps: 5 },
  { kg: 105, reps: 5, pr: true },
];

export const Workout: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const prAt = 30 + (SETS.length - 1) * 16 + 12;
  const pop = spring({
    frame: frame - prAt,
    fps,
    config: { damping: 12, stiffness: 180 },
  });

  return (
    <SceneFrame
      index="03"
      kicker="Edzésnapló"
      title={
        <>
          Minden sorozat.
          <br />
          Minden csúcs.
        </>
      }
      body="Tervből vagy szabadon: a súlyt és az ismétlést rögzíted, a PR-t az app veszi észre."
    >
      <div style={{ width: "100%" }}>
        <Interactive.Div
          name="Exercise header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            paddingBottom: 28,
            borderBottom: `2px solid ${C.ink}`,
            opacity: interpolate(frame, [8, 22], [0, 1], {
              ...clamp,
              easing: Easing.bezier(...OUT),
            }),
          }}
        >
          <span style={{ fontSize: 64, fontWeight: 800 }}>Guggolás</span>
          <Label>Comb · Farizom</Label>
        </Interactive.Div>

        {SETS.map((s, i) => {
          const start = 30 + i * 16;
          return (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "90px 1fr 1fr 200px",
                alignItems: "center",
                padding: "30px 0",
                borderBottom: `2px solid ${C.hair}`,
                backgroundColor: s.pr
                  ? `rgba(200, 16, 46, ${interpolate(frame, [prAt, prAt + 10], [0, 0.16], clamp)})`
                  : "transparent",
                opacity: interpolate(frame, [start, start + 12], [0, 1], {
                  ...clamp,
                  easing: Easing.bezier(...OUT),
                }),
                translate: interpolate(
                  frame,
                  [start, start + 16],
                  ["0px 24px", "0px 0px"],
                  { ...clamp, easing: Easing.bezier(...OUT) },
                ),
              }}
            >
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 30,
                  color: C.dim,
                  paddingLeft: 16,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{ fontSize: 52, fontWeight: 600 }}>
                {s.kg}
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 24,
                    color: C.dim,
                    marginLeft: 10,
                  }}
                >
                  kg
                </span>
              </span>
              <span style={{ fontSize: 52, fontWeight: 600 }}>× {s.reps}</span>
              <span style={{ display: "flex", justifyContent: "flex-end" }}>
                {s.pr ? (
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 24,
                      fontWeight: 700,
                      letterSpacing: "0.12em",
                      backgroundColor: C.accent,
                      color: "#fff",
                      padding: "10px 18px",
                      marginRight: 16,
                      scale: pop,
                    }}
                  >
                    ÚJ PR
                  </span>
                ) : (
                  <span style={{ fontSize: 34, color: C.ok, marginRight: 30 }}>
                    ✓
                  </span>
                )}
              </span>
            </div>
          );
        })}

        <div
          style={{
            display: "flex",
            gap: 70,
            marginTop: 44,
            opacity: interpolate(frame, [prAt + 12, prAt + 28], [0, 1], {
              ...clamp,
              easing: Easing.bezier(...OUT),
            }),
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Label>Becsült 1RM</Label>
            <span style={{ fontSize: 44, fontWeight: 600 }}>122,5 kg</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Label>Elmozdított súly</Label>
            <span style={{ fontSize: 44, fontWeight: 600 }}>2 205 kg</span>
          </div>
        </div>
      </div>
    </SceneFrame>
  );
};
