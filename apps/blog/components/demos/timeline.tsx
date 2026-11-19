"use client";

import * as React from "react";

import { cn } from "@workspace/ui/lib/utils";

import { Micro } from "@/components/landing/motifs";

/**
 * The engine behind the self-running product demos.
 *
 * A demo is a pure function of one number, `t`: milliseconds into its
 * script. This hook advances `t` while the demo is on screen, loops it after
 * a short hold on the final state, and pauses or replays on request. The
 * server renders the final state (`t = duration`), so the HTML a crawler or
 * a no-JS reader gets is the finished screen; reduced motion keeps it there.
 */

const TICK_MS = 40;

export function useTimeline(durationMs: number, holdMs = 2600) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [t, setT] = React.useState(durationMs);
  const [inView, setInView] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [reduced, setReduced] = React.useState(false);
  const started = React.useRef(false);

  React.useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setInView(entry.isIntersecting);
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (reduced || paused || !inView) return;
    if (!started.current) {
      started.current = true;
      setT(0);
    }
    const id = window.setInterval(() => {
      setT((prev) => (prev + TICK_MS > durationMs + holdMs ? 0 : prev + TICK_MS));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [durationMs, holdMs, inView, paused, reduced]);

  return {
    ref,
    t: Math.min(t, durationMs),
    paused,
    reduced,
    toggle: () => setPaused((p) => !p),
    replay: () => {
      started.current = true;
      setPaused(false);
      setT(0);
    },
    /** Jump to `ms` into the script and keep playing from there. */
    seek: (ms: number) => {
      started.current = true;
      setPaused(false);
      setT(ms);
    },
  };
}

/** 0→1 between `at` and `at + dur`, eased. */
export function step(t: number, at: number, dur = 320): number {
  const x = Math.min(1, Math.max(0, (t - at) / dur));
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

/** The first characters of `text` typed from `at`, `cps` a second. */
export function typed(text: string, t: number, at: number, cps = 32): string {
  const n = Math.floor(Math.max(0, t - at) * (cps / 1000));
  return text.slice(0, Math.min(text.length, n));
}

/** When typing `text` from `at` at `cps` finishes. */
export function typedEnd(text: string, at: number, cps = 32): number {
  return at + (text.length / cps) * 1000;
}

const LABELS = {
  en: { pause: "Pause", play: "Play", replay: "Replay" },
  de: { pause: "Pause", play: "Abspielen", replay: "Nochmal" },
} as const;

/**
 * The window a demo plays in: a paper panel with a title strip and the
 * play controls, and the caption under it.
 */
export function DemoFrame({
  timeline,
  title,
  caption,
  locale,
  children,
  className,
}: {
  timeline: ReturnType<typeof useTimeline>;
  title: React.ReactNode;
  caption?: string;
  locale: "en" | "de";
  children: React.ReactNode;
  className?: string;
}) {
  const labels = LABELS[locale];
  return (
    <figure ref={timeline.ref} className={cn("min-w-0", className)}>
      <div className="border-2 border-white/20 bg-white text-[#0a0a0a] shadow-[0_24px_50px_-20px_rgba(0,0,0,0.9)]">
        <div className="flex items-center justify-between gap-3 border-b-2 border-[#0a0a0a] px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden="true" className="flex gap-1">
              <span className="size-2 rounded-full bg-[#0a0a0a]/25" />
              <span className="size-2 rounded-full bg-[#0a0a0a]/25" />
              <span className="size-2 rounded-full bg-[#0a0a0a]/25" />
            </span>
            <span className="truncate font-mono text-[12px] font-semibold">{title}</span>
          </div>
          {timeline.reduced ? null : (
            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={timeline.toggle}
                className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#0a0a0a]/55 hover:text-[#0a0a0a]"
              >
                {timeline.paused ? labels.play : labels.pause}
              </button>
              <button
                type="button"
                onClick={timeline.replay}
                className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#0a0a0a]/55 hover:text-[#0a0a0a]"
              >
                {labels.replay} ↺
              </button>
            </div>
          )}
        </div>
        <div className="min-h-[300px] p-4 sm:p-5">{children}</div>
      </div>
      {caption ? (
        <figcaption className="pt-3">
          <Micro className="text-white/55">{caption}</Micro>
        </figcaption>
      ) : null}
    </figure>
  );
}

/** A blinking caret for typed text, shown only while typing. */
export function Caret({ on }: { on: boolean }) {
  if (!on) return null;
  return <span aria-hidden="true" className="cl-caret ml-px inline-block w-[0.55em] bg-[#0a0a0a] align-[-0.15em]">&nbsp;</span>;
}

/** A button that gets pressed at `at`. */
export function PressButton({
  t,
  at,
  label,
  done,
  className,
}: {
  t: number;
  at: number;
  label: string;
  done?: string;
  className?: string;
}) {
  const pressed = t >= at;
  const press = step(t, at - 120, 120) - step(t, at, 160);
  return (
    <span
      className={cn(
        "inline-flex items-center border-2 border-[#0a0a0a] px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] transition-colors duration-200",
        pressed ? "bg-accent text-black" : "bg-white text-[#0a0a0a]",
        className,
      )}
      style={{ transform: `scale(${1 - press * 0.08})` }}
    >
      {pressed && done ? done : label}
    </span>
  );
}
