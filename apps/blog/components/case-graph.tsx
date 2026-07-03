"use client";

import * as React from "react";

/**
 * Animated case graph for case #42 — the same investigation the scroll
 * narrative and the Harness recorder walk through. When the figure enters
 * the viewport, the graph assembles itself in evidence order: case, then
 * hypotheses, then edges, then findings, then the analyst and fingerprint
 * links, and finally the autopilot stamp. Animations live in landing.css
 * (`.cl-cg`); strokes use currentColor so the graph adapts to both themes.
 */

const SEVERITY = {
  critical: "#ff2b2b",
  high: "#ff6b35",
  medium: "#f5a623",
  low: "#0ea5e9",
} as const;

type FindingNode = {
  cx: number;
  cy: number;
  fill: string;
  label: string;
  labelFill: string;
  delay: number;
  pulse?: boolean;
};

const FINDINGS: readonly FindingNode[] = [
  {
    cx: 110,
    cy: 340,
    fill: SEVERITY.critical,
    label: "SEC",
    labelFill: "#ffffff",
    delay: 1500,
    pulse: true,
  },
  { cx: 210, cy: 350, fill: SEVERITY.high, label: "PII", labelFill: "#0a0a0a", delay: 1620 },
  { cx: 470, cy: 350, fill: SEVERITY.medium, label: "IBN", labelFill: "#0a0a0a", delay: 1740 },
  { cx: 590, cy: 340, fill: SEVERITY.low, label: "SEC", labelFill: "#0a0a0a", delay: 1860 },
] as const;

function delayStyle(delayMs: number, length?: number) {
  return {
    "--cl-delay": `${delayMs}ms`,
    ...(length !== undefined ? { "--cl-len": `${length}` } : {}),
  } as React.CSSProperties;
}

