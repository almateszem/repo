import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

// Az app tokenjei (public/style.css :root) — a videó ugyanazt a nyelvet
// beszéli: sötét papír, egyetlen vörös kiemelés, hajszálvonalak, nulla
// lekerekítés.
export const C = {
  paper: "#17181b",
  panel: "#0a0a0b",
  raised: "#1e1f23",
  ink: "#f2f0ea",
  accent: "#c8102e",
  accentDim: "rgba(200, 16, 46, 0.16)",
  ok: "#4ad295",
  gold: "#e8c15a",
  hair: "rgba(255, 255, 255, 0.18)",
  hairSoft: "rgba(255, 255, 255, 0.11)",
  soft: "rgba(255, 255, 255, 0.66)",
  dim: "rgba(255, 255, 255, 0.52)",
  faint: "rgba(255, 255, 255, 0.34)",
};

export const SANS = loadInter("normal", {
  weights: ["400", "600", "800"],
  subsets: ["latin", "latin-ext"],
}).fontFamily;

export const MONO = loadMono("normal", {
  weights: ["400", "700"],
  subsets: ["latin", "latin-ext"],
}).fontFamily;

export const FPS = 30;

// Egy közös kifutó görbe minden belépéshez — a jelenetek így egy
// kézírással mozognak.
export const OUT = [0.16, 1, 0.3, 1] as const;
