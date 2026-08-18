"use client";

import * as React from "react";
import {
  AgentConfigDtoChainEnum as Chain,
  type AgentConfigDto,
} from "@workspace/api-client";
import { Badge } from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { KindGlyph, kindLabelKey } from "./harness-kind";

/**
 * How the agents follow one another, read-only.
 *
 * The order is a real data dependency — CASE reads the inquiries INQUIRY just
 * wrote, ESCALATION alerts on the cases CASE mutated — and none of that is
 * visible from a stack of independent agent cards. The cards answer "when may
 * this agent start"; this answers "and then what", which is the question an
 * operator actually has when a run does not appear.
 *
 * Everything structural (membership, order, what precedes what) comes from the
 * API so it cannot drift from the chains the worker executes. Only the prose
 * explaining each dependency lives here, because it has to be translated.
 */
export function HarnessChain({ agents }: { agents: AgentConfigDto[] }) {
  const { t } = useTranslation();

  const chains = React.useMemo(
    () =>
      [Chain.Investigation, Chain.Detection].map((chain) => ({
        chain,
        members: agents
          .filter((a) => a.chain === chain)
          .sort((a, b) => a.chainPosition - b.chainPosition),
      })),
    [agents],
  );

  const unchained = React.useMemo(
    () => agents.filter((a) => a.chain == null),
    [agents],
  );

  if (chains.every((c) => c.members.length === 0)) return null;

  return (
    <section className="rounded-[4px] border-2 border-border bg-muted/10 px-4 py-3.5">
      <header className="space-y-0.5">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.12em]">
          {t("harness.agents.chain.title")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("harness.agents.chain.desc")}
        </p>
      </header>

      {/*
        Two columns because the two chains genuinely run at the same time;
        stacking them would imply a sequence that does not exist. The seam
        between them is a bare rule on purpose — a centred label would have to
        sit in a 24px gutter and would overlap both columns at any real width,
        so the concurrency is stated in the heading instead.
      */}
      <div className="relative mt-4 grid gap-6 sm:grid-cols-2">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-1/2 hidden -translate-x-1/2 border-l border-dashed border-border sm:block"
        />

        {chains.map(({ chain, members }) => (
          <div key={chain} className="space-y-0">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {t(
                chain === Chain.Investigation
                  ? "harness.agents.chain.investigation"
                  : "harness.agents.chain.detection",
              )}
            </p>
            {members.map((agent, index) => (
              <React.Fragment key={agent.kind}>
                {index > 0 && <ChainLink agent={agent} />}
                <ChainStep agent={agent} />
              </React.Fragment>
            ))}
          </div>
        ))}
      </div>

      {unchained.length > 0 && (
        <p className="mt-4 border-t border-border pt-2.5 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">
            {unchained.map((a) => t(kindLabelKey(a.kind))).join(", ")}
          </span>{" "}
          — {t("harness.agents.chain.unchained")}
        </p>
      )}

      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        {t("harness.agents.chain.providerHalt")}
      </p>
    </section>
  );
}

/** One agent in the sequence. */
function ChainStep({ agent }: { agent: AgentConfigDto }) {
  const { t } = useTranslation();
  const off = agent.enableable && !agent.enabled;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-[3px] border px-2 py-1.5",
        off
          ? "border-dashed border-border bg-transparent"
          : "border-[#d97706]/40 bg-[#d97706]/[0.05]",
      )}
    >
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-mono text-[9px] tabular-nums",
          off
            ? "bg-muted text-muted-foreground"
            : "bg-[#d97706]/15 text-[#d97706]",
        )}
      >
        {agent.chainPosition}
      </span>
      <KindGlyph
        kind={agent.kind}
        className={cn("h-3.5 w-3.5 shrink-0", off && "text-muted-foreground")}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-xs font-medium",
          off && "text-muted-foreground line-through decoration-1",
        )}
      >
        {t(kindLabelKey(agent.kind))}
      </span>
      {off ? (
        <Badge
          variant="outline"
          className="shrink-0 font-mono text-[8px] uppercase tracking-wide"
        >
          {t("harness.agents.chain.off")}
        </Badge>
      ) : (
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
          {t(MODE_LABEL[agent.triggerMode])}
        </span>
      )}
    </div>
  );
}

/**
 * The link between two steps, and the reason for it.
 *
 * This is the part worth having: an arrow alone says "then", which the numbers
 * already say. The dependency is *why* the order cannot be rearranged, so it is
 * set as an editorial aside rather than decoration.
 */
function ChainLink({ agent }: { agent: AgentConfigDto }) {
  const { t } = useTranslation();
  const reason = agent.runsAfter
    ? DEPENDENCY[agent.kind as keyof typeof DEPENDENCY]
    : undefined;

  return (
    <div className="flex gap-2 py-1 pl-[7px]">
      <span
        aria-hidden
        className="mt-0.5 w-px shrink-0 self-stretch bg-border"
      />
      {reason && (
        <p className="font-serif text-[11px] italic leading-snug text-muted-foreground">
          {t(reason)}
        </p>
      )}
    </div>
  );
}

/**
 * Why each agent must follow the one before it.
 *
 * Keyed by the *dependent* agent, so adding a chain member only needs its own
 * sentence. Anything without an entry simply shows the connector with no aside,
 * which is the right failure mode for a chain that grows before the copy does.
 */
const DEPENDENCY = {
  CASE: "harness.agents.chain.why.case",
  ESCALATION: "harness.agents.chain.why.escalation",
  DETECTOR_AUTHOR: "harness.agents.chain.why.detectorAuthor",
} as const satisfies Partial<Record<AgentConfigDto["kind"], string>>;

const MODE_LABEL = {
  EAGER: "harness.agents.modes.eager",
  BATCH: "harness.agents.modes.batch",
  SETTLED: "harness.agents.modes.settled",
  SCHEDULED: "harness.agents.modes.scheduled",
  MANUAL: "harness.agents.modes.manual",
} as const;
