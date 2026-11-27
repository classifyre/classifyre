import type { CSSProperties } from "react";
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

/*
 * Hand-drawn 2D Procreate Mr. Fyre poses (`mascot/poses/*.png`).
 *
 * Every PNG is 1200x1200 RGBA with:
 * - transparent exterior, opaque white interior, and a subtle 4 px white paper
 *   edge so black outlines read clearly on both dark stages and light pages;
 * - feet centered at (600, 1100) and standing hat-tip to shoe height of 920 px.
 *
 * No Blender dependency: pose changes use a snappy 2D spring pop anchored at
 * his feet, `"walk"` cycles walk-1 -> walk-2 -> walk-3 -> walk-2 with a subtle
 * step bounce, and `"talk"` holds the single `"explain"` pose (no rapid pose switching).
 * `"think"` contains a drawn `?` above his hat and is never horizontally flipped.
 */

const sprites = require.context("../../../../mascot/poses", false, /\.png$/);

export const FYRE_2D_POSES = [
  "pockets",
  "think",
  "explain",
  "point",
  "present",
  "aha",
  "wave",
  "spread",
  "crossed",
  "stop",
  "check",
  "point-up",
  "lean-in",
  "compare",
  "peek",
  "guard",
  "shrug",
  "walk-1",
  "walk-2",
  "walk-3",
  "run",
  "surprised",
  "tirol-tip",
  "tirol-coffee",
  "tirol-hike",
] as const;

export type Fyre2DPose = (typeof FYRE_2D_POSES)[number];

/** Includes animated virtual poses (`"walk"` and `"talk"` alias for `"explain"`). */
export type Fyre2DAction = Fyre2DPose | "walk" | "talk";

const CANVAS = 1200;
const STANDING_HEIGHT = 920;
const FEET_X = 600;
const FEET_Y = 1100;
const BOX = 0.55;
const DEFAULT_TRAVEL_FRAMES = 22;

const WALK_CYCLE: readonly Fyre2DPose[] = ["walk-1", "walk-2", "walk-3", "walk-2"];

function sprite(pose: Fyre2DPose): string {
  const found = sprites<string | { default: string }>(`./${pose}.png`);
  return typeof found === "string" ? found : found.default;
}

export interface Fyre2DProps {
  pose?: Fyre2DPose;
  /** Standing height in pixels (shoes to hat tip). */
  height?: number;
  /** Mirror horizontally. Directional poses face screen right by default. */
  flip?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Hand-drawn 2D Mr. Fyre in one static pose.
 * Anchored with his feet at the bottom centre of the box; extended arms overflow cleanly.
 */
export function Fyre2D({
  pose = "pockets",
  height = 600,
  flip = false,
  className,
  style,
}: Fyre2DProps) {
  const scale = height / STANDING_HEIGHT;
  const width = height * BOX;

  return (
    <div
      className={className}
      style={{ position: "relative", width, height, flexShrink: 0, ...style }}
    >
      <div
        style={{
          position: "absolute",
          left: width / 2 - FEET_X * scale,
          top: height - FEET_Y * scale,
          width: CANVAS * scale,
          height: CANVAS * scale,
          transform: flip ? "scaleX(-1)" : undefined,
          transformOrigin: `${FEET_X * scale}px ${FEET_Y * scale}px`,
        }}
      >
        <Img
          src={sprite(pose)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
          }}
        />
      </div>
    </div>
  );
}

export interface Fyre2DCue {
  /** Frame when this cue takes effect. */
  at: number;
  pose?: Fyre2DAction;
  flip?: boolean;
  /** Feet x position in frame pixels. */
  x?: number;
  /** Feet y position in frame pixels. */
  y?: number;
  /** Standing height in pixels. */
  height?: number;
  /** Override glide duration in frames for position/height changes. */
  travelFrames?: number;
}

interface State {
  at: number;
  pose: Fyre2DAction;
  flip: boolean;
  x: number;
  y: number;
  height: number;
  travelFrames: number;
}

const START: State = {
  at: 0,
  pose: "pockets",
  flip: false,
  x: 960,
  y: 940,
  height: 540,
  travelFrames: DEFAULT_TRAVEL_FRAMES,
};

