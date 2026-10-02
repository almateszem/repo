import React from "react";
import { Composition, Folder } from "remotion";
import { CheckIn } from "./scenes/CheckIn";
import { Coach } from "./scenes/Coach";
import { Intro } from "./scenes/Intro";
import { Nutrition } from "./scenes/Nutrition";
import { Outro } from "./scenes/Outro";
import { Readiness } from "./scenes/Readiness";
import { Workout } from "./scenes/Workout";
import { SHOWCASE_DURATION, Showcase } from "./Showcase";

const size = { fps: 30, width: 1920, height: 1080 };

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="FitTrackShowcase"
        component={Showcase}
        durationInFrames={SHOWCASE_DURATION}
        {...size}
      />
      <Folder name="Jelenetek">
        <Composition
          id="Intro"
          component={Intro}
          durationInFrames={105}
          {...size}
        />
        <Composition
          id="Readiness"
          component={Readiness}
          durationInFrames={165}
          {...size}
        />
        <Composition
          id="CheckIn"
          component={CheckIn}
          durationInFrames={170}
          {...size}
        />
        <Composition
          id="Workout"
          component={Workout}
          durationInFrames={170}
          {...size}
        />
        <Composition
          id="Nutrition"
          component={Nutrition}
          durationInFrames={175}
          {...size}
        />
        <Composition
          id="Coach"
          component={Coach}
          durationInFrames={165}
          {...size}
        />
        <Composition
          id="Outro"
          component={Outro}
          durationInFrames={120}
          {...size}
        />
      </Folder>
    </>
  );
};
