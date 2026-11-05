import { ThreeCanvas } from "@remotion/three";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { defineVideo, Stage } from "../kit";

function ThreeCheckScene() {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const turn = (frame / durationInFrames) * Math.PI * 2;

  return (
    <Stage>
      <AbsoluteFill>
        <ThreeCanvas
          width={width}
          height={height}
          camera={{ position: [0, 0, 4] }}
        >
          <ambientLight intensity={0.6} />
          <directionalLight position={[3, 4, 5]} intensity={2} />
          <mesh rotation={[turn, turn * 2, 0]}>
            <torusKnotGeometry args={[0.8, 0.28, 128, 24]} />
            <meshStandardMaterial color="#f4f4f5" roughness={0.35} />
          </mesh>
        </ThreeCanvas>
      </AbsoluteFill>
    </Stage>
  );
}

/** A turning solid in a ThreeCanvas: if it renders lit and in the right place, three.js is wired right. */
export const threeCheck = defineVideo({
  id: "ThreeCheck",
  component: ThreeCheckScene,
  durationInFrames: 60,
});
