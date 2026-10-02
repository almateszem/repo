import React from "react";
import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { C, MONO, OUT, SANS } from "../theme";

const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

const PILLARS = ["Készenlét", "Check-in", "Napló", "Táplálkozás", "Edző"];

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.panel,
        color: C.ink,
        fontFamily: SANS,
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      <Interactive.Div
        name="Pillars"
        style={{
          display: "flex",
          gap: 34,
          fontFamily: MONO,
          fontSize: 28,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: C.dim,
        }}
      >
        {PILLARS.map((p, i) => (
          <span
            key={p}
            style={{
              opacity: interpolate(frame, [i * 5, i * 5 + 12], [0, 1], clamp),
            }}
          >
            {i > 0 ? <span style={{ color: C.accent }}>· </span> : null}
            {p}
          </span>
        ))}
      </Interactive.Div>
      <Interactive.Div
        name="Wordmark"
        style={{
          marginTop: 44,
          fontSize: 190,
          fontWeight: 800,
          letterSpacing: "-0.04em",
          lineHeight: 1,
          opacity: interpolate(frame, [18, 34], [0, 1], {
            ...clamp,
            easing: Easing.bezier(...OUT),
          }),
          scale: interpolate(frame, [18, 44], [0.92, 1], {
            ...clamp,
            easing: Easing.bezier(...OUT),
            output: "perceptual-scale",
          }),
        }}
      >
        FitTrack<span style={{ color: C.accent }}> Pro</span>
      </Interactive.Div>
      <Interactive.Div
        name="Run command"
        style={{
          marginTop: 64,
          fontFamily: MONO,
          fontSize: 38,
          padding: "22px 40px",
          border: `2px solid ${C.hair}`,
          color: C.soft,
          opacity: interpolate(frame, [40, 56], [0, 1], {
            ...clamp,
            easing: Easing.bezier(...OUT),
          }),
        }}
      >
        <span style={{ color: C.accent }}>$</span> npm start{" "}
        <span style={{ color: C.faint }}>→</span> localhost:3000
      </Interactive.Div>
    </AbsoluteFill>
  );
};
