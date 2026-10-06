import type { CSSProperties } from "react";
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import manifest from "../../../../blender/renders/mr-fyre/manifest.json";

/*
 * Mr. Fyre is a 3D model (blender/mascot.blend, built by blender/build.py)
 * shaded and outlined to read as a drawing, and rendered out as transparent
 * sprites: his body in every pose, and his brows for every emotion in that
 * pose. Reading the directory and the manifest rather than listing them means
 * a pose or emotion added in Blender exists here, typed, once it is rendered.
 */
const sprites = require.context(
  "../../../../blender/renders/mr-fyre",
  true,
  /\.png$/,
);

export type FyrePose = keyof typeof manifest.poses;
export type FyreEmotion = keyof typeof manifest.emotions;

export const FYRE_POSES = Object.keys(manifest.poses) as FyrePose[];
export const FYRE_EMOTIONS = Object.keys(manifest.emotions) as FyreEmotion[];

function sprite(path: string): string {
  const found = sprites<string | { default: string }>(`./${path}.png`);
  return typeof found === "string" ? found : found.default;
}

/** Ground to hat tip of a standing Mr. Fyre, in the units the manifest uses. */
const STANDING = 10.1;
/** How wide the layout box is, relative to its height. Wide poses overflow it. */
const BOX = 0.5;

const fill: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
};

export interface MrFyreProps {
  pose?: FyrePose;
  emotion?: FyreEmotion;
  /** How tall he stands, in pixels, ground to hat tip. Every pose keeps this scale. */
  height?: number;
  /** Mirror him. Poses that point, point to screen right. */
  flip?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Mr. Fyre in one pose with one emotion. Its box is a standing figure with the
 * feet at the bottom centre; whatever a pose throws outside that overflows.
 */
export function MrFyre({
  pose = "idle",
  emotion = "wry",
  height = 600,
  flip = false,
  className,
  style,
}: MrFyreProps) {
  const scale = height / STANDING / manifest.pixelsPerUnit;
  const width = height * BOX;
  const [originX, originY] = manifest.origin as [number, number];

  return (
    <div
      className={className}
      style={{ position: "relative", width, height, flexShrink: 0, ...style }}
    >
      <div
        style={{
          position: "absolute",
          left: width / 2 - originX * scale,
          top: height - originY * scale,
          width: manifest.width * scale,
          height: manifest.height * scale,
          transform: flip ? "scaleX(-1)" : undefined,
          transformOrigin: `${originX * scale}px 0`,
        }}
      >
        <Img src={sprite(`body/${pose}`)} style={fill} />
        <Img src={sprite(`brows/${pose}__${emotion}`)} style={fill} />
      </div>
    </div>
  );
}

export interface FyreCue {
  /** The frame this takes effect on. */
  at: number;
  pose?: FyrePose;
  emotion?: FyreEmotion;
  flip?: boolean;
  /** Where his feet stand, in frame pixels. */
  x?: number;
  y?: number;
  /** How tall he stands, in pixels. */
  height?: number;
}

type FyreState = Required<FyreCue>;

const START: FyreState = {
  at: 0,
  pose: "idle",
  emotion: "wry",
  flip: false,
  x: 960,
  y: 940,
  height: 620,
};

/** The state at `frame`, and the one it replaced: a cue only restates what changes. */
function resolve(cues: FyreCue[], frame: number): [FyreState, FyreState] {
  let previous = START;
  let current = START;
  for (const cue of [...cues].sort((a, b) => a.at - b.at)) {
    if (cue.at > frame) break;
    previous = current;
    current = { ...current, ...cue };
  }
  return [current, previous];
}

/**
 * Mr. Fyre directed by a cue sheet, for a video where he stands in for the
 * speaker. He holds each pose and cuts to the next, the way limited animation
 * does, and glides to wherever a cue moves him. Nothing else about him moves.
 */
export function MrFyreActor({ cues }: { cues: FyreCue[] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [now, before] = resolve(cues, frame);

  const travel = spring({ frame: frame - now.at, fps, config: { damping: 200 } });
  const x = interpolate(travel, [0, 1], [before.x, now.x]);
  const y = interpolate(travel, [0, 1], [before.y, now.y]);
  const height = interpolate(travel, [0, 1], [before.height, now.height]);

  return (
    <MrFyre
      pose={now.pose}
      emotion={now.emotion}
      flip={now.flip}
      height={height}
      style={{ position: "absolute", left: x - (height * BOX) / 2, top: y - height }}
    />
  );
}