interface Change<T> {
  now: T;
  before: T;
  at: number;
}

interface Place {
  x: number;
  y: number;
  height: number;
  travelFrames: number;
}

function resolve(cues: Fyre2DCue[], frame: number) {
  let state = START;
  let pose: Change<Fyre2DAction> = {
    now: START.pose,
    before: START.pose,
    at: -Infinity,
  };
  let place: Change<Place> = {
    now: START,
    before: START,
    at: -Infinity,
  };
  let flip = START.flip;

  const sorted = [...cues].sort((a, b) => a.at - b.at);
  for (const [index, cue] of sorted.entries()) {
    if (cue.at > frame) break;
    const next: State = {
      ...state,
      ...cue,
      travelFrames: cue.travelFrames ?? DEFAULT_TRAVEL_FRAMES,
    };
    const opening = index === 0;
    if (next.pose !== state.pose) {
      pose = {
        now: next.pose,
        before: opening ? next.pose : state.pose,
        at: cue.at,
      };
    }
    if (
      next.x !== state.x ||
      next.y !== state.y ||
      next.height !== state.height
    ) {
      const cut = opening || next.flip !== state.flip;
      place = { now: next, before: cut ? next : state, at: cue.at };
    }
    if (next.flip !== state.flip) {
      pose = { ...pose, before: next.pose, at: cue.at };
    }
    flip = next.flip;
    state = next;
  }

  return { pose, place, flip };
}

function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * Cue-sheet driven 2D Procreate Mr. Fyre actor for Remotion videos.
 * Supports smooth gliding, snappy 2D pose-switch bounce, `"walk"` cycle, and `"talk"` loop.
 */
export function Fyre2DActor({
  cues,
  bounce = true,
}: {
  cues: Fyre2DCue[];
  /** Play a subtle squash-and-stretch pop when changing poses. */
  bounce?: boolean;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { pose, place, flip } = resolve(cues, frame);

  const journey = smooth(
    (frame - place.at) / Math.max(1, place.now.travelFrames),
  );
  const x = interpolate(journey, [0, 1], [place.before.x, place.now.x]);
  const baseY = interpolate(journey, [0, 1], [place.before.y, place.now.y]);
  const height = interpolate(
    journey,
    [0, 1],
    [place.before.height, place.now.height],
  );

  let activePose: Fyre2DPose;
  let stepLift = 0;

  if (pose.now === "walk") {
    const elapsed = Math.max(0, frame - pose.at);
    activePose = WALK_CYCLE[Math.floor(elapsed / 5) % WALK_CYCLE.length] ?? "walk-1";
    stepLift = Math.abs(Math.sin((elapsed / 5) * (Math.PI / 2))) * (height * 0.014);
  } else if (pose.now === "talk") {
    activePose = "explain";
  } else {
    activePose = pose.now;
  }

  // Never mirror "think" because its drawn "?" above the hat would invert backwards.
  const effectiveFlip = activePose === "think" ? false : flip;

  // Subtle 2D cartoon pop when switching from one pose to another
  let scaleX = 1;
  let scaleY = 1;
  if (bounce && pose.before !== pose.now && pose.at > -Infinity) {
    const since = frame - pose.at;
    if (since >= 0 && since < 16) {
      const pop = spring({
        frame: since,
        fps,
        config: { damping: 12, stiffness: 260, mass: 0.6 },
      });
      // Quick dip on frame 0 then crisp settle to 1
      scaleY = interpolate(pop, [0, 0.5, 1], [0.94, 1.03, 1]);
      scaleX = interpolate(pop, [0, 0.5, 1], [1.04, 0.98, 1]);
    }
  }

  const y = baseY - stepLift;
  const width = height * BOX;

  return (
    <Fyre2D
      pose={activePose}
      height={height}
      flip={effectiveFlip}
      style={{
        position: "absolute",
        left: x - width / 2,
        top: y - height,
        transform:
          scaleX !== 1 || scaleY !== 1
            ? `scale(${scaleX}, ${scaleY})`
            : undefined,
        transformOrigin: "50% 100%",
      }}
    />
  );
}
