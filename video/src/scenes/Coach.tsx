import React from "react";
import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { C, MONO, OUT } from "../theme";
import { Label, SceneFrame } from "../ui/SceneFrame";

const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

const ATHLETES = [
  { name: "Kiss Dóra", readiness: 88, last: "Ma · Felsőtest", flag: null },
  { name: "Tóth Máté", readiness: 64, last: "Tegnap · Láb", flag: null },
  {
    name: "Varga Lili",
    readiness: 41,
    last: "3 napja · Hát",
    flag: "Fájdalmat jelzett",
  },
];

const tone = (r: number) => (r >= 75 ? C.ok : r >= 55 ? C.gold : C.accent);

export const Coach: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneFrame
      index="05"
      kicker="Edző–sportoló"
      title={
        <>
          Az edződ látja,
          <br />
          amit megosztasz.
        </>
      }
      body="Meghívó, elfogadás, és csak utána: napló, készenlét, üzenetek és kiküldött tervek egy helyen."
    >
      <div style={{ width: "100%" }}>
        <Label>Edzetteim</Label>
        <div style={{ marginTop: 24, borderTop: `2px solid ${C.ink}` }}>
          {ATHLETES.map((a, i) => {
            const start = 16 + i * 12;
            const r = Math.round(
              interpolate(frame, [start + 6, start + 40], [0, a.readiness], {
                ...clamp,
                easing: Easing.bezier(0.33, 1, 0.68, 1),
              }),
            );
            return (
              <div
                key={a.name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 220px",
                  alignItems: "center",
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
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 10 }}
                >
                  <span style={{ fontSize: 48, fontWeight: 600 }}>
                    {a.name}
                  </span>
                  <span
                    style={{ fontFamily: MONO, fontSize: 24, color: C.soft }}
                  >
                    {a.last}
                    {a.flag ? (
                      <span style={{ color: C.accent }}> · {a.flag}</span>
                    ) : null}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "flex-end",
                    gap: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: 80,
                      fontWeight: 800,
                      color: tone(a.readiness),
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {r}
                  </span>
                  <span style={{ fontSize: 34, color: C.faint }}>%</span>
                </div>
              </div>
            );
          })}
        </div>

        <Interactive.Div
          name="Message"
          style={{
            marginTop: 56,
            marginLeft: "auto",
            maxWidth: 780,
            backgroundColor: C.raised,
            borderLeft: `6px solid ${C.accent}`,
            padding: "28px 36px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            opacity: interpolate(frame, [86, 100], [0, 1], {
              ...clamp,
              easing: Easing.bezier(...OUT),
            }),
            translate: interpolate(frame, [86, 106], ["0px 30px", "0px 0px"], {
              ...clamp,
              easing: Easing.bezier(...OUT),
            }),
          }}
        >
          <Label>Üzenet · Varga Lili</Label>
          <span style={{ fontSize: 38, lineHeight: 1.35 }}>
            Ma pihenj, holnapra könnyített hátnapot küldtem.
          </span>
        </Interactive.Div>
      </div>
    </SceneFrame>
  );
};
