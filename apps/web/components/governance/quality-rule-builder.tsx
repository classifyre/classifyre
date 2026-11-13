"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  Columns3,
  DatabaseZap,
  FileText,
  FlaskConical,
  Play,
  ScanSearch,
  Search,
  Sparkles,
  TableProperties,
  TriangleAlert,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  api,
  type AssetQualityDto,
  type QualityOptionsDto,
  type QualityRuleDto,
  type QualityTestResultDto,
  type SaveQualityRuleDto,
} from "@workspace/api-client";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Textarea,
  ToneBadge,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { AiAssistedCard } from "@/components/ai-assisted-card";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import {
  isBetween,
  QUALITY_DIMENSIONS,
  QUALITY_OPERATORS,
} from "@/lib/governance";

export type RuleKind = "library" | "sql" | "detector" | "metadata";

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
const LIBRARY_METRICS = [
  "nullValues",
  "missingValues",
  "invalidValues",
  "duplicateValues",
  "rowCount",
] as const;
const COLUMN_METRICS = ["nullValues", "missingValues", "invalidValues"];
export const SCHEDULES = ["scan", "hourly", "daily", "weekly"] as const;
const PRESET_CRON: Record<string, string> = {
  hourly: "0 * * * *",
  daily: "0 6 * * *",
  weekly: "0 6 * * 1",
};
const ANY = "__any__";
const WHOLE = "__whole__";

export const KIND_ICON: Record<RuleKind, LucideIcon> = {
  library: Columns3,
  sql: DatabaseZap,
  detector: ScanSearch,
  metadata: TableProperties,
};

interface Draft {
  kind: RuleKind;
  metric: string;
  detectorType: string;
  customDetectorKey: string;
  findingType: string;
  column: string;
  /** duplicateValues over the table: columns unique together. */
  properties: string[];
  validValues: string;
  missingValues: string;
  pattern: string;
  query: string;
  unit: "rows" | "percent";
  schedule: string;
  operator: string;
  low: string;
  high: string;
  name: string;
  dimension: string;
  severity: string;
}

const EMPTY: Draft = {
  kind: "library",
  metric: "nullValues",
  detectorType: ANY,
  customDetectorKey: "",
  findingType: "",
  column: WHOLE,
  properties: [],
  validValues: "",
  missingValues: "",
  pattern: "",
  query: "SELECT COUNT(*) FROM {object} WHERE ",
  unit: "rows",
  schedule: "scan",
  operator: "mustBe",
  low: "0",
  high: "",
  name: "",
  dimension: "completeness",
  severity: "MEDIUM",
};

const list = (text: string) =>
  text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export function scheduleOf(cron: string | null | undefined): string {
  if (!cron) return "scan";
  const preset = Object.entries(PRESET_CRON).find(
    ([, value]) => value === cron,
  );
  return preset ? preset[0] : cron;
}

function draftOf(rule: QualityRuleDto): Draft {
  const threshold = rule.threshold as number | number[];
  const args = rule.arguments;
  return {
    ...EMPTY,
    kind: rule.type as RuleKind,
    metric: rule.metric,
    detectorType: args.detectorType ?? ANY,
    customDetectorKey: args.customDetectorKey ?? "",
    findingType: args.findingType ?? "",
    column: rule.columnName ?? WHOLE,
    properties: args.properties ?? [],
    validValues: (args.validValues ?? []).join(", "),
    missingValues: (args.missingValues ?? []).join(", "),
    pattern: args.pattern ?? "",
    query: args.query ?? EMPTY.query,
    unit: rule.unit === "percent" ? "percent" : "rows",
    schedule: scheduleOf(rule.schedule),
    operator: rule.operator,
    low: String(Array.isArray(threshold) ? threshold[0] : threshold),
    high: Array.isArray(threshold) ? String(threshold[1]) : "",
    name: rule.name,
    dimension: rule.dimension,
    severity: rule.severity,
  };
}

interface Template {
  id: string;
  title: string;
  description: string;
  /** What it would measure today, where that is known without a query. */
  now?: string | null;
  draft: Partial<Draft>;
}

