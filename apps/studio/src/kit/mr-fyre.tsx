import type { CSSProperties } from "react";
import { Img, interpolate, useCurrentFrame } from "remotion";
import manifest from "../../../../blender/renders/mr-fyre/manifest.json";

/*
 * Mr. Fyre is a 3D model (blender/mascot.blend, built by blender/build.py)
 * that is drawn rather than lit, and comes out of Blender as transparent
 * sprites: one for every pose, and one for every frame of every move between
 * two poses that has been drawn. Reading the directory and the manifest rather
 * than listing them means a pose, an emotion or a move added in Blender exists
 * here once it is rendered.
 *
 * His brows are not in the sprites. They hang in the air in front of his hat,
 * and Blender only says where; they are drawn here, so an emotion is two numbers a brow rather than a
 * picture, and one emotion can ease into the next.
 */
const sprites = require.context(
  "../../../../blender/renders/mr-fyre",
  true,
  /\.png$/,
);
const moveFiles = require.context(
  "../../../../blender/renders/mr-fyre",
  true,
  /moves\/[^/]+\/move\.json$/,
);

export type FyrePose = keyof typeof manifest.poses;
export type FyreEmotion = keyof typeof manifest.emotions;

export const FYRE_POSES = Object.keys(manifest.poses) as FyrePose[];
export const FYRE_EMOTIONS = Object.keys(manifest.emotions) as FyreEmotion[];

type Point = [number, number];
/** Where a brow is on a sprite: its middle, a unit along it, a unit up from it. */
interface BrowPlace {
  at: number[];
  along: number[];
  up: number[];
  /** False when it is round the far side of the hat. */
  shown: boolean;
}
type Brows = { L: BrowPlace; R: BrowPlace };
/** What the two brows are doing, screen left then screen right: [roll in degrees, lift]. */
type Mood = number[][];

interface Move {
  /** How long the studio should take to carry him across, when the move travels. */
  travelFrames: number;
  frames: { brows: Brows }[];
}

const moves = new Map<string, Move>(
  moveFiles
    .keys()
    .map((key) => [key.split("/")[2] ?? "", moveFiles<Move>(key)] as const),
);

function sprite(path: string): string {
  const found = sprites<string | { default: string }>(`./${path}.png`);
  return typeof found === "string" ? found : found.default;
}

/** How wide the layout box is, relative to its height. Wide poses overflow it. */
const BOX = 0.5;
/** How many frames one emotion takes to become the next. */
const MOOD_FRAMES = 6;
/** How many frames he takes to cross the picture when no move says otherwise. */
const TRAVEL_FRAMES = 24;
/** A change of place smaller than this, in pixels, is a nudge, not a journey. */
const JOURNEY = 60;
/** How wide the halo is, in character units: a little less than his line. */
const HALO = 0.045;

const fill: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
};

/** A brow's corners on the sprite, for one side of his face and one mood. */
function browCorners(
  place: BrowPlace,
  side: -1 | 1,
  [roll = 0, lift = 0]: number[],
): string {
  const turn = (side * roll * Math.PI) / 180;
  const [atX = 0, atY = 0] = place.at;
  const [alongX = 0, alongY = 0] = place.along;
  const [upX = 0, upY = 0] = place.up;

  return (manifest.brow as Point[])
    .map(([x, z]) => {
      const a = side * x;
      const along = z * Math.sin(turn) + a * Math.cos(turn);
      const up = z * Math.cos(turn) - a * Math.sin(turn) + lift;
      return `${atX + along * alongX + up * upX},${atY + along * alongY + up * upY}`;
    })
    .join(" ");
}

interface DrawingProps {
  image: string;
  brows: Brows;
  mood: Mood;
  height: number;
  flip: boolean;
  halo: boolean;
  className?: string;
  style?: CSSProperties;
}

/** One sprite with its brows, standing in a box with the feet at the bottom centre. */
function Drawing({
  image,
  brows,
  mood,
  height,
  flip,
  halo,
  className,
  style,
}: DrawingProps) {
  const scale = height / manifest.standing / manifest.pixelsPerUnit;
  const width = height * BOX;
  const [originX, originY] = manifest.origin as Point;
  // He is ink on paper, and ink does not show on a dark stage: his shoes
  // would be gone. A paper edge all the way round him, the way a sticker is
  // cut, keeps them. On a white ground it is not there.
  const edge = HALO * manifest.pixelsPerUnit * scale;
  const cut = [
    [edge, 0],
    [-edge, 0],
    [0, edge],
    [0, -edge],
  ]
    .map(([x, y]) => `drop-shadow(${x}px ${y}px 0 white)`)
    .join(" ");

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
          filter: halo ? cut : undefined,
        }}
      >
        <Img src={image} style={fill} />
        <svg
          viewBox={`0 0 ${manifest.width} ${manifest.height}`}
          style={fill}
          fill="black"
        >
          {brows.L.shown ? (
            <polygon points={browCorners(brows.L, -1, mood[0] ?? [])} />
          ) : null}
          {brows.R.shown ? (
            <polygon points={browCorners(brows.R, 1, mood[1] ?? [])} />
          ) : null}
        </svg>
      </div>
    </div>
  );
}

