import React from "react";
import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { C, MONO, OUT } from "../theme";
import { Label, SceneFrame } from "../ui/SceneFrame";

const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

const STATS = [
  { label: "Alvás", value: "7,5", unit: "h" },
  { label: "Sorozat", value: "12", unit: "nap" },
  { label: "Fáradtság", value: "Enyhe", unit: "" },
  { label: "Izomláz", value: "Közepes", unit: "" },
];

export const Readiness: React.FC = () => {
  const frame = useCurrentFrame();
  const score = Math.round(
    interpolate(frame, [18, 70], [0, 82], {
      ...clamp,
      easing: Easing.bezier(0.33, 1, 0.68, 1),
    }),
  );

  return (
    <SceneFrame
      index="01"
      kicker="Áttekintés"
      title={
        <>
          Egy szám.
          <br />
          Ennyit bírsz ma.
        </>
      }
      body="A Recovery Engine az alvásból, a check-inből és a naplóból számolja a készenlétedet."
    >
      <div style={{ width: "100%" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 24 }}>
          <Interactive.Div
            name="Score"
            style={{
              fontSize: 330,
              fontWeight: 800,
              lineHeight: 0.8,
              letterSpacing: "-0.05em",
              fontVariantNumeric: "tabular-nums",
              opacity: interpolate(frame, [14, 24], [0, 1], clamp),
            }}
          >
            {score}
          </Interactive.Div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 20,
              paddingTop: 10,
            }}
          >
            <span style={{ fontSize: 110, fontWeight: 800, color: C.faint }}>
              %
            </span>
            <Label style={{ color: C.accent }}>Készenlét</Label>
          </div>
        </div>
        <Interactive.Div
          name="Stats"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            borderTop: `2px solid ${C.hair}`,
            marginTop: 80,
          }}
        >
          {STATS.map((s, i) => (
            <div
              key={s.label}
              style={{
                padding: "32px 0 0 0",
                display: "flex",
                flexDirection: "column",
                gap: 14,
                opacity: interpolate(frame, [60 + i * 6, 76 + i * 6], [0, 1], {
                  ...clamp,
                  easing: Easing.bezier(...OUT),
                }),
                translate: interpolate(
                  frame,
                  [60 + i * 6, 80 + i * 6],
                  ["0px 20px", "0px 0px"],
                  { ...clamp, easing: Easing.bezier(...OUT) },
                ),
              }}
            >
              <Label>{s.label}</Label>
              <span style={{ fontSize: 50, fontWeight: 600 }}>
                {s.value}
                {s.unit ? (
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 24,
                      color: C.dim,
                      marginLeft: 8,
                    }}
                  >
                    {s.unit}
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </Interactive.Div>
      </div>
    </SceneFrame>
  );
};
