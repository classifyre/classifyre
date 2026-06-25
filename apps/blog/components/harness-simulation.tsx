"use client";

import * as React from "react";

import { cn } from "@workspace/ui/lib/utils";

type HarnessOutcome = "APPLIED" | "OBSERVE-ONLY" | "DEDUPED";

type HarnessAgent =
  | "INQUIRY"
  | "CASE"
  | "CONFIG"
  | "DETECTOR_AUTHOR"
  | "DREAM";

type HarnessEvent = {
  id: string;
  delayMs: number;
  agent: HarnessAgent;
  tool: string;
  action: string;
  rationale: string;
  outcome: HarnessOutcome;
};

/**
 * Scripted "flight recorder" of one Harness AI cycle. Each entry is a single
 * agent decision: a tool call, what it did, the written rationale, and the
 * audited outcome. The content tracks the real mission flow (inquiry dedupe →
 * case building → cold-start source tuning → detector authoring → memory
 * consolidation) so the playback reads like a genuine run, not filler.
 */
const HARNESS_EVENTS: readonly HarnessEvent[] = [
  {
    id: "inquiry-search",
    delayMs: 700,
    agent: "INQUIRY",
    tool: "findings.search",
    action: "Pulled 14 new findings from the latest scan.",
    rationale:
      "Start every cycle from what actually changed, not the whole backlog.",
    outcome: "APPLIED",
  },
  {
    id: "inquiry-dedupe",
    delayMs: 1500,
    agent: "INQUIRY",
    tool: "inquiries.enrich",
    action:
      'Matched "credentials in CI logs" to existing inquiry #7 instead of opening a new one.',
    rationale:
      "A standing question already watches this topic — a second monitor would just add noise.",
    outcome: "DEDUPED",
  },
  {
    id: "case-create",
    delayMs: 1600,
    agent: "CASE",
    tool: "cases.create",
    action: 'Opened case #42 "Credential exposure" from the matched findings.',
    rationale:
      "Three correlated secret findings across two sources is an incident, not a row in a table.",
    outcome: "APPLIED",
  },
  {
    id: "case-hypotheses",
    delayMs: 1500,
    agent: "CASE",
    tool: "cases.add_hypothesis",
    action: 'Drafted two competing hypotheses: "Leak via CI logs" and "Stale S3 export".',
    rationale:
      "Pin explanations to evidence early so the team can confirm or kill each one.",
    outcome: "APPLIED",
  },
  {
    id: "case-attach",
    delayMs: 1300,
    agent: "CASE",
    tool: "cases.attach_findings",
    action: "Linked the critical secret finding as supporting evidence for hypothesis 1.",
    rationale: "Every claim in the case should trace back to a raw detection.",
    outcome: "APPLIED",
  },
  {
    id: "config-profile",
    delayMs: 1600,
    agent: "CONFIG",
    tool: "assets.profile",
    action:
      "Profiled the Snowflake source — 2.1M assets ingested, zero findings produced.",
    rationale:
      "A silent source isn't clean, it's unconfigured. Look at the data shape before guessing.",
    outcome: "APPLIED",
  },
  {
    id: "config-tune",
    delayMs: 1500,
    agent: "CONFIG",
    tool: "config.tune_source",
    action: "Enabled the built-in SECRETS and PII packs, then queued a re-scan.",
    rationale:
      "The sampled columns are full of tokens and emails — these detectors fit the data.",
    outcome: "APPLIED",
  },
  {
    id: "detector-test",
    delayMs: 1600,
    agent: "DETECTOR_AUTHOR",
    tool: "detector.test",
    action: 'Dry-ran a new "EU IBAN" ruleset against sampled text — 9/10 matches clean.',
    rationale:
      "Built-in packs miss EU-country IBAN formats; test a candidate before shipping it.",
    outcome: "APPLIED",
  },
  {
    id: "detector-create",
    delayMs: 1500,
    agent: "DETECTOR_AUTHOR",
    tool: "detector.create",
    action: "Deployed the EU IBAN detector and wired it into the Snowflake source.",
    rationale:
      "Marked pending-verification — next cycle will check whether it produced real findings.",
    outcome: "APPLIED",
  },
  {
    id: "dream-rewrite",
    delayMs: 1500,
    agent: "DREAM",
    tool: "memory.rewrite",
    action: 'Condensed three glossary notes about "Finance Warehouse" into one durable entry.',
    rationale: "Memory drifts if nobody curates it — keep lessons crisp and non-duplicated.",
    outcome: "APPLIED",
  },
  {
    id: "dream-brief",
    delayMs: 1500,
    agent: "DREAM",
    tool: "system_brief.update",
    action: "Refreshed the system brief: +1 source live, +1 custom detector, +1 open case.",
    rationale:
      "The brief grounds every agent next cycle — it has to reflect today's reality.",
    outcome: "APPLIED",
  },
] as const;

