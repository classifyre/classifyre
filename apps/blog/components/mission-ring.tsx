import type { CSSProperties } from "react";

/**
 * The Harness "night shift" ring: five mission agents orbiting a shared
 * core — the long-lived memory and the server-composed system brief —
 * with the investigator mascot at the center. Each node glows in sequence
 * (CSS keyframes in landing.css, staggered by --cl-delay), tracing one
 * full autopilot cycle: INQUIRY → CASE → CONFIG → DETECTOR → DREAM.
 *
 * Pure SVG + CSS, no client JS. Strokes use currentColor so the ring
 * adapts to the section it sits in, in both themes.
 */

const MISSIONS = [
  { num: "01", label: "INQUIRY", x: 210, y: 60, labelX: 210, labelY: 22 },
  { num: "02", label: "CASE", x: 343, y: 157, labelX: 343, labelY: 116 },
  { num: "03", label: "CONFIG", x: 292, y: 313, labelX: 292, labelY: 360 },
  { num: "04", label: "DETECTOR", x: 128, y: 313, labelX: 128, labelY: 360 },
  { num: "05", label: "DREAM", x: 77, y: 157, labelX: 77, labelY: 116 },
] as const;

export function MissionRing() {
  return (
    <svg
      viewBox="0 0 420 400"
      role="img"
      aria-label="Five Harness AI missions — inquiry, case, config, detector author, and dream — cycling around a shared memory and system brief, with the Classifyre investigator at the center"
      className="h-auto w-full max-w-105"
    >
      {/* rotating dashed orbit */}
      <g className="cl-rotate-slow" style={{ transformOrigin: "210px 200px" }}>
        <circle
          cx="210"
          cy="200"
          r="140"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="10 8"
          opacity="0.4"
        />
      </g>
      <g className="cl-rotate-slower" style={{ transformOrigin: "210px 200px" }}>
        <circle
          cx="210"
          cy="200"
          r="108"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="2 10"
          opacity="0.35"
        />
      </g>

      {/* center: the investigator over its memory core */}
      <defs>
        <clipPath id="mr-center">
          <circle cx="210" cy="184" r="52" />
        </clipPath>
      </defs>
      <circle
        cx="210"
        cy="184"
        r="56"
        fill="var(--color-accent)"
        opacity="0.2"
      />
      <circle
        cx="210"
        cy="184"
        r="52"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <image
        href="/clasifyre_icon.png"
        x="158"
        y="132"
        width="104"
        height="104"
        clipPath="url(#mr-center)"
      />
      <g>
        <rect
          x="146"
          y="248"
          width="60"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          opacity="0.7"
        />
        <text
          x="176"
          y="260.5"
          textAnchor="middle"
          fontFamily="var(--font-mono, monospace)"
          fontSize="8.5"
          fontWeight="700"
          letterSpacing="0.12em"
          fill="currentColor"
        >
          MEMORY
        </text>
        <rect
          x="212"
          y="248"
          width="82"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          opacity="0.7"
        />
        <text
          x="253"
          y="260.5"
          textAnchor="middle"
          fontFamily="var(--font-mono, monospace)"
          fontSize="8.5"
          fontWeight="700"
          letterSpacing="0.12em"
          fill="currentColor"
        >
          SYSTEM BRIEF
        </text>
      </g>

      {/* mission nodes */}
      {MISSIONS.map((mission, index) => (
        <g
          key={mission.num}
          className="cl-mission"
          style={{ "--cl-delay": `${index * 2.5}s` } as CSSProperties}
        >
          <circle
            className="cl-mission-dot"
            cx={mission.x}
            cy={mission.y}
            r="24"
            fill="transparent"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <text
            className="cl-mission-num"
            x={mission.x}
            y={mission.y + 5}
            textAnchor="middle"
            fontFamily="var(--font-mono, monospace)"
            fontSize="13"
            fontWeight="700"
            fill="currentColor"
          >
            {mission.num}
          </text>
          <text
            x={mission.labelX}
            y={mission.labelY}
            textAnchor="middle"
            fontFamily="var(--font-mono, monospace)"
            fontSize="11"
            fontWeight="700"
            letterSpacing="0.18em"
            fill="currentColor"
          >
            {mission.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
