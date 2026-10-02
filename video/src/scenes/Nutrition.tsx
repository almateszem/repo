import React from "react";
import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { C, MONO, OUT } from "../theme";
import { Label, SceneFrame } from "../ui/SceneFrame";

const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

const TARGET = 2400;
const EATEN = 1840;

const MACROS = [
  { label: "Fehérje", g: 142, max: 160 },
  { label: "Szénh.", g: 196, max: 280 },
  { label: "Zsír", g: 54, max: 75 },
];

// Egy EAN-13 csíkjainak szélessége — csak a látvány kedvéért.
const BARS = [
  1, 1, 2, 1, 3, 1, 1, 2, 2, 1, 1, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 1, 1, 2, 1, 3,
  1, 1, 2, 1, 1, 2, 1, 3, 2, 1, 1, 1, 2, 1,
];

const fmt = (n: number) =>
  Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export const Nutrition: React.FC = () => {
  const frame = useCurrentFrame();
  const fill = interpolate(frame, [20, 70], [0, EATEN / TARGET], {
    ...clamp,
    easing: Easing.bezier(0.33, 1, 0.68, 1),
  });
  const scan = interpolate(frame, [96, 130], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.65, 0, 0.35, 1),
  });

  return (
    <SceneFrame
      index="04"
      kicker="Táplálkozás"
      title={
        <>
          Kalória, makrók,
          <br />
          vonalkóddal is.
        </>
      }
      body="Katalógusból, saját ételből vagy a kamerával beolvasott termékből: az Open Food Facts kitölti helyetted."
    >
      <div style={{ width: "100%" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <Label>Kalória</Label>
          <span style={{ fontSize: 96, fontWeight: 800 }}>
            {fmt(fill * TARGET)}
            <span
              style={{
                fontFamily: MONO,
                fontSize: 30,
                color: C.dim,
                marginLeft: 14,
              }}
            >
              / {fmt(TARGET)} kcal
            </span>
          </span>
        </div>
        <Interactive.Div
          name="Calorie bar"
          style={{
            height: 16,
            backgroundColor: C.hairSoft,
            marginTop: 24,
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              width: `${fill * 100}%`,
              backgroundColor: C.accent,
            }}
          />
        </Interactive.Div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 48,
            marginTop: 64,
          }}
        >
          {MACROS.map((m, i) => {
            const p = interpolate(frame, [36 + i * 8, 80 + i * 8], [0, 1], {
              ...clamp,
              easing: Easing.bezier(0.33, 1, 0.68, 1),
            });
            return (
              <div
                key={m.label}
                style={{ display: "flex", flexDirection: "column", gap: 16 }}
              >
                <Label>{m.label}</Label>
                <span style={{ fontSize: 56, fontWeight: 600 }}>
                  {Math.round(m.g * p)}
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 24,
                      color: C.dim,
                      marginLeft: 8,
                    }}
                  >
                    g
                  </span>
                </span>
                <div style={{ height: 6, backgroundColor: C.hairSoft }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${(m.g / m.max) * p * 100}%`,
                      backgroundColor: C.ink,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <Interactive.Div
          name="Barcode scan"
          style={{
            marginTop: 80,
            display: "flex",
            alignItems: "center",
            gap: 56,
            borderTop: `2px solid ${C.hair}`,
            paddingTop: 48,
            opacity: interpolate(frame, [84, 98], [0, 1], {
              ...clamp,
              easing: Easing.bezier(...OUT),
            }),
          }}
        >
          <div
            style={{
              position: "relative",
              display: "flex",
              height: 130,
              gap: 3,
              padding: "0 18px",
              backgroundColor: C.ink,
              alignItems: "stretch",
            }}
          >
            {BARS.map((w, i) => (
              <div
                key={i}
                style={{
                  width: w * 3,
                  backgroundColor: i % 2 === 0 ? C.panel : "transparent",
                  margin: "16px 0",
                }}
              />
            ))}
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: `${scan * 100}%`,
                height: 4,
                backgroundColor: C.accent,
                boxShadow: `0 0 18px ${C.accent}`,
                opacity: frame < 130 ? 1 : 0,
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              opacity: interpolate(frame, [132, 146], [0, 1], {
                ...clamp,
                easing: Easing.bezier(...OUT),
              }),
            }}
          >
            <Label style={{ color: C.ok }}>✓ Termék megtalálva</Label>
            <span style={{ fontSize: 42, fontWeight: 600 }}>
              Natúr joghurt · 150 g
            </span>
            <span
              style={{
                fontFamily: MONO,
                fontSize: 24,
                color: C.soft,
                whiteSpace: "nowrap",
              }}
            >
              96 kcal · F 5,3 · Sz 6,8 · Zs 4,8 g
            </span>
          </div>
        </Interactive.Div>
      </div>
    </SceneFrame>
  );
};
