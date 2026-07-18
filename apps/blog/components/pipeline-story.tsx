"use client";

import * as React from "react";

import { cn } from "@workspace/ui/lib/utils";

/**
 * Scroll-driven narrative of the Classifyre pipeline
 * (Sources → Assets → Detectors → Findings → Inquiries + Fingerprints →
 * Cases, with the Autopilot working the right-hand side).
 *
 * The story follows one concrete leak — an AWS key in CI logs shipped to an
 * S3 bucket — and the sticky diagram lights up stage by stage as the reader
 * scrolls through the beats. The same incident (inquiry #7, case #42)
 * reappears in the case-graph and Harness sections, so the whole page reads
 * as one continuous investigation.
 */

type StageId =
  | "sources"
  | "assets"
  | "detectors"
  | "findings"
  | "inquiries"
  | "fingerprints"
  | "cases"
  | "autopilot";

type StoryStep = {
  id: string;
  time: string;
  marker: string;
  title: string;
  body: string;
  stages: StageId[];
};

const STORY_STEPS: readonly StoryStep[] = [
  {
    id: "scan",
    time: "23:41",
    marker: "SOURCES → ASSETS",
    title: "A scheduled scan walks the bucket",
    body:
      "Your CI pipelines ship their logs to an S3 bucket, and Classifyre scans it on a schedule — no agents, no data migration. Every log object becomes an asset in the catalog, carrying its metadata: path, size, content type, when it last changed.",
    stages: ["sources", "assets"],
  },
  {
    id: "detect",
    time: "23:44",
    marker: "DETECTORS → FINDINGS",
    title: "The secrets pack recognizes a key",
    body:
      "Detectors read each asset as it lands. The built-in secrets pack matches an AWS access key pasted into a deploy job's log and raises a critical finding — with the exact match, its location, and a deterministic identity so a re-scan updates it instead of duplicating it. Semantic ranking scores it 0.94: novel, high quality, nothing like boilerplate — top of the docket.",
    stages: ["detectors", "findings"],
  },
  {
    id: "inquiry",
    time: "23:44",
    marker: "INQUIRIES",
    title: "A question you already asked gets its answer",
    body:
      "Months ago someone phrased a standing question: “Are credentials leaking through CI logs?” The new finding matches inquiry #7 automatically. No new alert channel, no duplicate monitor — the question you already asked just accumulated evidence.",
    stages: ["inquiries"],
  },
  {
    id: "fingerprint",
    time: "23:45",
    marker: "FINGERPRINTS",
    title: "The same key surfaces somewhere else",
    body:
      "The finding's fingerprint matches a record from a quarterly S3 export scanned last month. Two systems, one leak — connected by identity, not by someone eyeballing two spreadsheets at 2 a.m.",
    stages: ["fingerprints"],
  },
  {
    id: "case",
    time: "23:46",
    marker: "CASES & HYPOTHESES",
    title: "Case #42 opens with two explanations",
    body:
      "“Credential exposure” opens as a case with both findings attached as evidence and two competing hypotheses: the key leaked via CI logs, or it lingers in a stale export. Each hypothesis is pinned to the evidence that supports or contradicts it — and the case starts proposing its own next leads, ranked by importance: semantic neighbours of the evidence plus high-ranking matches from inquiry #7.",
    stages: ["cases"],
  },
  {
    id: "twist",
    time: "23:46",
    marker: "THE TWIST",
    title: "Nobody was at the keyboard",
    body:
      "Steps three through five happened while you slept. Harness AI matched the inquiry, linked the fingerprint, opened the case, and drafted both hypotheses right after the scan — and logged a written rationale for every single move. You arrive in the morning to a case, not a pile of alerts.",
    stages: ["autopilot"],
  },
] as const;

const STAGE_LABELS: Record<StageId, string> = {
  sources: "Sources",
  assets: "Assets",
  detectors: "Detectors",
  findings: "Findings",
  inquiries: "Inquiries",
  fingerprints: "Fingerprints",
  cases: "Cases",
  autopilot: "Autopilot",
};

function stageState(
  stage: StageId,
  activeStep: number,
): "idle" | "visited" | "active" {
  const activeStages = STORY_STEPS[activeStep]?.stages ?? [];
  if (activeStages.includes(stage)) {
    return "active";
  }
  for (let index = 0; index < activeStep; index += 1) {
    if (STORY_STEPS[index]?.stages.includes(stage)) {
      return "visited";
    }
  }
  return "idle";
}

