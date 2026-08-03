import type { CSSProperties } from "react";

/**
 * The evidence board: one static read of the whole pipeline, from the
 * systems you connect down to a case somebody can actually work.
 *
 * This used to be a scroll-driven narrative pinned to one specific leak
 * (an AWS key in CI logs). The story made the diagram look like it only
 * handled that one shape of investigation, so the beats are gone and the
 * node captions now describe the general case. Edges draw themselves once
 * the board scrolls into view — see `.cl-board` in landing.css — and the
 * two nodes you actually live in, FINDINGS and CASES, sit filled in accent.
 */

type BoardNode = {
  label: string;
  sub: string;
  x: number;
  y: number;
  width: number;
  /** Filled in accent — the two nodes the product is really about. */
  primary?: boolean;
};

const NODE_HEIGHT = 52;

const NODES: readonly BoardNode[] = [
  {
    label: "SOURCES",
    sub: "databases · files · saas",
    x: 80,
    y: 16,
    width: 200,
  },
  { label: "ASSETS", sub: "items + metadata", x: 80, y: 104, width: 200 },
  { label: "DETECTORS", sub: "built-in + your own", x: 80, y: 192, width: 200 },
  {
    label: "FINDINGS",
    sub: "ranked by importance",
    x: 80,
    y: 280,
    width: 200,
    primary: true,
  },
  { label: "INQUIRIES", sub: "standing questions", x: 14, y: 380, width: 156 },
  {
    label: "FINGERPRINTS",
    sub: "one value, many systems",
    x: 190,
    y: 380,
    width: 156,
  },
  {
    label: "CASES",
    sub: "evidence + hypotheses",
    x: 80,
    y: 472,
    width: 200,
    primary: true,
  },
] as const;

/** `d` plus the rough path length, so the draw-on animation lands evenly. */
const EDGES: readonly { d: string; len: number }[] = [
  { d: "M 180 68 L 180 104", len: 36 },
  { d: "M 180 156 L 180 192", len: 36 },
  { d: "M 180 244 L 180 280", len: 36 },
  { d: "M 162 332 C 132 350, 100 356, 92 380", len: 90 },
  { d: "M 198 332 C 228 350, 260 356, 268 380", len: 90 },
  { d: "M 92 432 C 100 456, 132 458, 162 472", len: 90 },
  { d: "M 268 432 C 260 456, 228 458, 198 472", len: 90 },
] as const;

export function EvidenceBoard() {
  return (
    <svg
      viewBox="0 0 360 566"
      role="img"
      aria-label="The Classifyre pipeline: sources become assets, detectors raise findings, findings feed inquiries and fingerprints, and both converge into cases — with the autopilot working the investigation half"
      className="cl-board h-auto w-full text-foreground"
    >
      {EDGES.map((edge, index) => (
        <path
          key={edge.d}
          className="cl-board-edge"
          d={edge.d}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          style={
            {
              "--cl-len": edge.len,
              "--cl-delay": `${160 + index * 90}ms`,
            } as CSSProperties
          }
        />
      ))}

      {/* The autopilot does its work on the investigation half of the board. */}
      <g className="cl-board-frame">
        <rect
          x="4"
          y="362"
          width="352"
          height="196"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="8 7"
          opacity="0.45"
        />
        {/* cat-ear silhouette, the autopilot's tell */}
        <path
          d="M 318 354 l 7 -12 l 7 8 l 6 -8 l 7 12 z"
          fill="var(--color-accent)"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        {/* Sits along the bottom rail, clear of the converging edges above. */}
        <text
          x="16"
          y="548"
          fontFamily="var(--font-mono, monospace)"
          fontSize="10.5"
          fontWeight="700"
          letterSpacing="0.2em"
          fill="currentColor"
          opacity="0.7"
        >
          AUTOPILOT WORKS THIS SIDE
        </text>
      </g>

      {NODES.map((node, index) => (
        <g
          key={node.label}
          className="cl-board-node"
          style={{ "--cl-delay": `${index * 90}ms` } as CSSProperties}
        >
          <rect
            x={node.x}
            y={node.y}
            width={node.width}
            height={NODE_HEIGHT}
            fill={node.primary ? "var(--color-accent)" : "transparent"}
            stroke={node.primary ? "var(--color-accent)" : "currentColor"}
            strokeWidth="2.5"
          />
          <text
            x={node.x + node.width / 2}
            y={node.y + 23}
            textAnchor="middle"
            fontFamily="var(--font-mono, monospace)"
            fontSize="13"
            fontWeight="700"
            letterSpacing="0.14em"
            fill={node.primary ? "#0a0a0a" : "currentColor"}
          >
            {node.label}
          </text>
          <text
            x={node.x + node.width / 2}
            y={node.y + 40}
            textAnchor="middle"
            fontFamily="var(--font-mono, monospace)"
            fontSize="9.5"
            letterSpacing="0.06em"
            fill={node.primary ? "#0a0a0a" : "currentColor"}
            opacity={node.primary ? 0.72 : 0.6}
          >
            {node.sub}
          </text>
        </g>
      ))}
    </svg>
  );
}
