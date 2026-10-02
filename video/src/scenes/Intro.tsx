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

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.panel,
        color: C.ink,
        fontFamily: SANS,
        justifyContent: "center",
        padding: "0 160px",
      }}
    >
      <Interactive.Div
        name="Accent bar"
        style={{
          height: 12,
          backgroundColor: C.accent,
          marginBottom: 48,
          width: interpolate(frame, [0, 22], [0, 220], {
            ...clamp,
            easing: Easing.bezier(...OUT),
          }),
        }}
      />
      <div style={{ overflow: "hidden" }}>
        <Interactive.Div
          name="Wordmark"
          style={{
            fontSize: 210,
            fontWeight: 800,
            letterSpacing: "-0.04em",
            lineHeight: 0.95,
            translate: interpolate(frame, [6, 30], ["0px 220px", "0px 0px"], {
              ...clamp,
              easing: Easing.bezier(...OUT),
            }),
          }}
        >
          FitTrack<span style={{ color: C.accent }}> Pro</span>
        </Interactive.Div>
      </div>
      <Interactive.Div
        name="Tagline"
        style={{
          marginTop: 48,
          fontSize: 52,
          fontWeight: 400,
          color: C.soft,
          opacity: interpolate(frame, [30, 48], [0, 1], {
            ...clamp,
            easing: Easing.bezier(...OUT),
          }),
          translate: interpolate(frame, [30, 52], ["0px 30px", "0px 0px"], {
            ...clamp,
            easing: Easing.bezier(...OUT),
          }),
        }}
      >
        Edzés, regeneráció, táplálkozás és edző, egy naplóban.
      </Interactive.Div>
      <Interactive.Div
        name="Footnote"
        style={{
          position: "absolute",
          left: 160,
          bottom: 110,
          fontFamily: MONO,
          fontSize: 26,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: C.dim,
          opacity: interpolate(frame, [50, 66], [0, 1], {
            ...clamp,
            easing: Easing.bezier(...OUT),
          }),
        }}
      >
        Edző–kliens edzésmenedzsment
      </Interactive.Div>
    </AbsoluteFill>
  );
};
