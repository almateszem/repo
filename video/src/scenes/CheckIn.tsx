import React from "react";
import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
// Az app saját testtérkép-geometriája — nem másolat, hogy a videó
// figurája ne csúszhasson el az appétól.
import {
  BODY_HEAD,
  BODY_REGIONS,
  BODY_SILHOUETTE,
  BODY_VIEW_BOX,
} from "../../../public/js/ui/bodymap/paths.js";
import { C, MONO, OUT } from "../theme";
import { Label, SceneFrame } from "../ui/SceneFrame";

const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

const MIRROR = `translate(${BODY_VIEW_BOX.width},0) scale(-1,1)`;

// Melyik régió mikor gyullad ki, és mennyire fáj (0–1 → átlátszóság).
const SORE: Record<string, { at: number; level: number }> = {
  quads: { at: 78, level: 1 },
  shoulders: { at: 96, level: 0.55 },
};

const STEPS = [
  { label: "Alvás", value: "7,5 h" },
  { label: "Energia", value: "7 / 10" },
  { label: "Stressz", value: "3 / 10" },
  { label: "Izomláz", value: "Comb, váll" },
];

export const CheckIn: React.FC = () => {
  const frame = useCurrentFrame();

  const draw = interpolate(frame, [10, 60], [1, 0], {
    ...clamp,
    easing: Easing.bezier(0.65, 0, 0.35, 1),
  });

  const regionFill = (key: string) => {
    const s = SORE[key];
    if (!s) return "transparent";
    const a = interpolate(frame, [s.at, s.at + 14], [0, s.level], clamp);
    return `rgba(200, 16, 46, ${a})`;
  };

  const outline = {
    fill: "none",
    stroke: C.ink,
    strokeWidth: 1.6,
    strokeLinejoin: "round" as const,
    pathLength: 1,
    strokeDasharray: 1,
    strokeDashoffset: draw,
  };

  return (
    <SceneFrame
      index="02"
      kicker="Napi check-in"
      title={
        <>
          Pár koppintás,
          <br />
          és tudod, hol tartasz.
        </>
      }
      body="Kérdésenként egy képernyő. Az izomlázat és a fájdalmat a testtérképen jelölöd."
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 90,
          width: "100%",
        }}
      >
        <Interactive.Div name="Body map" style={{ height: 780 }}>
          <svg
            viewBox={`0 0 ${BODY_VIEW_BOX.width} ${BODY_VIEW_BOX.height}`}
            style={{ height: "100%", overflow: "visible" }}
          >
            <g>
              {BODY_REGIONS.front
                .filter((r) => !r.mirrored)
                .map((r) => (
                  <path key={r.key} d={r.d} fill={regionFill(r.key)} />
                ))}
              {BODY_REGIONS.front
                .filter((r) => r.mirrored)
                .map((r) => (
                  <path key={r.key} d={r.d} fill={regionFill(r.key)} />
                ))}
            </g>
            <g transform={MIRROR}>
              {BODY_REGIONS.front
                .filter((r) => r.mirrored)
                .map((r) => (
                  <path key={r.key} d={r.d} fill={regionFill(r.key)} />
                ))}
            </g>
            {BODY_SILHOUETTE.front.map((d, i) => (
              <path key={`l${i}`} d={d} {...outline} />
            ))}
            <g transform={MIRROR}>
              {BODY_SILHOUETTE.front.map((d, i) => (
                <path key={`r${i}`} d={d} {...outline} />
              ))}
            </g>
            <circle
              cx={BODY_HEAD.cx}
              cy={BODY_HEAD.cy}
              r={BODY_HEAD.r}
              {...outline}
            />
          </svg>
        </Interactive.Div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {STEPS.map((s, i) => {
            const start = 20 + i * 14;
            const active = i === STEPS.length - 1 && frame >= 70;
            return (
              <div
                key={s.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  padding: "30px 0",
                  borderBottom: `2px solid ${C.hair}`,
                  opacity: interpolate(frame, [start, start + 14], [0, 1], {
                    ...clamp,
                    easing: Easing.bezier(...OUT),
                  }),
                  translate: interpolate(
                    frame,
                    [start, start + 18],
                    ["30px 0px", "0px 0px"],
                    { ...clamp, easing: Easing.bezier(...OUT) },
                  ),
                }}
              >
                <Label style={active ? { color: C.accent } : undefined}>
                  {s.label}
                </Label>
                <span style={{ fontSize: 44, fontWeight: 600 }}>{s.value}</span>
              </div>
            );
          })}
          <div
            style={{
              marginTop: 40,
              fontFamily: MONO,
              fontSize: 24,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: C.ok,
              opacity: interpolate(frame, [118, 132], [0, 1], clamp),
            }}
          >
            ✓ Mentve, a készenlét frissült
          </div>
        </div>
      </div>
    </SceneFrame>
  );
};
