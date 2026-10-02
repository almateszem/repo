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

/**
 * Minden funkció-jelenet váza: balra a sorszám, a címsor és egy
 * mondatnyi magyarázat, jobbra a „képernyő" — az app egy felületének
 * animált mása.
 */
export const SceneFrame: React.FC<{
  index: string;
  kicker: string;
  title: React.ReactNode;
  body: string;
  children: React.ReactNode;
}> = ({ index, kicker, title, body, children }) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.paper,
        color: C.ink,
        fontFamily: SANS,
        flexDirection: "row",
      }}
    >
      <div
        style={{
          width: 760,
          padding: "0 0 0 140px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 36,
        }}
      >
        <Interactive.Div
          name="Kicker"
          style={{
            fontFamily: MONO,
            fontSize: 26,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: C.dim,
            display: "flex",
            alignItems: "center",
            gap: 20,
            opacity: interpolate(frame, [0, 12], [0, 1], {
              ...clamp,
              easing: Easing.bezier(...OUT),
            }),
          }}
        >
          <span style={{ color: C.accent }}>{index}</span>
          <span
            style={{
              height: 2,
              backgroundColor: C.accent,
              width: interpolate(frame, [0, 18], [0, 56], {
                ...clamp,
                easing: Easing.bezier(...OUT),
              }),
            }}
          />
          {kicker}
        </Interactive.Div>
        <Interactive.Div
          name="Title"
          style={{
            fontSize: 84,
            fontWeight: 800,
            lineHeight: 1.02,
            letterSpacing: "-0.025em",
            opacity: interpolate(frame, [4, 20], [0, 1], {
              ...clamp,
              easing: Easing.bezier(...OUT),
            }),
            translate: interpolate(frame, [4, 24], ["0px 40px", "0px 0px"], {
              ...clamp,
              easing: Easing.bezier(...OUT),
            }),
          }}
        >
          {title}
        </Interactive.Div>
        <Interactive.Div
          name="Body"
          style={{
            fontSize: 34,
            lineHeight: 1.4,
            color: C.soft,
            maxWidth: 560,
            opacity: interpolate(frame, [14, 30], [0, 1], {
              ...clamp,
              easing: Easing.bezier(...OUT),
            }),
            translate: interpolate(frame, [14, 34], ["0px 24px", "0px 0px"], {
              ...clamp,
              easing: Easing.bezier(...OUT),
            }),
          }}
        >
          {body}
        </Interactive.Div>
      </div>
      <div
        style={{
          flex: 1,
          borderLeft: `2px solid ${C.hair}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          padding: "0 120px 0 110px",
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

/** Nagybetűs, ritkított mono címke — az app `.db-label`-je. */
export const Label: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ children, style }) => (
  <span
    style={{
      fontFamily: MONO,
      fontSize: 22,
      letterSpacing: "0.16em",
      textTransform: "uppercase",
      color: C.dim,
      ...style,
    }}
  >
    {children}
  </span>
);