function templatesFor(
  kind: RuleKind,
  options: QualityOptionsDto | null,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): Template[] {
  const tk = (key: string, params?: Record<string, string | number>) =>
    t(`governance.qualityBuilder.template.${key}` as TranslationKey, params);
  if (kind === "library") {
    return [
      { id: "notNull", title: tk("notNull.title"), description: tk("notNull.body"), draft: { metric: "nullValues", operator: "mustBe", low: "0", dimension: "completeness" } },
      { id: "fewNull", title: tk("fewNull.title"), description: tk("fewNull.body"), draft: { metric: "nullValues", operator: "mustBeLessOrEqualTo", low: "5", unit: "percent", dimension: "completeness" } },
      { id: "placeholders", title: tk("placeholders.title"), description: tk("placeholders.body"), draft: { metric: "missingValues", missingValues: "N/A, n/a, -, unknown", operator: "mustBe", low: "0", dimension: "completeness" } },
      { id: "allowed", title: tk("allowed.title"), description: tk("allowed.body"), draft: { metric: "invalidValues", operator: "mustBe", low: "0", dimension: "conformity" } },
      { id: "pattern", title: tk("pattern.title"), description: tk("pattern.body"), draft: { metric: "invalidValues", pattern: "^[A-Z]{2}[0-9]+$", operator: "mustBe", low: "0", dimension: "conformity" } },
      { id: "unique", title: tk("unique.title"), description: tk("unique.body"), draft: { metric: "duplicateValues", operator: "mustBe", low: "0", dimension: "uniqueness" } },
      { id: "uniqueTogether", title: tk("uniqueTogether.title"), description: tk("uniqueTogether.body"), draft: { metric: "duplicateValues", column: WHOLE, operator: "mustBe", low: "0", dimension: "uniqueness" } },
      { id: "rows", title: tk("rows.title"), description: tk("rows.body"), now: options?.rowCount != null ? t("governance.qualityBuilder.nowRows", { count: options.rowCount }) : null, draft: { metric: "rowCount", column: WHOLE, operator: "mustBeGreaterThan", low: "0", dimension: "completeness" } },
    ];
  }
  if (kind === "sql") {
    return [
      { id: "condition", title: tk("condition.title"), description: tk("condition.body"), draft: { query: "SELECT COUNT(*) FROM {object} WHERE {property} < 0", operator: "mustBe", low: "0", dimension: "accuracy" } },
      { id: "range", title: tk("range.title"), description: tk("range.body"), draft: { query: "SELECT COUNT(*) FROM {object} WHERE {property} NOT BETWEEN 0 AND 100", operator: "mustBe", low: "0", dimension: "accuracy" } },
      { id: "future", title: tk("future.title"), description: tk("future.body"), draft: { query: "SELECT COUNT(*) FROM {object} WHERE {property} > CURRENT_DATE", operator: "mustBe", low: "0", dimension: "accuracy" } },
      { id: "total", title: tk("total.title"), description: tk("total.body"), draft: { query: "SELECT SUM({property}) FROM {object}", operator: "mustBeBetween", low: "0", high: "1000000", dimension: "consistency" } },
      { id: "distinct", title: tk("distinct.title"), description: tk("distinct.body"), draft: { query: "SELECT COUNT(DISTINCT {property}) FROM {object}", operator: "mustBeGreaterOrEqualTo", low: "1", dimension: "coverage" } },
    ];
  }
  if (kind === "metadata") {
    const rows = options?.rowCount ?? null;
    const hours = options?.lastScannedAt
      ? Math.round(
          ((Date.now() - new Date(options.lastScannedAt).getTime()) / 3_600_000) * 10,
        ) / 10
      : null;
    return [
      { id: "notEmpty", title: tk("notEmpty.title"), description: tk("notEmpty.body"), now: rows !== null ? t("governance.qualityBuilder.nowRows", { count: rows }) : null, draft: { metric: "rowCount", operator: "mustBeGreaterThan", low: "0", dimension: "completeness" } },
      ...(rows !== null
        ? [{ id: "rowRange", title: tk("rowRange.title"), description: tk("rowRange.body"), now: t("governance.qualityBuilder.nowRows", { count: rows }), draft: { metric: "rowCount", operator: "mustBeBetween", low: String(Math.floor(rows * 0.5)), high: String(Math.ceil(rows * 1.5)), dimension: "consistency" } }]
        : []),
      { id: "daily", title: tk("daily.title"), description: tk("daily.body"), now: hours !== null ? t("governance.qualityBuilder.nowHours", { hours }) : null, draft: { metric: "freshness", operator: "mustBeLessOrEqualTo", low: "24", dimension: "timeliness" } },
      { id: "weekly", title: tk("weekly.title"), description: tk("weekly.body"), now: hours !== null ? t("governance.qualityBuilder.nowHours", { hours }) : null, draft: { metric: "freshness", operator: "mustBeLessOrEqualTo", low: "168", dimension: "timeliness" } },
    ];
  }
  // detector: what the detectors already found here, with today's counts.
  const out: Template[] = [
    { id: "none", title: tk("noFindings.title"), description: tk("noFindings.body"), now: options ? t("governance.qualityBuilder.nowFindings", { count: options.openFindings }) : null, draft: { detectorType: ANY, operator: "mustBe", low: "0", dimension: "conformity" } },
  ];
  const detectors = options?.detectorTypes.length
    ? options.detectorTypes
    : [
        { value: "PII", count: 0 },
        { value: "SECRETS", count: 0 },
      ];
  for (const d of detectors) {
    out.push({ id: `detector-${d.value}`, title: tk("detector.title", { detector: d.value }), description: tk("detector.body", { detector: d.value }), now: t("governance.qualityBuilder.nowFindings", { count: d.count }), draft: { detectorType: d.value, operator: "mustBe", low: "0", dimension: d.value === "PII" || d.value === "SECRETS" ? "conformity" : "accuracy" } });
  }
  for (const c of (options?.columnsWithFindings ?? []).slice(0, 6)) {
    out.push({ id: `column-${c.value}`, title: tk("column.title", { column: c.value }), description: tk("column.body", { column: c.value }), now: t("governance.qualityBuilder.nowFindings", { count: c.count }), draft: { detectorType: ANY, column: c.value, operator: "mustBe", low: "0", dimension: "conformity" } });
  }
  for (const f of (options?.findingTypes ?? []).slice(0, 6)) {
    out.push({ id: `type-${f.value}`, title: tk("type.title", { type: f.value }), description: tk("type.body", { type: f.value }), now: t("governance.qualityBuilder.nowFindings", { count: f.count }), draft: { detectorType: ANY, findingType: f.value, operator: "mustBe", low: "0", dimension: "conformity" } });
  }
  return out;
}

