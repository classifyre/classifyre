import { Easing, interpolate } from "remotion";

/* Small pure helpers: every one is a function of the frame it is given. */

const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);
const OUT = Easing.bezier(0.16, 1, 0.3, 1);

/** 0 → 1 between `start` and `start + frames`, easing in and out. */
export function glide(frame: number, start: number, frames = 20): number {
  if (!Number.isFinite(start)) return start < 0 ? 1 : 0;
  return interpolate(frame, [start, start + frames], [0, 1], {
    ...CLAMP,
    easing: IN_OUT,
  });
}

/** 0 → 1 from `start`, arriving fast and settling: for things that appear. */
export function arrive(frame: number, start: number, frames = 18): number {
  // "Always" and "never" are frames too: something that was there before the scene began.
  if (!Number.isFinite(start)) return start < 0 ? 1 : 0;
  return interpolate(frame, [start, start + frames], [0, 1], {
    ...CLAMP,
    easing: OUT,
  });
}

/** 1 while `frame` is in [from, to), with a fade of `fade` frames at both ends. */
export function during(
  frame: number,
  from: number,
  to: number,
  fade = 10,
): number {
  return Math.min(
    interpolate(frame, [from, from + fade], [0, 1], CLAMP),
    interpolate(frame, [to - fade, to], [1, 0], CLAMP),
  );
}

/** A value that moves through keyframes [frame, value], easing between them. */
export function track(
  frame: number,
  keys: readonly (readonly [number, number])[],
): number {
  const [first] = keys;
  if (!first) return 0;
  if (keys.length === 1) return first[1];
  return interpolate(
    frame,
    keys.map(([at]) => at),
    keys.map(([, value]) => value),
    { ...CLAMP, easing: IN_OUT },
  );
}

/** As much of `text` as has been typed by `frame`. */
export function typed(
  text: string,
  frame: number,
  start: number,
  perSecond = 22,
): string {
  const count = Math.floor(((frame - start) / 30) * perSecond);
  return text.slice(0, Math.max(0, Math.min(text.length, count)));
}

/** The frame on which typing `text` from `start` is done. */
export function typedBy(text: string, start: number, perSecond = 22): number {
  return start + Math.ceil((text.length / perSecond) * 30);
}

/** A text caret that blinks twice a second. */
export function caretOn(frame: number): boolean {
  return Math.floor(frame / 15) % 2 === 0;
}
