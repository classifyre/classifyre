import { AbsoluteFill } from "remotion";
import { defineVideo, Stage, useTimeline } from "../kit";

function GsapCheckScene() {
  const root = useTimeline((tl) => {
    tl.from(".dot", {
      y: 120,
      opacity: 0,
      scale: 0.4,
      stagger: 0.12,
      duration: 0.8,
      ease: "back.out(1.7)",
    });
  });

  return (
    <Stage>
      <AbsoluteFill className="items-center justify-center">
        <div ref={root} className="flex gap-10">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="dot size-24 rounded-full bg-primary" />
          ))}
        </div>
      </AbsoluteFill>
    </Stage>
  );
}

/** A staggered timeline driven by the frame: if the dots land in order, GSAP is wired right. */
export const gsapCheck = defineVideo({
  id: "GsapCheck",
  component: GsapCheckScene,
  durationInFrames: 60,
});