/** The rule as a sentence: "Empty values in email must be 0 rows". */
function useDescribe() {
  const { t } = useTranslation();
  return (draft: Draft) => {
    const column = draft.column === WHOLE ? null : draft.column;
    let what: string;
    if (draft.kind === "detector") {
      const detector =
        draft.detectorType === ANY
          ? t("governance.quality.anyFindings")
          : draft.detectorType;
      what = `${t("governance.quality.metric.openFindings")} · ${detector}${draft.findingType ? ` · ${draft.findingType}` : ""}`;
    } else if (draft.kind === "sql") {
      what = t("governance.quality.metric.query");
    } else {
      what = t(`governance.quality.metric.${draft.metric}` as TranslationKey);
    }
    const where = column
      ? ` ${t("governance.qualityBuilder.in")} ${column}`
      : draft.metric === "duplicateValues" && draft.properties.length
        ? ` ${t("governance.qualityBuilder.in")} (${draft.properties.join(", ")})`
        : "";
    const bound = isBetween(draft.operator)
      ? `${draft.low || "?"}–${draft.high || "?"}`
      : draft.low || "?";
    return `${what}${where} ${t(`governance.quality.operator.${draft.operator}` as TranslationKey)} ${bound} ${unitLabel(draft, t)}`.trim();
  };
}

function unitLabel(
  draft: Draft,
  t: (key: TranslationKey) => string,
): string {
  if (draft.kind === "library") {
    return draft.metric === "rowCount"
      ? t("governance.quality.unit.rows")
      : t(`governance.quality.unit.${draft.unit}` as TranslationKey);
  }
  if (draft.kind === "sql") return "";
  return t(`governance.quality.unit.${draft.metric}` as TranslationKey);
}

function bodyOf(draft: Draft, fallbackName: string): SaveQualityRuleDto {
  const column = draft.column === WHOLE ? null : draft.column;
  const low = Number(draft.low);
  const high = Number(draft.high);
  const args: Record<string, unknown> = {};
  if (draft.kind === "detector") {
    if (draft.detectorType !== ANY) args.detectorType = draft.detectorType;
    if (draft.customDetectorKey.trim()) args.customDetectorKey = draft.customDetectorKey.trim();
    if (draft.findingType.trim()) args.findingType = draft.findingType.trim();
  } else if (draft.kind === "library") {
    if (draft.metric === "invalidValues" && list(draft.validValues).length) args.validValues = list(draft.validValues);
    if (draft.metric === "invalidValues" && draft.pattern.trim()) args.pattern = draft.pattern.trim();
    if (draft.metric === "missingValues" && list(draft.missingValues).length) args.missingValues = list(draft.missingValues);
    if (draft.metric === "duplicateValues" && !column && draft.properties.length) args.properties = draft.properties;
  } else if (draft.kind === "sql") {
    args.query = draft.query.trim();
  }
  return {
    name: draft.name.trim() || fallbackName,
    type: draft.kind,
    metric: draft.metric,
    dimension: draft.dimension,
    operator: draft.operator,
    threshold: isBetween(draft.operator) ? [low, high] : low,
    severity: draft.severity,
    columnName:
      draft.kind === "metadata" ||
      (draft.kind === "library" && draft.metric === "rowCount")
        ? null
        : column,
    arguments: args,
    ...(draft.kind === "library" ? { unit: draft.metric === "rowCount" ? "rows" : draft.unit } : {}),
    schedule:
      draft.kind === "library" || draft.kind === "sql"
        ? draft.schedule === "scan"
          ? null
          : draft.schedule
        : null,
  } as SaveQualityRuleDto;
}

/** A clickable card in the "new source" style: icon square, title, text. */
function ChoiceCard({
  icon: Icon,
  title,
  tagline,
  description,
  badge,
  disabled,
  disabledReason,
  onClick,
  testId,
}: {
  icon: LucideIcon;
  title: string;
  tagline?: string;
  description: string;
  badge?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        "group rounded-[6px] text-left disabled:cursor-not-allowed",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      )}
    >
      <Card
        clickable={!disabled}
        className={cn("h-full p-4", disabled && "opacity-55")}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-[4px] border-2 border-border bg-accent text-accent-foreground">
            <Icon className="h-4 w-4" />
          </div>
          {badge}
        </div>
        <div className="mt-3 space-y-1">
          <div className="font-serif text-sm font-black uppercase tracking-[0.08em]">
            {title}
          </div>
          {tagline && (
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {tagline}
            </div>
          )}
          <div className="text-xs leading-relaxed text-muted-foreground">
            {disabled && disabledReason ? disabledReason : description}
          </div>
        </div>
      </Card>
    </button>
  );
}

