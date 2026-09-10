"use client";

import * as React from "react";

import { useCyclingTags } from "@/components/finding-tags";

/**
 * Interactive backdrop for the closing CTA: a detective's string board —
 * evidence pins joined by dashed threads on the black signal panel.
 *
 * A lime spotlight follows the pointer across the board (CSS vars updated
 * through a ref, so no re-renders), the pins breathe on a staggered loop,
 * and the classification labels rotate through fresh findings every few
 * seconds, so the panel feels alive even without a pointer. Everything is
 * decorative and pointer-transparent; the CTAs stay clickable.
 */

const PINS: readonly { x: number; y: number }[] = [
  { x: 70, y: 80 },
  { x: 215, y: 195 },
  { x: 140, y: 365 },
  { x: 335, y: 110 },
  { x: 465, y: 250 },
  { x: 415, y: 435 },
  { x: 600, y: 130 },
  { x: 705, y: 320 },
  { x: 620, y: 455 },
  { x: 815, y: 175 },
  { x: 905, y: 365 },
  { x: 950, y: 95 },
];

/** Pins that carry a (rotating) classification label, by pin index. */
const TAGGED: readonly number[] = [0, 2, 3, 4, 6, 7, 9];

const THREADS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, 3],
  [1, 4],
  [2, 1],
  [2, 5],
  [3, 4],
  [4, 6],
  [4, 7],
  [5, 7],
  [5, 8],
  [6, 9],
  [7, 9],
  [7, 10],
  [8, 10],
  [9, 11],
];

export function ClosingBoard() {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const tags = useCyclingTags(TAGGED.length);

  // Track the pointer across the whole CTA section, not just the board
  // itself — the board is click-transparent so it never sees the events.
  React.useEffect(() => {
    const board = ref.current;
    const section = board?.closest("section");
    if (!board || !section) return;
    const onMove = (event: PointerEvent) => {
      const rect = section.getBoundingClientRect();
      const mx = ((event.clientX - rect.left) / rect.width) * 100;
      const my = ((event.clientY - rect.top) / rect.height) * 100;
      board.style.setProperty("--mx", `${mx.toFixed(1)}%`);
      board.style.setProperty("--my", `${my.toFixed(1)}%`);
      board.dataset.lit = "true";
    };
    const onLeave = () => {
      board.dataset.lit = "false";
    };
    section.addEventListener("pointermove", onMove);
    section.addEventListener("pointerleave", onLeave);
    return () => {
      section.removeEventListener("pointermove", onMove);
      section.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="cl-net pointer-events-none absolute inset-0"
    >
      <svg
        viewBox="0 0 1000 520"
        preserveAspectRatio="xMidYMid slice"
        className="cl-net-svg absolute inset-0 h-full w-full"
      >
        {THREADS.flatMap(([from, to], index) => {
          const a = PINS[from];
          const b = PINS[to];
          if (!a || !b) return [];
          return [
            <line
              key={index}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className="cl-thread"
              stroke="currentColor"
              strokeWidth="1.5"
            />,
          ];
        })}
        {PINS.map((pin, index) => {
          const slot = TAGGED.indexOf(index);
          const label = slot >= 0 ? (tags[slot] ?? "") : "";
          return (
            <g key={index}>
              <rect
                x={pin.x - 6}
                y={pin.y - 6}
                width={12}
                height={12}
                className="cl-pin-pulse"
                style={
                  { "--cl-delay": `${index * 380}ms` } as React.CSSProperties
                }
                fill="var(--color-accent)"
              />
              {label ? (
                <text
                  key={label}
                  x={pin.x + 12}
                  y={pin.y + 4}
                  className="cl-tag-swap"
                  fontFamily="var(--font-mono, monospace)"
                  fontSize="13"
                  letterSpacing="0.14em"
                  fill="currentColor"
                  opacity="0.5"
                >
                  {label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {/* Exhibit stamps, pinned to the corners of the file. */}
      <span className="cl-exhibit left-6 top-6 hidden -rotate-6 md:block">
        Exhibit A
      </span>
      <span className="cl-exhibit bottom-6 right-6 hidden rotate-3 md:block">
        Confirmed
      </span>
      {/* The pointer spotlight — fades in on first move, out on leave. */}
      <div className="cl-net-spot absolute inset-0" />
    </div>
  );
}