export interface MrFyreProps {
  pose?: FyrePose;
  emotion?: FyreEmotion;
  /** How tall he stands, in pixels, ground to hat tip. Every pose keeps this scale. */
  height?: number;
  /** Mirror him. Poses that point, point to screen right. */
  flip?: boolean;
  /** A white edge round him, so that his ink reads on a dark stage. */
  halo?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Mr. Fyre in one pose with one emotion. Its box is a standing figure with the
 * feet at the bottom centre; whatever a pose throws outside that overflows.
 */
export function MrFyre({
  pose = "pockets",
  emotion = "wry",
  height = 600,
  flip = false,
  halo = true,
  className,
  style,
}: MrFyreProps) {
  return (
    <Drawing
      image={sprite(`body/${pose}`)}
      brows={manifest.poses[pose].brows}
      mood={manifest.emotions[emotion]}
      height={height}
      flip={flip}
      halo={halo}
      className={className}
      style={style}
    />
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
  pose: "pockets",
  emotion: "wry",
  flip: false,
  x: 960,
  y: 940,
  height: 620,
};

/** One thing a cue can change: what it is now, what it was, and since when. */
interface Change<T> {
  now: T;
  before: T;
  at: number;
}

interface Place {
  x: number;
  y: number;
  height: number;
}

interface Resolved {
  pose: Change<FyrePose>;
  emotion: Change<FyreEmotion>;
  place: Change<Place>;
  flip: boolean;
}

/**
 * Where the cue sheet has him at `frame`. A cue only restates what changes, so
 * each of his pose, his emotion and his place remembers its own last change:
 * a new emotion must not interrupt a move still being played.
 */
function resolve(cues: FyreCue[], frame: number): Resolved {
  let state = START;
  const out: Resolved = {
    pose: { now: START.pose, before: START.pose, at: -Infinity },
    emotion: { now: START.emotion, before: START.emotion, at: -Infinity },
    place: { now: START, before: START, at: -Infinity },
    flip: START.flip,
  };
  const sorted = [...cues].sort((a, b) => a.at - b.at);
  for (const [index, cue] of sorted.entries()) {
    if (cue.at > frame) break;
    const next = { ...state, ...cue };
    // Wherever the first cue puts him, he is simply there.
    const opening = index === 0;
    if (next.pose !== state.pose) {
      out.pose = {
        now: next.pose,
        before: opening ? next.pose : state.pose,
        at: cue.at,
      };
    }
    if (next.emotion !== state.emotion) {
      out.emotion = {
        now: next.emotion,
        before: opening ? next.emotion : state.emotion,
        at: cue.at,
      };
    }
    if (
      next.x !== state.x ||
      next.y !== state.y ||
      next.height !== state.height
    ) {
      // A mirrored figure does not turn round, it is swapped: no gliding either.
      const cut = opening || next.flip !== state.flip;
      out.place = { now: next, before: cut ? next : state, at: cue.at };
    }
    if (next.flip !== state.flip) {
      out.pose = { ...out.pose, before: next.pose, at: cue.at };
    }
    out.flip = next.flip;
    state = next;
  }
  return out;
}

function smooth(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * Mr. Fyre directed by a cue sheet, for a video where he stands in for the
 * speaker. When a cue changes his pose he moves into it, his tie and coat
 * swinging after him, if Blender has drawn that move
 * (`build.py --moves-for <this video>`); if it has not, he cuts to the pose.
 * His brows ease from one emotion to the next, and he glides to wherever a cue
 * moves him.
 */
export function MrFyreActor({
  cues,
  halo = true,
}: {
  cues: FyreCue[];
  /** A white edge round him, so that his ink reads on a dark stage. */
  halo?: boolean;
}) {
  const frame = useCurrentFrame();
  const { pose, emotion, place, flip } = resolve(cues, frame);

  // The last time he started moving: into a new pose, across the picture, or both.
  const started = Math.max(pose.at, place.at);
  const since = frame - started;
  const from = pose.at === started ? pose.before : pose.now;
  const shift = place.at === started ? place.now.x - place.before.x : 0;
  // A mirrored sprite travels the other way from the one that was drawn.
  const towards = shift * (flip ? -1 : 1) > 0 ? "right" : "left";
  const drawn = [
    Math.abs(shift) > JOURNEY ? `${from}__${pose.now}__${towards}` : "",
    from === pose.now ? "" : `${from}__${pose.now}`,
  ].find((name) => moves.has(name));
  const move = drawn === undefined ? undefined : moves.get(drawn);
  const playing = move?.frames[since];

  const journey = smooth(
    (frame - place.at) / (move?.travelFrames || TRAVEL_FRAMES),
  );
  const x = interpolate(journey, [0, 1], [place.before.x, place.now.x]);
  const y = interpolate(journey, [0, 1], [place.before.y, place.now.y]);
  const height = interpolate(
    journey,
    [0, 1],
    [place.before.height, place.now.height],
  );

  const settle = smooth((frame - emotion.at) / MOOD_FRAMES);
  const was = manifest.emotions[emotion.before];
  const mood = manifest.emotions[emotion.now].map((brow, side) =>
    brow.map((value, part) =>
      interpolate(settle, [0, 1], [was[side]?.[part] ?? value, value]),
    ),
  );

  return (
    <Drawing
      image={sprite(
        playing
          ? `moves/${drawn}/${String(since).padStart(2, "0")}`
          : `body/${pose.now}`,
      )}
      brows={playing?.brows ?? manifest.poses[pose.now].brows}
      mood={mood}
      flip={flip}
      halo={halo}
      height={height}
      style={{
        position: "absolute",
        left: x - (height * BOX) / 2,
        top: y - height,
      }}
    />
  );
}