/** The table's columns as chips, with their type and today's findings. */
function ColumnPicker({
  columns,
  findings,
  value,
  onChange,
  allowWhole,
  multiple,
  values,
  onToggle,
}: {
  columns: { name: string; type?: string | null }[];
  findings?: Map<string, number>;
  value?: string;
  onChange?: (column: string) => void;
  allowWhole?: boolean;
  multiple?: boolean;
  values?: string[];
  onToggle?: (column: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const shown = columns.filter((column) =>
    column.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const chip = (
    key: string,
    label: ReactNode,
    selected: boolean,
    onClick: () => void,
  ) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-testid={`column-chip-${key}`}
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-[4px] border px-2 py-1 text-left text-xs transition-colors",
        selected
          ? "border-border bg-accent text-accent-foreground shadow-[2px_2px_0_0_var(--border)]"
          : "border-border/50 bg-background hover:border-border",
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-2">
      {columns.length > 12 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("governance.qualityBuilder.searchColumns")}
            className="h-8 pl-8 text-xs"
          />
        </div>
      )}
      <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
        {allowWhole &&
          !multiple &&
          chip(
            WHOLE,
            <span className="font-medium">
              {t("governance.quality.wholeAsset")}
            </span>,
            value === WHOLE,
            () => onChange?.(WHOLE),
          )}
        {shown.map((column) => {
          const count = findings?.get(column.name) ?? 0;
          const selected = multiple
            ? Boolean(values?.includes(column.name))
            : value === column.name;
          return chip(
            column.name,
            <>
              <span className="truncate font-mono font-medium">
                {column.name}
              </span>
              {column.type && (
                <span className="shrink-0 font-mono text-[9px] uppercase opacity-60">
                  {column.type}
                </span>
              )}
              {count > 0 && (
                <span className="shrink-0 rounded-sm bg-destructive/15 px-1 font-mono text-[9px] text-destructive">
                  {count}
                </span>
              )}
            </>,
            selected,
            () =>
              multiple ? onToggle?.(column.name) : onChange?.(column.name),
          );
        })}
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

/**
 * Adding or changing a quality check (GOV §5.4), in the way a source is
 * created: choose what to check, start from a template, then fill one form,
 * test it against the data as it is now, and save.
 */
export function QualityRuleBuilder({
  assetId,
  isTable,
  rule,
  onClose,
  onSaved,
}: {
  assetId: string;
  /** Whether SQL can read this asset: column and SQL checks need it. */
  isTable: boolean;
  rule: QualityRuleDto | null;
  onClose: () => void;
  onSaved: (next: AssetQualityDto) => void;
}) {
  const { t } = useTranslation();
  const describe = useDescribe();
  const [options, setOptions] = useState<QualityOptionsDto | null>(null);
  const [step, setStep] = useState<"kind" | "template" | "form">(
    rule ? "form" : "kind",
  );
  const [draft, setDraft] = useState<Draft>(() =>
    rule ? draftOf(rule) : EMPTY,
  );
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{
    result: QualityTestResultDto;
    of: string;
  } | null>(null);

  useEffect(() => {
    let live = true;
    api.governance
      .governanceControllerQualityOptions({ id: assetId })
      .then((next) => live && setOptions(next))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [assetId]);

  const columns = options?.columns ?? [];
  const findingsByColumn = useMemo(
    () =>
      new Map(
        (options?.columnsWithFindings ?? []).map((c) => [c.value, c.count]),
      ),
    [options],
  );
  const set = (patch: Partial<Draft>) =>
    setDraft((current) => {
      const next = { ...current, ...patch };
      // A column check on the whole table means nothing: land on a column.
      if (
        next.kind === "library" &&
        COLUMN_METRICS.includes(next.metric) &&
        next.column === WHOLE &&
        columns[0]
      ) {
        next.column = columns[0].name;
      }
      return next;
    });

  const suggested = (() => {
    const column = draft.column === WHOLE ? null : draft.column;
    if (draft.kind === "metadata") {
      return draft.metric === "rowCount"
        ? t("governance.quality.suggest.rowCount")
        : t("governance.quality.suggest.freshness");
    }
    if (draft.kind === "library") {
      return t(`governance.quality.suggest.${draft.metric}` as TranslationKey, {
        column:
          column ??
          (draft.properties.length
            ? draft.properties.join(" + ")
            : t("governance.quality.wholeAsset")),
      });
    }
    if (draft.kind === "sql") return t("governance.quality.suggest.sql");
    const what =
      draft.detectorType === ANY
        ? t("governance.quality.anyFindings")
        : draft.detectorType;
    return column
      ? t("governance.quality.suggest.findingsIn", { what, column })
      : t("governance.quality.suggest.findings", { what });
  })();

  const body = bodyOf(draft, suggested);
  const fingerprint = JSON.stringify(body);
  const testIsCurrent = test?.of === fingerprint;

  const chooseKind = (kind: RuleKind) => {
    setDraft({
      ...EMPTY,
      kind,
      metric:
        kind === "sql"
          ? "query"
          : kind === "detector"
            ? "openFindings"
            : kind === "metadata"
              ? "rowCount"
              : "nullValues",
      column:
        kind === "library" && columns[0] ? columns[0].name : WHOLE,
    });
    setTest(null);
    setStep("template");
  };

  const chooseTemplate = (template: Template | null) => {
    setDraft((current) => {
      const next = { ...current, ...(template?.draft ?? {}) };
      if (
        next.kind === "library" &&
        COLUMN_METRICS.includes(next.metric) &&
        next.column === WHOLE &&
        columns[0]
      ) {
        next.column = columns[0].name;
      }
      if (
        next.kind === "sql" &&
        next.query.includes("{property}") &&
        next.column === WHOLE &&
        columns[0]
      ) {
        next.column = columns[0].name;
      }
      return next;
    });
    setStep("form");
  };

  const runTest = async () => {
    setTesting(true);
    try {
      const result = await api.governance.governanceControllerTestQualityRule({
        id: assetId,
        saveQualityRuleDto: body,
      });
      setTest({ result, of: fingerprint });
    } catch (error) {
      toast.error(
        await extractApiErrorMessage(
          error,
          t("governance.qualityBuilder.testFailed"),
        ),
      );
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      onSaved(
        rule
          ? await api.governance.governanceControllerUpdateQualityRule({
              ruleId: rule.id,
              saveQualityRuleDto: body,
            })
          : await api.governance.governanceControllerCreateQualityRule({
              id: assetId,
              saveQualityRuleDto: body,
            }),
      );
      toast.success(t("governance.quality.saved"));
      onClose();
    } catch (error) {
      toast.error(
        await extractApiErrorMessage(error, t("governance.saveFailed")),
      );
    } finally {
      setBusy(false);
    }
  };

  const kindTitle = (kind: RuleKind) =>
    t(`governance.qualityBuilder.kind.${kind}.title` as TranslationKey);
  const stepLabels: [typeof step, string][] = [
    ["kind", t("governance.qualityBuilder.steps.kind")],
    ["template", t("governance.qualityBuilder.steps.template")],
    ["form", t("governance.qualityBuilder.steps.form")],
  ];
  const resolvedQuery = draft.query
    .replace(/\{object\}/g, options?.table ?? "{object}")
    .replace(
      /\{property\}/g,
      draft.column !== WHOLE ? `"${draft.column}"` : "{property}",
    );

  return (
    <div className="space-y-4" data-testid="quality-rule-builder">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="rounded-[4px] border-2 border-border"
            onClick={() => {
              if (step === "form" && !rule) setStep("template");
              else if (step === "template") setStep("kind");
              else onClose();
            }}
            data-testid="rule-back"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            {step === "kind" || rule
              ? t("governance.qualityBuilder.backToChecks")
              : t("governance.qualityBuilder.back")}
          </Button>
          <h3 className="font-serif text-xl font-black uppercase tracking-[0.08em]">
            {rule
              ? t("governance.quality.editTitle")
              : step === "kind"
                ? t("governance.quality.addTitle")
                : t("governance.qualityBuilder.newOf", {
                    kind: kindTitle(draft.kind),
                  })}
          </h3>
        </div>
        {!rule && (
          <ol className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em]">
            {stepLabels.map(([id, label], index) => {
              const at = stepLabels.findIndex(([s]) => s === step);
              return (
                <li
                  key={id}
                  className={cn(
                    "rounded-[4px] border px-2 py-1",
                    index === at
                      ? "border-border bg-accent text-accent-foreground"
                      : index < at
                        ? "border-border/60 text-foreground"
                        : "border-border/30 text-muted-foreground",
                  )}
                >
                  {index + 1}. {label}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {step === "kind" && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {(["library", "sql", "detector", "metadata"] as const).map((kind) => (
            <ChoiceCard
              key={kind}
              icon={KIND_ICON[kind]}
              title={kindTitle(kind)}
              tagline={t(
                `governance.qualityBuilder.kind.${kind}.tagline` as TranslationKey,
              )}
              description={t(
                `governance.qualityBuilder.kind.${kind}.body` as TranslationKey,
              )}
              disabled={!isTable && (kind === "library" || kind === "sql")}
              disabledReason={t("governance.qualityBuilder.notTable")}
              badge={
                kind === "detector" && options ? (
                  <Badge variant="outline" className="rounded-[4px] text-[10px]">
                    {t("governance.qualityBuilder.nowFindings", {
                      count: options.openFindings,
                    })}
                  </Badge>
                ) : kind === "library" && options?.columns.length ? (
                  <Badge variant="outline" className="rounded-[4px] text-[10px]">
                    {t("governance.qualityBuilder.columnsCount", {
                      count: options.columns.length,
                    })}
                  </Badge>
                ) : undefined
              }
              onClick={() => chooseKind(kind)}
              testId={`rule-kind-${kind}`}
            />
          ))}
        </div>
      )}

      {step === "template" && (
        <AiAssistedCard
          title={t("governance.qualityBuilder.templatesTitle")}
          description={t(
            `governance.qualityBuilder.kind.${draft.kind}.body` as TranslationKey,
          )}
        >
          {!options ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <ChoiceCard
                icon={FileText}
                title={t("ai.startBlank")}
                description={t("governance.qualityBuilder.blank")}
                badge={
                  <Badge className="rounded-[4px] border border-border bg-accent text-accent-foreground">
                    {t("ai.start")}
                  </Badge>
                }
                onClick={() => chooseTemplate(null)}
                testId="rule-template-blank"
              />
              {templatesFor(draft.kind, options, t).map((template) => (
                <ChoiceCard
                  key={template.id}
                  icon={Sparkles}
                  title={template.title}
                  description={template.description}
                  badge={
                    template.now ? (
                      <Badge
                        variant="outline"
                        className="rounded-[4px] font-mono text-[10px]"
                      >
                        {template.now}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="rounded-[4px] text-[10px]"
                      >
                        {t("ai.template")}
                      </Badge>
                    )
                  }
                  onClick={() => chooseTemplate(template)}
                  testId={`rule-template-${template.id}`}
                />
              ))}
            </div>
          )}
        </AiAssistedCard>
      )}

      {step === "form" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-4">
            <Section
              title={t("governance.qualityBuilder.section.what")}
              description={t(
                `governance.qualityBuilder.kind.${draft.kind}.body` as TranslationKey,
              )}
            >
              {draft.kind === "library" && (
                <>
                  <div className="space-y-1.5">
                    <Label>{t("governance.quality.measure")}</Label>
                    <Select
                      value={draft.metric}
                      onValueChange={(metric) =>
                        set({
                          metric,
                          dimension:
                            metric === "duplicateValues"
                              ? "uniqueness"
                              : metric === "invalidValues"
                                ? "conformity"
                                : "completeness",
                          ...(metric === "rowCount"
                            ? { operator: "mustBeGreaterThan", low: "0", unit: "rows", column: WHOLE }
                            : {}),
                        })
                      }
                    >
                      <SelectTrigger data-testid="rule-metric">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LIBRARY_METRICS.map((metric) => (
                          <SelectItem key={metric} value={metric}>
                            {t(`governance.quality.metric.${metric}` as TranslationKey)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {t(`governance.qualityBuilder.metricHint.${draft.metric}` as TranslationKey)}
                    </p>
                  </div>
                  {draft.metric !== "rowCount" && (
                    <div className="space-y-1.5">
                      <Label>
                        {draft.metric === "duplicateValues" && draft.column === WHOLE
                          ? t("governance.qualityBuilder.uniqueTogether")
                          : t("governance.qualityBuilder.column")}
                      </Label>
                      <ColumnPicker
                        columns={columns}
                        findings={findingsByColumn}
                        value={draft.column}
                        onChange={(column) => set({ column })}
                        allowWhole={draft.metric === "duplicateValues"}
                      />
                      {draft.metric === "duplicateValues" && draft.column === WHOLE && (
                        <ColumnPicker
                          columns={columns}
                          multiple
                          values={draft.properties}
                          onToggle={(column) =>
                            set({
                              properties: draft.properties.includes(column)
                                ? draft.properties.filter((c) => c !== column)
                                : [...draft.properties, column],
                            })
                          }
                        />
                      )}
                    </div>
                  )}
                  {draft.metric === "invalidValues" && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="rule-valid">{t("governance.quality.validValues")}</Label>
                        <Input id="rule-valid" value={draft.validValues} placeholder="open, paid, void" onChange={(event) => set({ validValues: event.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="rule-pattern">{t("governance.quality.pattern")}</Label>
                        <Input id="rule-pattern" className="font-mono" value={draft.pattern} placeholder="^[A-Z]{2}[0-9]+$" onChange={(event) => set({ pattern: event.target.value })} />
                      </div>
                    </div>
                  )}
                  {draft.metric === "missingValues" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="rule-missing">{t("governance.quality.missingValues")}</Label>
                      <Input id="rule-missing" value={draft.missingValues} placeholder="N/A, -, unknown" onChange={(event) => set({ missingValues: event.target.value })} />
                    </div>
                  )}
                </>
              )}

              {draft.kind === "sql" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="rule-query">{t("governance.quality.query")}</Label>
                    <Textarea
                      id="rule-query"
                      rows={5}
                      className="font-mono text-xs"
                      value={draft.query}
                      onChange={(event) => set({ query: event.target.value })}
                      data-testid="rule-query"
                    />
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      <span className="rounded-[4px] border border-border/60 bg-muted px-1.5 py-0.5 font-mono">
                        {"{object}"} = {options?.table ?? "…"}
                      </span>
                      <span className="rounded-[4px] border border-border/60 bg-muted px-1.5 py-0.5 font-mono">
                        {"{property}"} = {draft.column !== WHOLE ? draft.column : t("governance.qualityBuilder.noColumn")}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("governance.qualityBuilder.sqlHint")}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("governance.qualityBuilder.propertyColumn", { property: "{property}" })}</Label>
                    <ColumnPicker columns={columns} value={draft.column} onChange={(column) => set({ column })} allowWhole />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("governance.qualityBuilder.resolved")}</Label>
                    <pre className="overflow-x-auto whitespace-pre-wrap rounded-[4px] border border-border/60 bg-muted/40 p-3 font-mono text-[11px]" data-testid="rule-resolved-query">
                      {resolvedQuery}
                    </pre>
                  </div>
                </>
              )}

              {draft.kind === "detector" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>{t("governance.quality.detector")}</Label>
                    <Select value={draft.detectorType} onValueChange={(detectorType) => set({ detectorType })}>
                      <SelectTrigger data-testid="rule-detector">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ANY}>
                          {t("governance.quality.anyFindings")} ({options?.openFindings ?? 0})
                        </SelectItem>
                        {(options?.detectorTypes ?? []).map((d) => (
                          <SelectItem key={d.value} value={d.value}>
                            {d.value} ({d.count})
                          </SelectItem>
                        ))}
                        {draft.detectorType !== ANY &&
                          !(options?.detectorTypes ?? []).some((d) => d.value === draft.detectorType) && (
                            <SelectItem value={draft.detectorType}>{draft.detectorType} (0)</SelectItem>
                          )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("governance.quality.findingType")}</Label>
                    <Select value={draft.findingType || ANY} onValueChange={(value) => set({ findingType: value === ANY ? "" : value })}>
                      <SelectTrigger data-testid="rule-finding-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ANY}>{t("governance.qualityBuilder.anyType")}</SelectItem>
                        {(options?.findingTypes ?? []).map((f) => (
                          <SelectItem key={f.value} value={f.value}>
                            {f.value} ({f.count})
                          </SelectItem>
                        ))}
                        {draft.findingType &&
                          !(options?.findingTypes ?? []).some((f) => f.value === draft.findingType) && (
                            <SelectItem value={draft.findingType}>{draft.findingType} (0)</SelectItem>
                          )}
                      </SelectContent>
                    </Select>
                  </div>
                  {(options?.customDetectors.length ?? 0) > 0 && (
                    <div className="space-y-1.5">
                      <Label>{t("governance.quality.customKey")}</Label>
                      <Select value={draft.customDetectorKey || ANY} onValueChange={(value) => set({ customDetectorKey: value === ANY ? "" : value })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ANY}>{t("governance.qualityBuilder.anyType")}</SelectItem>
                          {options!.customDetectors.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {c.value} ({c.count})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>{t("governance.quality.where")}</Label>
                    {columns.length ? (
                      <ColumnPicker columns={columns} findings={findingsByColumn} value={draft.column} onChange={(column) => set({ column })} allowWhole />
                    ) : (
                      <p className="text-xs text-muted-foreground">{t("governance.quality.wholeAsset")}</p>
                    )}
                  </div>
                </div>
              )}

              {draft.kind === "metadata" && (
                <div className="space-y-1.5">
                  <Label>{t("governance.quality.measure")}</Label>
                  <Select
                    value={draft.metric}
                    onValueChange={(metric) =>
                      set({
                        metric,
                        dimension: metric === "freshness" ? "timeliness" : "completeness",
                        operator: metric === "freshness" ? "mustBeLessOrEqualTo" : "mustBeGreaterThan",
                        low: metric === "freshness" ? "24" : "0",
                      })
                    }
                  >
                    <SelectTrigger data-testid="rule-metric">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rowCount">{t("governance.quality.metric.rowCount")}</SelectItem>
                      <SelectItem value="freshness">{t("governance.quality.metric.freshness")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {draft.metric === "rowCount"
                      ? options?.rowCount != null
                        ? t("governance.qualityBuilder.scanRows", { count: options.rowCount })
                        : t("governance.qualityBuilder.scanNoRows")
                      : options?.lastScannedAt
                        ? t("governance.qualityBuilder.scanWhen", { when: new Date(options.lastScannedAt).toLocaleString() })
                        : t("governance.qualityBuilder.scanNever")}
                  </p>
                </div>
              )}
            </Section>

            <Section
              title={t("governance.qualityBuilder.section.fails")}
              description={t("governance.qualityBuilder.section.failsBody")}
            >
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[200px] flex-1 space-y-1.5">
                  <Label>{t("governance.quality.condition")}</Label>
                  <Select value={draft.operator} onValueChange={(operator) => set({ operator })}>
                    <SelectTrigger data-testid="rule-operator">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {QUALITY_OPERATORS.map((operator) => (
                        <SelectItem key={operator} value={operator}>
                          {t(`governance.quality.operator.${operator}` as TranslationKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input type="number" className="w-28" value={draft.low} onChange={(event) => set({ low: event.target.value })} aria-label={t("governance.quality.threshold")} data-testid="rule-threshold" />
                {isBetween(draft.operator) && (
                  <Input type="number" className="w-28" value={draft.high} onChange={(event) => set({ high: event.target.value })} aria-label={t("governance.quality.upper")} />
                )}
                {draft.kind === "library" && draft.metric !== "rowCount" ? (
                  <Select value={draft.unit} onValueChange={(value) => set({ unit: value as Draft["unit"] })}>
                    <SelectTrigger className="w-32" data-testid="rule-unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rows">{t("governance.quality.unit.rows")}</SelectItem>
                      <SelectItem value="percent">{t("governance.quality.unit.percent")}</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="pb-2 text-sm text-muted-foreground">{unitLabel(draft, t)}</span>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{t("governance.quality.severity")}</Label>
                  <Select value={draft.severity} onValueChange={(severity) => set({ severity })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SEVERITIES.map((severity) => (
                        <SelectItem key={severity} value={severity}>
                          {severity}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("governance.quality.dimensionLabel")}</Label>
                  <Select value={draft.dimension} onValueChange={(dimension) => set({ dimension })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {QUALITY_DIMENSIONS.map((dimension) => (
                        <SelectItem key={dimension} value={dimension}>
                          {t(`governance.quality.dimension.${dimension}` as TranslationKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </Section>

            <Section title={t("governance.qualityBuilder.section.about")}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rule-name">{t("governance.quality.name")}</Label>
                  <Input id="rule-name" value={draft.name} placeholder={suggested} onChange={(event) => set({ name: event.target.value })} />
                </div>
                {(draft.kind === "library" || draft.kind === "sql") ? (
                  <div className="space-y-1.5">
                    <Label>{t("governance.quality.schedule")}</Label>
                    <Select value={draft.schedule} onValueChange={(schedule) => set({ schedule })}>
                      <SelectTrigger data-testid="rule-schedule">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SCHEDULES.map((schedule) => (
                          <SelectItem key={schedule} value={schedule}>
                            {t(`governance.quality.scheduleOption.${schedule}` as TranslationKey)}
                          </SelectItem>
                        ))}
                        {!SCHEDULES.includes(draft.schedule as (typeof SCHEDULES)[number]) && (
                          <SelectItem value={draft.schedule}>{draft.schedule}</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label>{t("governance.quality.schedule")}</Label>
                    <p className="pt-2 text-sm text-muted-foreground">
                      {t("governance.quality.scheduleOption.scan")}
                    </p>
                  </div>
                )}
              </div>
            </Section>
          </div>

          <aside className="space-y-4 self-start lg:sticky lg:top-4">
            <Card className="border-2" data-testid="rule-preview">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FlaskConical className="h-4 w-4" aria-hidden />
                  {t("governance.qualityBuilder.preview")}
                </CardTitle>
                <CardDescription>{t("governance.qualityBuilder.previewBody")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-[4px] border border-border/60 bg-muted/30 p-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {draft.name.trim() || suggested}
                  </div>
                  <div className="mt-1 text-sm font-medium" data-testid="rule-sentence">
                    {describe(draft)}
                  </div>
                </div>
                <Button
                  className="w-full"
                  variant={testIsCurrent ? "outline" : "default"}
                  onClick={() => void runTest()}
                  disabled={testing}
                  data-testid="rule-test"
                >
                  {testing ? <Spinner size="sm" /> : <Play className="h-3.5 w-3.5" aria-hidden />}
                  {testing
                    ? t("governance.qualityBuilder.testing")
                    : t("governance.qualityBuilder.test")}
                </Button>
                {test && (
                  <TestResult
                    result={test.result}
                    stale={!testIsCurrent}
                    unit={unitLabel(draft, t)}
                  />
                )}
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {t(`governance.qualityBuilder.runs.${draft.kind}` as TranslationKey)}
                </p>
              </CardContent>
            </Card>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button className="flex-1" onClick={() => void save()} disabled={busy} data-testid="rule-save">
                {t("governance.quality.saveAndRun")}
              </Button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function TestResult({
  result,
  stale,
  unit,
}: {
  result: QualityTestResultDto;
  stale: boolean;
  unit: string;
}) {
  const { t } = useTranslation();
  const state =
    result.passed === null ? "error" : result.passed ? "pass" : "fail";
  const Icon =
    state === "pass" ? CheckCircle2 : state === "fail" ? XCircle : TriangleAlert;
  return (
    <div
      className={cn("space-y-3 rounded-[4px] border p-3", stale && "opacity-60")}
      data-testid="rule-test-result"
      data-state={state}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t("governance.qualityBuilder.measuredNow")}
          </div>
          <div className="text-3xl font-black leading-tight">
            {result.measuredValue ?? "—"}
            <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>
          </div>
        </div>
        <ToneBadge tone={state === "pass" ? "done" : state === "fail" ? "error" : "progress"} className="gap-1">
          <Icon className="h-3 w-3" aria-hidden />
          {state === "pass"
            ? t("governance.quality.passing")
            : state === "fail"
              ? t("governance.quality.failing")
              : t("governance.quality.error")}
        </ToneBadge>
      </div>
      {result.error && (
        <p className="text-xs text-amber-700 dark:text-amber-400">{result.error}</p>
      )}
      {result.failure && (
        <p className="text-xs">
          <span className="text-muted-foreground">{t("governance.qualityBuilder.wouldSay")} </span>
          {result.failure}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-2 text-[11px]">
        {result.rowsChecked !== null && result.rowsChecked !== undefined && (
          <div>
            <dt className="text-muted-foreground">{t("governance.qualityBuilder.rowsChecked")}</dt>
            <dd className="font-mono">{result.rowsChecked.toLocaleString()}</dd>
          </div>
        )}
        <div>
          <dt className="text-muted-foreground">{t("governance.qualityBuilder.took")}</dt>
          <dd className="font-mono">{(result.tookMs / 1000).toFixed(1)} s</dd>
        </div>
      </dl>
      {result.sql && (
        <details>
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            {t("governance.qualityBuilder.queryRan")}
          </summary>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-[4px] bg-muted/40 p-2 font-mono text-[10px]">
            {result.sql}
          </pre>
        </details>
      )}
      {stale && (
        <p className="text-[11px] italic text-muted-foreground">
          {t("governance.qualityBuilder.stale")}
        </p>
      )}
    </div>
  );
}