function edgeState(
  from: StageId,
  to: StageId,
  activeStep: number,
): "idle" | "visited" | "active" {
  const toState = stageState(to, activeStep);
  const fromState = stageState(from, activeStep);
  if (toState === "active") {
    return "active";
  }
  if (toState === "visited" && fromState !== "idle") {
    return "visited";
  }
  return "idle";
}

function PipeNode({
  id,
  x,
  y,
  width,
  label,
  sub,
  activeStep,
}: {
  id: StageId;
  x: number;
  y: number;
  width: number;
  label: string;
  sub: string;
  activeStep: number;
}) {
  const height = 56;
  return (
    <g className="cl-pipe-node" data-state={stageState(id, activeStep)}>
      <rect
        className="cl-pipe-box"
        x={x}
        y={y}
        width={width}
        height={height}
        fill="transparent"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <text
        className="cl-pipe-label"
        x={x + width / 2}
        y={y + 24}
        textAnchor="middle"
        fontFamily="var(--font-mono, monospace)"
        fontSize="13"
        fontWeight="700"
        letterSpacing="0.14em"
        fill="currentColor"
      >
        {label}
      </text>
      <text
        className="cl-pipe-sub"
        x={x + width / 2}
        y={y + 42}
        textAnchor="middle"
        fontFamily="var(--font-mono, monospace)"
        fontSize="9.5"
        letterSpacing="0.08em"
        fill="currentColor"
        opacity="0.65"
      >
        {sub}
      </text>
    </g>
  );
}

function PipelineDiagram({ activeStep }: { activeStep: number }) {
  return (
    <svg
      viewBox="0 0 380 640"
      role="img"
      aria-label="Classifyre pipeline: sources to assets to detectors to findings, splitting into inquiries and fingerprints, converging into cases — with the autopilot working the investigation side"
      className="h-auto w-full max-w-95 text-foreground"
    >
      {/* edges */}
      <line
        className="cl-pipe-edge"
        data-state={edgeState("sources", "assets", activeStep)}
        x1="160"
        y1="76"
        x2="160"
        y2="116"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <line
        className="cl-pipe-edge"
        data-state={edgeState("assets", "detectors", activeStep)}
        x1="160"
        y1="172"
        x2="160"
        y2="212"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <line
        className="cl-pipe-edge"
        data-state={edgeState("detectors", "findings", activeStep)}
        x1="160"
        y1="268"
        x2="160"
        y2="308"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <path
        className="cl-pipe-edge"
        data-state={edgeState("findings", "inquiries", activeStep)}
        d="M 140 364 C 110 390, 96 396, 90 424"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <path
        className="cl-pipe-edge"
        data-state={edgeState("findings", "fingerprints", activeStep)}
        d="M 180 364 C 210 390, 224 396, 230 424"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <path
        className="cl-pipe-edge"
        data-state={edgeState("inquiries", "cases", activeStep)}
        d="M 90 480 C 96 508, 110 514, 140 540"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <path
        className="cl-pipe-edge"
        data-state={edgeState("fingerprints", "cases", activeStep)}
        d="M 230 480 C 224 508, 210 514, 180 540"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      />

      {/* nodes */}
      <PipeNode
        id="sources"
        x={60}
        y={20}
        width={200}
        label="SOURCES"
        sub="s3 bucket · ci-logs"
        activeStep={activeStep}
      />
      <PipeNode
        id="assets"
        x={60}
        y={116}
        width={200}
        label="ASSETS"
        sub="items + metadata"
        activeStep={activeStep}
      />
      <PipeNode
        id="detectors"
        x={60}
        y={212}
        width={200}
        label="DETECTORS"
        sub="secrets pack"
        activeStep={activeStep}
      />
      <PipeNode
        id="findings"
        x={60}
        y={308}
        width={200}
        label="FINDINGS"
        sub="critical · aws key"
        activeStep={activeStep}
      />
      <PipeNode
        id="inquiries"
        x={16}
        y={424}
        width={148}
        label="INQUIRIES"
        sub="inquiry #7"
        activeStep={activeStep}
      />
      <PipeNode
        id="fingerprints"
        x={176}
        y={424}
        width={148}
        label="FINGERPRINTS"
        sub="same key · 2 systems"
        activeStep={activeStep}
      />
      <PipeNode
        id="cases"
        x={60}
        y={540}
        width={200}
        label="CASES"
        sub="case #42 · 2 hypotheses"
        activeStep={activeStep}
      />

      {/* autopilot bracket around the investigation side */}
      <g
        className="cl-pipe-autopilot"
        data-state={stageState("autopilot", activeStep) === "active" ? "active" : "idle"}
      >
        <rect
          className="cl-pipe-bracket"
          x="6"
          y="408"
          width="368"
          height="204"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="8 7"
        />
        {/* cat-ear silhouette */}
        <path
          d="M 322 396 l 7 -12 l 7 8 l 6 -8 l 7 12 z"
          fill="var(--color-accent)"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <text
          className="cl-pipe-ap-label"
          x="18"
          y="400"
          fontFamily="var(--font-mono, monospace)"
          fontSize="10.5"
          fontWeight="700"
          letterSpacing="0.2em"
          fill="currentColor"
        >
          HARNESS AUTOPILOT WORKS THIS SIDE
        </text>
      </g>
    </svg>
  );
}

