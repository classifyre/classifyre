"use client";

import * as React from "react";

import { useCyclingTags } from "@/components/finding-tags";

/**
 * Hero backdrop: the same string-board language as the closing CTA, but with
 * a job to do. Scattered source nodes on the left converge, thread by
 * thread, toward the investigator's case file on the right — "scattered
 * data in, closed cases out", drawn literally. Three evidence pulses travel
 * the convergence threads (SMIL, paused under prefers-reduced-motion), and
 * the lime spotlight follows the pointer like on the closing board.
 *
 * Decorative and click-transparent throughout.
 */

const PINS: readonly { x: number; y: number; end?: boolean }[] = [
  { x: 60, y: 120 },
  { x: 150, y: 300 },
  { x: 90, y: 460 },
  { x: 260, y: 180 },
  { x: 330, y: 360 },
  { x: 240, y: 480 },
  { x: 430, y: 120 },
  { x: 470, y: 280 },
  { x: 400, y: 470 },
  { x: 560, y: 180 },
  { x: 600, y: 380 },
  { x: 540, y: 505 },
  { x: 760, y: 140 },
  { x: 820, y: 300 },
  { x: 780, y: 460 },
  { x: 950, y: 120, end: true },
  { x: 965, y: 300, end: true },
  { x: 945, y: 470, end: true },
];

/** Pins that carry a (rotating) classification label, by pin index. */
const TAGGED: readonly number[] = [0, 1, 2, 3, 4, 5, 7, 9];

const THREADS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [0, 3],
  [3, 6],
  [1, 4],
  [4, 3],
  [2, 5],
  [4, 5],
  [5, 8],
  [4, 8],
  [6, 7],
  [3, 7],
  [7, 9],
  [9, 12],
  [7, 10],
  [10, 11],
  [8, 11],
  [10, 13],
  [12, 15],
  [13, 16],
  [14, 17],
  [11, 14],
  [9, 13],
  [12, 13],
  [13, 14],
];

/** Evidence pulses riding the three convergence threads into the file. */
const FLOWS: readonly { d: string; dur: string; begin: string }[] = [
  { d: "M60 120 L260 180 L470 280 L760 140 L950 120", dur: "7s", begin: "0s" },
  {
    d: "M90 460 L330 360 L600 380 L820 300 L965 300",
    dur: "9s",
    begin: "-3s",
  },
  {
    d: "M240 480 L400 470 L540 505 L780 460 L945 470",
    dur: "8s",
    begin: "-5s",
  },
];

export function HeroBoard() {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const tags = useCyclingTags(TAGGED.length);

  React.useEffect(() => {
    const board = ref.current;
    const section = board?.closest("section");
    if (!board || !section) return;
    // SMIL has no CSS off-switch, so park the pulses for readers who asked
    // for stillness. The pins and threads are already CSS-guarded.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      svgRef.current?.pauseAnimations();
    }
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
        ref={svgRef}
        viewBox="0 0 1000 560"
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
          if (pin.end) return null;
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
                  { "--cl-delay": `${index * 300}ms` } as React.CSSProperties
                }
                fill="var(--color-accent)"
              />
              {label ? (
                <text
                  key={label}
                  x={pin.x + 14}
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
        {FLOWS.map((flow, index) => (
          <circle
            key={index}
            r="4.5"
            fill="var(--color-accent)"
            opacity="0.9"
          >
            <animateMotion
              dur={flow.dur}
              begin={flow.begin}
              repeatCount="indefinite"
              path={flow.d}
            />
          </circle>
        ))}
      </svg>
      <div className="cl-net-spot absolute inset-0" />
    </div>
  );
}
