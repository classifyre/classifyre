import gsap from "gsap";
import { useLayoutEffect, useRef } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

/*
 * GSAP is how this studio moves things that are more than a fade: staggers,
 * sequenced timelines, rich eases (expo, back, elastic, custom). GSAP runs on
 * its own ticker by default, which a renderer that screenshots frames out of
 * order does not have. So no timeline here ever plays: each is built paused
 * and put at `frame / fps` seconds every time the frame changes. The frame is
 * the only clock.
 */

// A paused timeline never reads the ticker, but keep it from skipping time.
gsap.ticker.lagSmoothing(0);

/**
 * Builds a GSAP timeline once, scoped to the returned ref, and seeks it to the
 * current frame on every render. Select with strings inside `build` (they
 * resolve under the ref), and position tweens in seconds as usual.
 *
 *   const root = useTimeline<HTMLDivElement>((tl) => {
 *     tl.from(".card", { y: 40, opacity: 0, stagger: 0.08, ease: "expo.out" });
 *   });
 *   return <div ref={root}>…</div>;
 */
export function useTimeline<T extends HTMLElement = HTMLDivElement>(
  build: (tl: gsap.core.Timeline) => void,
) {
  const scope = useRef<T>(null);
  const timeline = useRef<gsap.core.Timeline | null>(null);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ paused: true });
      build(tl);
      timeline.current = tl;
    }, scope);
    return () => {
      timeline.current = null;
      ctx.revert();
    };
    // Built once per mount: the timeline is a function of the frame, not of props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    // suppressEvents=false so callbacks and onUpdate follow the frame too.
    timeline.current?.seek(frame / fps, false);
  }, [frame, fps]);

  return scope;
}

/** A GSAP ease ("expo.out", "back.out(1.7)", "power3.inOut"…) as a function of 0 → 1. */
export function gsapEase(name: string): (t: number) => number {
  return gsap.parseEase(name);
}

/** 0 → 1 between `start` and `start + frames` on a named GSAP ease. */
export function tween(
  frame: number,
  start: number,
  frames: number,
  ease = "power3.out",
): number {
  const t = Math.min(1, Math.max(0, (frame - start) / frames));
  return gsap.parseEase(ease)(t);
}

export { gsap };