export function PipelineStory() {
  const [activeStep, setActiveStep] = React.useState(0);
  const stepRefs = React.useRef<(HTMLDivElement | null)[]>([]);

  React.useEffect(() => {
    const nodes = stepRefs.current.filter(
      (node): node is HTMLDivElement => node !== null,
    );
    if (nodes.length === 0) {
      return;
    }

    // Track which step sits closest to the middle of the viewport.
    const visibility = new Map<Element, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visibility.set(entry.target, entry.intersectionRatio);
        }
        let bestIndex = -1;
        let bestRatio = 0;
        nodes.forEach((node, index) => {
          const ratio = visibility.get(node) ?? 0;
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestIndex = index;
          }
        });
        if (bestIndex >= 0) {
          setActiveStep(bestIndex);
        }
      },
      {
        rootMargin: "-25% 0px -35% 0px",
        threshold: [0, 0.2, 0.4, 0.6, 0.8, 1],
      },
    );

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  const active = STORY_STEPS[activeStep] ?? STORY_STEPS[0]!;

  return (
    <div className="relative">
      {/* Mobile progress rail (diagram is desktop-only) */}
      <div className="sticky top-16 z-10 -mx-2 mb-6 border-2 border-border bg-background px-3 py-2.5 lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em]">
            {String(activeStep + 1).padStart(2, "0")}/06 ·{" "}
            {active.stages
              .map((stage) => STAGE_LABELS[stage])
              .join(" + ")}
          </span>
          <div className="flex flex-1 items-center justify-end gap-1">
            {STORY_STEPS.map((step, index) => (
              <span
                key={step.id}
                className={cn(
                  "h-1.5 flex-1 max-w-8 border border-border transition-colors duration-300",
                  index <= activeStep ? "bg-accent" : "bg-foreground/10",
                )}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-12">
        {/* Sticky diagram */}
        <div className="hidden lg:block">
          <div className="sticky top-24">
            <div className="border-2 border-border bg-background p-5 shadow-[6px_6px_0_var(--color-border)]">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                  Evidence board
                </span>
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                  {String(activeStep + 1).padStart(2, "0")} / 06
                </span>
              </div>
              <PipelineDiagram activeStep={activeStep} />
            </div>
          </div>
        </div>

        {/* Story beats */}
        <div className="flex flex-col gap-5 lg:gap-8 lg:py-10">
          {STORY_STEPS.map((step, index) => (
            <div
              key={step.id}
              ref={(node) => {
                stepRefs.current[index] = node;
              }}
              className={cn(
                "cl-step border-2 border-border bg-background p-5 sm:p-6",
                index === STORY_STEPS.length - 1 && "bg-accent/10",
              )}
              data-active={index === activeStep ? "true" : "false"}
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-[11px] font-bold tracking-[0.1em] text-muted-foreground">
                  {step.time}
                </span>
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-accent-foreground/60 dark:text-accent">
                  {step.marker}
                </span>
              </div>
              <p className="mt-2 font-serif text-lg font-black uppercase leading-tight tracking-[0.03em] sm:text-xl">
                {step.title}
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-[15px] sm:leading-7">
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
