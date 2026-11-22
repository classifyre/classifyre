"use client";

import * as React from "react";

import type { Locale } from "@/lib/locale";

/**
 * Subtle architectural backdrop for dark sections: fine structural lines and
 * muted accent intersections that give depth without competing with headlines
 * or interactive product previews.
 */

const NODES: readonly { x: number; y: number }[] = [
  { x: 110, y: 95 },
  { x: 290, y: 205 },
  { x: 190, y: 390 },
  { x: 470, y: 120 },
  { x: 640, y: 265 },
  { x: 520, y: 430 },
  { x: 810, y: 145 },
  { x: 910, y: 340 },
];

const LINKS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, 3],
  [1, 2],
  [1, 3],
  [1, 4],
  [3, 4],
  [3, 6],
  [4, 5],
  [4, 6],
  [4, 7],
  [6, 7],
];

export function ClosingBoard({ locale: _locale = "en" }: { locale?: Locale }) {
  return (
    <div aria-hidden="true" className="cl-net pointer-events-none absolute inset-0">
      <div className="landing-grid absolute inset-0 opacity-[0.07]" />
      <svg
        viewBox="0 0 1000 520"
        preserveAspectRatio="xMidYMid slice"
        className="cl-net-svg absolute inset-x-0 top-0 h-full max-h-[820px] w-full opacity-55"
      >
        {LINKS.flatMap(([from, to], index) => {
          const a = NODES[from];
          const b = NODES[to];
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
              strokeWidth="1"
            />,
          ];
        })}
        {NODES.map((node, index) => (
          <rect
            key={index}
            x={node.x - 4}
            y={node.y - 4}
            width={8}
            height={8}
            className="cl-pin-pulse"
            style={
              { "--cl-delay": `${index * 450}ms` } as React.CSSProperties
            }
            fill="var(--color-accent)"
          />
        ))}
      </svg>
    </div>
  );
}
