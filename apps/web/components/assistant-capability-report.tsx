"use client";

import * as React from "react";
import type {
  AgentCapacityReportDto,
  AssistantCapabilityReportDto,
  CapabilityProbeResultDto,
} from "@workspace/api-client";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Separator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  MinusCircle,
  XCircle,
} from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

/** Tier display order — matches the order the suite executes them in. */
const TIER_ORDER = ["PROTOCOL", "TOOL_USE", "CHAINING", "JUDGMENT"] as const;

const STATUS_ICON = {
  PASS: CheckCircle2,
  FAIL: XCircle,
  ERROR: AlertTriangle,
  SKIPPED: MinusCircle,
} as const;

/** Map probe/agent/verdict states onto the shared Badge variants. */
const STATUS_VARIANT = {
  PASS: "secondary",
  FAIL: "destructive",
  ERROR: "outline",
  SKIPPED: "ghost",
} as const;

const READINESS_VARIANT = {
  READY: "secondary",
  DEGRADED: "outline",
  WILL_FAIL: "destructive",
  UNKNOWN: "ghost",
} as const;

interface Props {
  report: AssistantCapabilityReportDto;
}

export function AssistantCapabilityReport({ report }: Props) {
  const { t } = useTranslation();

  const byTier = React.useMemo(() => {
    const groups = new Map<string, CapabilityProbeResultDto[]>();
    for (const probe of report.probes) {
      const list = groups.get(probe.tier) ?? [];
      list.push(probe);
      groups.set(probe.tier, list);
    }
    return groups;
  }, [report.probes]);

  const passed = report.probes.filter((p) => p.status === "PASS").length;
  const exercised = report.probes.filter((p) => p.status !== "SKIPPED").length;

  return (
    <div className="space-y-5" data-testid="capability-report">
      {/* Verdict */}
      <Alert
        variant={report.verdict === "UNUSABLE" ? "destructive" : "default"}
        data-testid="capability-verdict"
        data-verdict={report.verdict}
      >
        {report.verdict === "READY" ? <CheckCircle2 /> : <AlertTriangle />}
        <AlertTitle>
          {t(
            `settings.assistant.capability.verdict.${report.verdict}` as TranslationKey,
          )}{" "}
          — {passed}/{exercised}{" "}
          {t("settings.assistant.capability.probesPassed")}
        </AlertTitle>
        <AlertDescription>
          <span>{report.headline}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {report.model} · {formatSeconds(report.totalDurationMs)} ·{" "}
            {report.totalInputTokens.toLocaleString()} in /{" "}
            {report.totalOutputTokens.toLocaleString()} out
            {report.cost.estimatedCostPerRunUsd !== null
              ? ` · ~$${report.cost.estimatedCostPerRunUsd.toFixed(3)} ${t(
                  "settings.assistant.capability.perRun",
                )}`
              : ""}
          </span>
        </AlertDescription>
      </Alert>

      {/* Per-agent readiness */}
      <section className="space-y-2">
        <h4 className="text-sm font-medium">
          {t("settings.assistant.capability.agentsTitle")}
        </h4>
        <p className="text-xs text-muted-foreground">
          {t("settings.assistant.capability.agentsDesc")}
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                {t("settings.assistant.capability.colAgent")}
              </TableHead>
              <TableHead>
                {t("settings.assistant.capability.colStatus")}
              </TableHead>
              <TableHead className="text-right">
                {t("settings.assistant.capability.colTools")}
              </TableHead>
              <TableHead className="text-right">
                {t("settings.assistant.capability.colPrompt")}
              </TableHead>
              <TableHead className="text-right">
                {t("settings.assistant.capability.colHeadroom")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.agents.map((agent) => (
              <AgentRow key={agent.kind} agent={agent} />
            ))}
          </TableBody>
        </Table>
      </section>

      <Separator />

      {/* Probes by tier */}
      <section className="space-y-3">
        <h4 className="text-sm font-medium">
          {t("settings.assistant.capability.probesTitle")}
        </h4>
        {TIER_ORDER.filter((tier) => byTier.has(tier)).map((tier) => (
          <div key={tier} className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {t(`settings.assistant.capability.tier.${tier}` as TranslationKey)}
            </p>
            {(byTier.get(tier) ?? []).map((probe) => (
              <ProbeRow key={probe.id} probe={probe} />
            ))}
          </div>
        ))}
      </section>

      {/* Assumptions — the numbers above should be arguable, not taken on faith */}
      <section className="space-y-1.5">
        <h4 className="text-sm font-medium">
          {t("settings.assistant.capability.assumptionsTitle")}
        </h4>
        <ul className="space-y-1">
          {report.assumptions.map((assumption) => (
            <li key={assumption} className="text-xs text-muted-foreground">
              — {assumption}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function AgentRow({ agent }: { agent: AgentCapacityReportDto }) {
  return (
    <TableRow
      data-testid="capability-agent-row"
      data-agent={agent.kind}
      data-readiness={agent.readiness}
    >
      <TableCell className="align-top">
        <span className="font-medium">{agent.kind}</span>
        <p className="mt-1 max-w-[46ch] whitespace-normal text-xs text-muted-foreground">
          {agent.reason}
        </p>
      </TableCell>
      <TableCell className="align-top">
        <Badge variant={READINESS_VARIANT[agent.readiness]}>
          {agent.readiness.replace("_", " ")}
        </Badge>
      </TableCell>
      <TableCell className="text-right align-top font-mono">
        {agent.toolCount}
      </TableCell>
      <TableCell className="text-right align-top font-mono">
        {formatTokens(agent.systemPromptTokens)}
      </TableCell>
      <TableCell className="text-right align-top font-mono">
        {agent.headroomPct === null
          ? "—"
          : `${Math.round(agent.headroomPct * 100)}%`}
      </TableCell>
    </TableRow>
  );
}

function ProbeRow({ probe }: { probe: CapabilityProbeResultDto }) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const Icon = STATUS_ICON[probe.status];
  const hasDetail = Boolean(probe.prompt || probe.rawOutput);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-md border"
      data-testid="capability-probe"
      data-probe={probe.id}
      data-status={probe.status}
    >
      <CollapsibleTrigger
        className="flex w-full items-start gap-2.5 p-3 text-left"
        disabled={!hasDetail}
      >
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{probe.title}</span>
            <Badge variant={STATUS_VARIANT[probe.status]}>{probe.status}</Badge>
            <span className="font-mono text-xs text-muted-foreground">
              {probe.id}
              {probe.latencyMs > 0
                ? ` · ${formatSeconds(probe.latencyMs)}`
                : ""}
            </span>
          </span>
          <span className="block text-xs text-muted-foreground">
            {probe.reason}
          </span>
        </span>
        {hasDetail ? (
          <ChevronRight
            className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground data-[open=true]:rotate-90"
            data-open={open}
          />
        ) : null}
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-3 border-t p-3">
        <Detail
          label={t("settings.assistant.capability.whatItProves")}
          body={probe.whatItProves}
        />
        {probe.prompt ? (
          <Detail
            label={t("settings.assistant.capability.promptSent")}
            body={probe.prompt}
          />
        ) : null}
        {probe.rawOutput ? (
          <Detail
            label={t("settings.assistant.capability.modelOutput")}
            body={probe.rawOutput}
          />
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

function Detail({ label, body }: { label: string; body: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 font-mono text-xs">
        {body}
      </pre>
    </div>
  );
}

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
