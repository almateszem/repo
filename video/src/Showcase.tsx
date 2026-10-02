import React from "react";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { CheckIn } from "./scenes/CheckIn";
import { Coach } from "./scenes/Coach";
import { Intro } from "./scenes/Intro";
import { Nutrition } from "./scenes/Nutrition";
import { Outro } from "./scenes/Outro";
import { Readiness } from "./scenes/Readiness";
import { Workout } from "./scenes/Workout";

const T = 15;
const timing = linearTiming({ durationInFrames: T });

// A jelenetek hossza (képkocka). Az átmenetek T-t átfednek, ezért a
// teljes hossz = összeg − 6·T.
export const SHOWCASE_DURATION =
  105 + 165 + 170 + 170 + 175 + 165 + 120 - 6 * T;

export const Showcase: React.FC = () => {
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={105} name="Intro">
        <Intro />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-bottom" })}
        timing={timing}
      />
      <TransitionSeries.Sequence durationInFrames={165} name="Readiness">
        <Readiness />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={timing}
      />
      <TransitionSeries.Sequence durationInFrames={170} name="CheckIn">
        <CheckIn />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={timing}
      />
      <TransitionSeries.Sequence durationInFrames={170} name="Workout">
        <Workout />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={timing}
      />
      <TransitionSeries.Sequence durationInFrames={175} name="Nutrition">
        <Nutrition />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={timing}
      />
      <TransitionSeries.Sequence durationInFrames={165} name="Coach">
        <Coach />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={wipe({ direction: "from-left" })}
        timing={timing}
      />
      <TransitionSeries.Sequence durationInFrames={120} name="Outro">
        <Outro />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
