import type { CSSProperties, ReactNode } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

/*
 * Everything here is a function of the current frame. CSS transitions and
 * keyframe animations run on wall-clock time, which a renderer that screenshots
 * frames out of order does not have — they come out frozen or flickering.
 */

interface EnterOptions {
  /** Frames to wait before starting. */
  delay?: number;
  /** Higher settles sooner and with less overshoot. */
  damping?: number;
}

/** 0 → 1 on a spring, starting `delay` frames into the current sequence. */
export function useEnter({ delay = 0, damping = 200 }: EnterOptions = {}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return spring({ frame: frame - delay, fps, config: { damping } });
}

interface RiseProps extends EnterOptions {
  /** Pixels travelled on the way in. */
  distance?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/** Fades in while sliding up into place. */
export function Rise({
  delay,
  damping,
  distance = 24,
  className,
  style,
  children,
}: RiseProps) {
  const progress = useEnter({ delay, damping });

  return (
    <div
      className={className}
      style={{
        ...style,
        opacity: progress,
        transform: `translateY(${interpolate(progress, [0, 1], [distance, 0])}px)`,
      }}
    >
      {children}
    </div>
  );
}

interface PopProps extends EnterOptions {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/** Scales in from slightly small, with a little overshoot. */
export function Pop({
  delay,
  damping = 14,
  className,
  style,
  children,
}: PopProps) {
  const progress = useEnter({ delay, damping });

  return (
    <div
      className={className}
      style={{
        ...style,
        opacity: interpolate(progress, [0, 0.4], [0, 1], {
          extrapolateRight: "clamp",
        }),
        transform: `scale(${interpolate(progress, [0, 1], [0.8, 1])})`,
      }}
    >
      {children}
    </div>
  );
}

interface CountOptions {
  delay?: number;
  durationInFrames?: number;
}

/** A whole number climbing to `target`, for figures that should land rather than appear. */
export function useCount(
  target: number,
  { delay = 0, durationInFrames = 30 }: CountOptions = {},
) {
  const frame = useCurrentFrame();
  const eased = interpolate(frame - delay, [0, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });

  return Math.round(target * eased);
}