export function CaseGraph() {
  const ref = React.useRef<SVGSVGElement | null>(null);
  const [inView, setInView] = React.useState(false);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <svg
      ref={ref}
      viewBox="0 0 720 460"
      role="img"
      aria-label="Case graph showing case 42 linked to two hypotheses with severity-colored findings, an analyst link, and a fingerprint match drawn by the autopilot"
      className="cl-cg h-auto w-full"
      data-inview={inView ? "true" : "false"}
    >
      <defs>
        <pattern id="cg-dots" width="26" height="26" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.5" fill="currentColor" opacity="0.12" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="720" height="460" fill="url(#cg-dots)" />

      {/* edges: case -> hypotheses */}
      <line
        data-anim="draw"
        style={delayStyle(500, 210)}
        x1="360"
        y1="92"
        x2="190"
        y2="196"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.45"
      />
      <line
        data-anim="draw"
        style={delayStyle(500, 210)}
        x1="360"
        y1="92"
        x2="530"
        y2="196"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.45"
      />

      {/* edges: hypotheses -> findings */}
      <line
        data-anim="draw"
        style={delayStyle(1150, 130)}
        x1="190"
        y1="252"
        x2="110"
        y2="340"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.45"
      />
      <line
        data-anim="draw"
        style={delayStyle(1250, 110)}
        x1="190"
        y1="252"
        x2="210"
        y2="350"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.45"
      />
      <line
        data-anim="draw"
        style={delayStyle(1350, 130)}
        x1="530"
        y1="252"
        x2="470"
        y2="350"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.45"
      />
      <line
        data-anim="draw"
        style={delayStyle(1450, 120)}
        x1="530"
        y1="252"
        x2="590"
        y2="340"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.45"
      />

      {/* manual analyst link (dashed amber, marching once drawn) */}
      <line
        data-anim="draw"
        style={delayStyle(2300, 270)}
        x1="210"
        y1="350"
        x2="470"
        y2="350"
        stroke="#d97706"
        strokeWidth="2.5"
        strokeDasharray="7 6"
      />
      <text
        data-anim="fade"
        style={delayStyle(2550)}
        x="340"
        y="338"
        textAnchor="middle"
        fontFamily="var(--font-mono, monospace)"
        fontSize="10"
        fill="#d97706"
        letterSpacing="0.12em"
      >
        ANALYST LINK
      </text>

      {/* fingerprint match: the same key seen in two systems */}
      <path
        data-anim="draw"
        style={delayStyle(2700, 560)}
        d="M 110 340 C 180 440, 520 440, 590 340"
        fill="none"
        stroke="#a855f7"
        strokeWidth="2.5"
        strokeDasharray="3 5"
      />
      <text
        data-anim="fade"
        style={delayStyle(3000)}
        x="360"
        y="432"
        textAnchor="middle"
        fontFamily="var(--font-mono, monospace)"
        fontSize="10"
        fill="#a855f7"
        letterSpacing="0.12em"
      >
        FINGERPRINT MATCH · SAME KEY, TWO SYSTEMS
      </text>

      {/* case node */}
      <g data-anim="pop" style={delayStyle(100)}>
        <rect
          x="252"
          y="34"
          width="216"
          height="58"
          fill="var(--color-accent)"
          stroke="currentColor"
          strokeWidth="3"
        />
        <rect
          x="260"
          y="42"
          width="216"
          height="58"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.35"
        />
        <text
          x="360"
          y="58"
          textAnchor="middle"
          fontFamily="var(--font-mono, monospace)"
          fontSize="10"
          fill="#0a0a0a"
          letterSpacing="0.2em"
          fontWeight="700"
        >
          CASE #42 · OPEN
        </text>
        <text
          x="360"
          y="78"
          textAnchor="middle"
          fontFamily="var(--font-mono, monospace)"
          fontSize="12"
          fill="#0a0a0a"
          fontWeight="700"
        >
          Credential exposure
        </text>
      </g>

      {/* hypothesis 1 */}
      <g data-anim="pop" style={delayStyle(750)}>
        <rect
          x="92"
          y="196"
          width="196"
          height="56"
          rx="4"
          fill="var(--color-background)"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <text
          x="190"
          y="219"
          textAnchor="middle"
          fontFamily="var(--font-mono, monospace)"
          fontSize="10"
          fill="currentColor"
          opacity="0.6"
          letterSpacing="0.18em"
        >
          HYPOTHESIS 1
        </text>
        <text
          x="190"
          y="238"
          textAnchor="middle"
          fontFamily="var(--font-mono, monospace)"
          fontSize="12"
          fill="currentColor"
          fontWeight="700"
        >
          Leak via CI logs
        </text>
      </g>

      {/* hypothesis 2 */}
      <g data-anim="pop" style={delayStyle(900)}>
        <rect
          x="432"
          y="196"
          width="196"
          height="56"
          rx="4"
          fill="var(--color-background)"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <text
          x="530"
          y="219"
          textAnchor="middle"
          fontFamily="var(--font-mono, monospace)"
          fontSize="10"
          fill="currentColor"
          opacity="0.6"
          letterSpacing="0.18em"
        >
          HYPOTHESIS 2
        </text>
        <text
          x="530"
          y="238"
          textAnchor="middle"
          fontFamily="var(--font-mono, monospace)"
          fontSize="12"
          fill="currentColor"
          fontWeight="700"
        >
          Stale S3 export
        </text>
      </g>

      {/* findings */}
      {FINDINGS.map((finding) => (
        <g key={`${finding.label}-${finding.cx}`}>
          {finding.pulse ? (
            <circle
              className="cl-cg-pulse"
              cx={finding.cx}
              cy={finding.cy}
              r="20"
              fill="none"
              stroke={finding.fill}
              strokeWidth="2"
              opacity="0"
            />
          ) : null}
          <g data-anim="pop" style={delayStyle(finding.delay)}>
            <circle
              cx={finding.cx}
              cy={finding.cy}
              r="20"
              fill={finding.fill}
              stroke="currentColor"
              strokeWidth="2.5"
            />
            <text
              x={finding.cx}
              y={finding.cy + 4}
              textAnchor="middle"
              fontFamily="var(--font-mono, monospace)"
              fontSize="10"
              fill={finding.labelFill}
              fontWeight="700"
            >
              {finding.label}
            </text>
          </g>
        </g>
      ))}

      {/* autopilot stamp near hypothesis 2 */}
      <g data-anim="stamp" style={delayStyle(3300)}>
        <rect
          x="560"
          y="160"
          width="118"
          height="24"
          fill="var(--color-accent)"
          stroke="currentColor"
          strokeWidth="2"
        />
        <text
          x="619"
          y="176"
          textAnchor="middle"
          fontFamily="var(--font-mono, monospace)"
          fontSize="9"
          fill="#0a0a0a"
          letterSpacing="0.14em"
          fontWeight="700"
        >
          BY AUTOPILOT
        </text>
        <line
          x1="600"
          y1="184"
          x2="556"
          y2="196"
          stroke="currentColor"
          strokeWidth="1.5"
          opacity="0.5"
        />
      </g>
    </svg>
  );
}
