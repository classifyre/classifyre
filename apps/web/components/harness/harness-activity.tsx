"use client";

import * as React from "react";
import {
  api,
  type AgentActivityItemDto,
  AutopilotControllerListActivityAgentKindEnum as KindEnum,
  AutopilotControllerListActivityActionEnum as ActionEnum,
  AutopilotControllerListActivityOutcomeEnum as OutcomeEnum,
} from "@workspace/api-client";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components";
import { EmptyState } from "@workspace/ui/components/empty-state";
import {
  Activity,
  CheckCircle2,
  CircleDashed,
  Loader2,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { formatRelative } from "@/lib/date";
import { KindGlyph, kindLabelKey } from "./harness-kind";

const ANY = "__any__";
const PAGE = 40;

function humanize(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/** Pull the failure reason a tool dispatcher stored on a FAILED decision. */
function extractError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const err = (payload as Record<string, unknown>).error;
  return typeof err === "string" && err.trim() ? err : null;
}

const OUTCOME_META: Record<
  string,
  { icon: React.ReactNode; className: string }
> = {
  APPLIED: {
    icon: <CheckCircle2 className="h-3 w-3" />,
    className: "border-emerald-600/50 text-emerald-600",
  },
  SKIPPED_OBSERVE_ONLY: {
    icon: <CircleDashed className="h-3 w-3" />,
    className: "border-stone-400/50 text-stone-500",
  },
  FAILED: {
    icon: <XCircle className="h-3 w-3" />,
    className: "border-red-600/50 text-red-600",
  },
};

/**
 * The harness activity timeline — every decision, queried SERVER-SIDE. Filters
 * (mission, action, outcome, entity, free text) hit the API; nothing is
 * filtered client-side, so it stays correct over the full history.
 */
export function HarnessActivity({
  onOpenRun,
}: {
  onOpenRun?: (runId: string) => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = React.useState<AgentActivityItemDto[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  const [kind, setKind] = React.useState<string>(ANY);
  const [action, setAction] = React.useState<string>(ANY);
  const [outcome, setOutcome] = React.useState<string>(ANY);
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [limit, setLimit] = React.useState(PAGE);

  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  // Reset the page window whenever a filter changes.
  React.useEffect(() => {
    setLimit(PAGE);
  }, [kind, action, outcome, debounced]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.autopilot.autopilotControllerListActivity({
        agentKind:
          kind === ANY ? undefined : (kind as KindEnum),
        action: action === ANY ? undefined : (action as ActionEnum),
        outcome: outcome === ANY ? undefined : (outcome as OutcomeEnum),
        search: debounced || undefined,
        limit,
        skip: 0,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch {
      // transient
    } finally {
      setLoading(false);
    }
  }, [kind, action, outcome, debounced, limit]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const hasFilters =
    kind !== ANY || action !== ANY || outcome !== ANY || debounced !== "";

  return (
    <div className="space-y-4">
      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("harness.activity.search")}
            className="h-9 rounded-[4px] border-2 border-border pl-3 font-mono text-xs"
          />
        </div>
        <FilterSelect
          value={kind}
          onChange={setKind}
          label={t("harness.activity.kind")}
          options={Object.values(KindEnum).map((v) => ({
            value: v,
            label: t(kindLabelKey(v)),
          }))}
          allLabel={t("harness.activity.all")}
        />
        <FilterSelect
          value={outcome}
          onChange={setOutcome}
          label={t("harness.activity.outcome")}
          options={Object.values(OutcomeEnum).map((v) => ({
            value: v,
            label: humanize(v),
          }))}
          allLabel={t("harness.activity.all")}
        />
        <FilterSelect
          value={action}
          onChange={setAction}
          label={t("harness.activity.action")}
          options={Object.values(ActionEnum).map((v) => ({
            value: v,
            label: humanize(v),
          }))}
          allLabel={t("harness.activity.all")}
        />
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setKind(ANY);
              setAction(ANY);
              setOutcome(ANY);
              setSearch("");
            }}
          >
            <X className="h-3.5 w-3.5" />
            {t("harness.activity.clearFilters")}
          </Button>
        )}
      </div>

      {loading && items.length === 0 ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("harness.loading")}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Activity}
          title={t("harness.activity.empty")}
          description={t("harness.activity.emptyDesc")}
        />
      ) : (
        <>
          <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("harness.activity.results", { count: items.length, total })}
          </p>
          <ol className="relative space-y-2 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-border">
            {items.map((item) => (
              <ActivityRow key={item.id} item={item} onOpenRun={onOpenRun} />
            ))}
          </ol>
          {items.length < total && (
            <div className="flex justify-center pt-1">
              <Button
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => setLimit((l) => l + PAGE)}
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                {t("harness.activity.loadMore")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  label,
  options,
  allLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  options: { value: string; label: string }[];
  allLabel: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-auto min-w-[130px] rounded-[4px] border-2 border-border font-mono text-[11px] uppercase tracking-wider">
        <SelectValue aria-label={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>
          {label}: {allLabel}
        </SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ActivityRow({
  item,
  onOpenRun,
}: {
  item: AgentActivityItemDto;
  onOpenRun?: (runId: string) => void;
}) {
  const { t } = useTranslation();
  const meta = OUTCOME_META[item.outcome] ?? OUTCOME_META.APPLIED!;
  const errorText =
    item.outcome === "FAILED" ? extractError(item.payload) : null;
  return (
    <li className="relative pl-9">
      <span className="absolute left-2 top-3 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-border bg-card">
        <KindGlyph kind={item.agentKind} className="h-2 w-2 text-[#d97706]" />
      </span>
      <div className="rounded-[4px] border-2 border-border bg-card px-3 py-2.5 shadow-[0_1px_3px_rgba(28,25,23,0.04)] transition-colors hover:border-foreground/30">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {t(kindLabelKey(item.agentKind))}
          </span>
          <span className="text-sm font-medium">{humanize(item.action)}</span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-px font-mono text-[10px] uppercase tracking-wide",
              meta.className,
            )}
          >
            {meta.icon}
            {t(`harness.outcomes.${item.outcome}` as never)}
          </span>
          {item.entityType && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {item.entityType}
              {item.entityId ? ` · ${item.entityId.slice(0, 8)}…` : ""}
            </span>
          )}
          <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground/70">
            {formatRelative(item.createdAt)}
          </span>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">{item.rationale}</p>
        {errorText && (
          <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-red-600">
            {errorText}
          </p>
        )}
        <div className="mt-1.5 flex items-center gap-3">
          {onOpenRun && (
            <button
              onClick={() => onOpenRun(item.runId)}
              className="font-mono text-[10px] uppercase tracking-wide text-[#d97706] hover:underline"
            >
              {t("harness.activity.openRun")}
            </button>
          )}
          {item.payload && Object.keys(item.payload).length > 0 && (
            <details>
              <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground">
                {t("harness.activity.payload")}
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-2 font-mono text-[10px]">
                {JSON.stringify(item.payload, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </div>
    </li>
  );
}