const AGENT_META: Record<HarnessAgent, { label: string; index: string }> = {
  INQUIRY: { label: "Inquiry", index: "01" },
  CASE: { label: "Case", index: "02" },
  CONFIG: { label: "Config", index: "03" },
  DETECTOR_AUTHOR: { label: "Detector Author", index: "04" },
  DREAM: { label: "Dream", index: "05" },
};

function OutcomeChip({ outcome }: { outcome: HarnessOutcome }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em]",
        outcome === "APPLIED" && "border-accent bg-accent text-black",
        outcome === "DEDUPED" &&
          "border-primary-foreground/40 bg-primary-foreground/10 text-primary-foreground/80",
        outcome === "OBSERVE-ONLY" && "border-[#a855f7] bg-[#a855f7]/20 text-[#d8b4fe]",
      )}
    >
      {outcome}
    </span>
  );
}

export function HarnessSimulation() {
  const [count, setCount] = React.useState(0);
  const streamRef = React.useRef<HTMLOListElement | null>(null);

  React.useEffect(() => {
    if (count >= HARNESS_EVENTS.length) {
      return;
    }

    const next = HARNESS_EVENTS[count];
    if (!next) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setCount((current) => current + 1);
    }, next.delayMs);

    return () => window.clearTimeout(timeout);
  }, [count]);

  // Keep the newest decision in view as the recorder streams.
  React.useEffect(() => {
    const node = streamRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [count]);

  const visible = HARNESS_EVENTS.slice(0, count);
  const isRunning = count < HARNESS_EVENTS.length;
  const iteration = Math.min(count, HARNESS_EVENTS.length);

  return (
    <div className="flex h-[500px] flex-col border-2 border-primary-foreground/30 bg-black">
      {/* Recorder header */}
      <div className="flex items-center justify-between gap-3 border-b-2 border-primary-foreground/25 bg-primary-foreground/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-block h-2.5 w-2.5 rounded-full",
              isRunning ? "animate-pulse bg-accent" : "bg-primary-foreground/40",
            )}
          />
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-primary-foreground/80">
            {isRunning ? "Scan complete — harness awake" : "Cycle complete"}
          </span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary-foreground/45">
          {iteration} / {HARNESS_EVENTS.length} decisions
        </span>
      </div>

      {/* Decision stream */}
      <ol
        ref={streamRef}
        className="flex-1 space-y-0 overflow-y-auto px-4 py-2"
        aria-live="polite"
      >
        {visible.map((event) => {
          const meta = AGENT_META[event.agent];
          return (
            <li
              key={event.id}
              className="animate-in fade-in-0 slide-in-from-bottom-1 border-b border-primary-foreground/10 py-3 duration-300 last:border-b-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 border border-accent bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-accent">
                  <span className="text-accent/70">{meta.index}</span>
                  {event.agent}
                </span>
                <span className="font-mono text-[11px] text-primary-foreground/55">
                  {event.tool}()
                </span>
                <span className="ml-auto">
                  <OutcomeChip outcome={event.outcome} />
                </span>
              </div>
              <p className="mt-1.5 text-sm leading-6 text-primary-foreground">
                {event.action}
              </p>
              <p className="mt-1 border-l-2 border-primary-foreground/20 pl-2 text-xs italic leading-5 text-primary-foreground/55">
                {event.rationale}
              </p>
            </li>
          );
        })}
      </ol>

      {/* Recorder footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-primary-foreground/25 bg-primary-foreground/5 px-4 py-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary-foreground/45">
          {isRunning
            ? "Recording — every action logged with a rationale"
            : "Flip to observe-only and it proposes without touching"}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCount(0)}
            className="border border-primary-foreground/30 bg-primary-foreground/5 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-primary-foreground/80 transition-colors hover:bg-primary-foreground/15"
          >
            Replay
          </button>
          <a
            href="https://demo.classifyre.com/"
            target="_blank"
            rel="noreferrer"
            className="border-2 border-accent bg-accent px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-black transition-colors hover:bg-accent/90"
          >
            Try it live
          </a>
        </div>
      </div>
    </div>
  );
}
