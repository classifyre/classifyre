"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Pencil,
  Play,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  api,
  type AssetQualityDto,
  type QualityRuleDto,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import { useNsPath } from "@/lib/ns-path";
import {
  isBetween,
  QUALITY_DIMENSIONS,
  QUALITY_OPERATORS,
} from "@/lib/governance";

const DETECTORS = [
  "PII",
  "SECRETS",
  "YARA",
  "BROKEN_LINKS",
  "CODE_SECURITY",
  "CUSTOM",
];
const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
const LIBRARY_METRICS = [
  "nullValues",
  "missingValues",
  "invalidValues",
  "duplicateValues",
  "rowCount",
] as const;
const SCHEDULES = ["scan", "hourly", "daily", "weekly"] as const;
const PRESET_CRON: Record<string, string> = {
  hourly: "0 * * * *",
  daily: "0 6 * * *",
  weekly: "0 6 * * 1",
};
const ANY = "__any__";
const WHOLE = "__whole__";

type Kind = "detector" | "metadata" | "library" | "sql";

interface Draft {
  kind: Kind;
  metric: string;
  detectorType: string;
  customDetectorKey: string;
  findingType: string;
  column: string;
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
  detectorType: "PII",
  customDetectorKey: "",
  findingType: "",
  column: WHOLE,
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

/** What each kind starts with, so a switch lands on a sensible rule. */
const KIND_DEFAULTS: Record<Kind, Partial<Draft>> = {
  library: {
    metric: "nullValues",
    dimension: "completeness",
    operator: "mustBe",
    low: "0",
  },
  sql: { metric: "query", dimension: "accuracy", operator: "mustBe", low: "0" },
  detector: {
    metric: "openFindings",
    dimension: "conformity",
    operator: "mustBe",
    low: "0",
  },
  metadata: {
    metric: "rowCount",
    dimension: "completeness",
    operator: "mustBeGreaterThan",
    low: "0",
  },
};

const list = (text: string) =>
  text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

function scheduleOf(cron: string | null | undefined): string {
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
    kind: rule.type as Kind,
    metric: rule.metric,
    detectorType: args.detectorType ?? ANY,
    customDetectorKey: args.customDetectorKey ?? "",
    findingType: args.findingType ?? "",
    column: rule.columnName ?? WHOLE,
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

function StatusIcon({
  rule,
  measuring,
}: {
  rule: QualityRuleDto;
  measuring: boolean;
}) {
  const { t } = useTranslation();
  if (measuring && (rule.type === "library" || rule.type === "sql")) {
    return <Spinner size="sm" />;
  }
  if (!rule.enabled || !rule.latest) {
    return (
      <CircleDashed
        className="h-4 w-4 text-muted-foreground"
        aria-label={t(
          rule.enabled
            ? "governance.quality.never"
            : "governance.quality.disabled",
        )}
      />
    );
  }
  if (rule.latest.error) {
    return (
      <AlertTriangle
        className="h-4 w-4 text-amber-600"
        aria-label={t("governance.quality.error")}
      />
    );
  }
  return rule.latest.passed ? (
    <CheckCircle2
      className="h-4 w-4 text-accent-ink"
      aria-label={t("governance.quality.passing")}
    />
  ) : (
    <XCircle
      className="h-4 w-4 text-destructive"
      aria-label={t("governance.quality.failing")}
    />
  );
}

/** Each kept result as a bar: green passed, red failed, amber not measured. */
function History({ rule }: { rule: QualityRuleDto }) {
  if (!rule.history.length) return null;
  return (
    <div className="flex h-5 items-end gap-px" aria-hidden>
      {rule.history.map((result, index) => (
        <div
          key={index}
          title={`${new Date(result.evaluatedAt).toLocaleString()}: ${
            result.error ?? result.measuredValue
          }`}
          className={
            "w-1.5 rounded-sm " +
            (result.error
              ? "h-2 bg-amber-500"
              : result.passed
                ? "h-3 bg-accent-ink/80"
                : "h-5 bg-destructive")
          }
        />
      ))}
    </div>
  );
}

function RuleDialog({
  assetId,
  columns,
  isTable,
  rule,
  onClose,
  onSaved,
}: {
  assetId: string;
  columns: string[];
  /** Whether SQL can read this asset: library and sql rules need it. */
  isTable: boolean;
  rule: QualityRuleDto | null;
  onClose: () => void;
  onSaved: (next: AssetQualityDto) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(() =>
    rule
      ? draftOf(rule)
      : isTable
        ? { ...EMPTY, column: columns[0] ?? WHOLE }
        : { ...EMPTY, kind: "detector", ...KIND_DEFAULTS.detector },
  );
  const [busy, setBusy] = useState(false);
  // A column check on "the whole asset" means nothing: start on a column.
  const set = (patch: Partial<Draft>) =>
    setDraft((d) => {
      const next = { ...d, ...patch };
      const needsColumn =
        next.kind === "library" &&
        ["nullValues", "missingValues", "invalidValues"].includes(next.metric);
      return needsColumn && next.column === WHOLE && columns[0]
        ? { ...next, column: columns[0] }
        : next;
    });
  const columnOrWhole = draft.column === WHOLE ? null : draft.column;

  const unitKey =
    draft.kind === "library"
      ? draft.unit === "percent"
        ? "percent"
        : "rows"
      : draft.metric;
  const unit = t(`governance.quality.unit.${unitKey}` as TranslationKey);

  const suggestedName = (() => {
    if (draft.kind === "metadata") {
      return draft.metric === "rowCount"
        ? t("governance.quality.suggest.rowCount")
        : t("governance.quality.suggest.freshness");
    }
    if (draft.kind === "library") {
      return t(`governance.quality.suggest.${draft.metric}` as TranslationKey, {
        column: columnOrWhole ?? t("governance.quality.wholeAsset"),
      });
    }
    if (draft.kind === "sql") return t("governance.quality.suggest.sql");
    const what =
      draft.detectorType === ANY
        ? t("governance.quality.anyFindings")
        : draft.detectorType;
    return columnOrWhole
      ? t("governance.quality.suggest.findingsIn", {
          what,
          column: columnOrWhole,
        })
      : t("governance.quality.suggest.findings", { what });
  })();

  const argumentsOf = (): Record<string, unknown> => {
    if (draft.kind === "detector") {
      return {
        ...(draft.detectorType !== ANY
          ? { detectorType: draft.detectorType }
          : {}),
        ...(draft.customDetectorKey.trim()
          ? { customDetectorKey: draft.customDetectorKey.trim() }
          : {}),
        ...(draft.findingType.trim()
          ? { findingType: draft.findingType.trim() }
          : {}),
      };
    }
    if (draft.kind === "library") {
      return {
        ...(draft.metric === "invalidValues" && list(draft.validValues).length
          ? { validValues: list(draft.validValues) }
          : {}),
        ...(draft.metric === "invalidValues" && draft.pattern.trim()
          ? { pattern: draft.pattern.trim() }
          : {}),
        ...(draft.metric === "missingValues" && list(draft.missingValues).length
          ? { missingValues: list(draft.missingValues) }
          : {}),
      };
    }
    if (draft.kind === "sql") return { query: draft.query.trim() };
    return {};
  };

  const save = async () => {
    const low = Number(draft.low);
    const high = Number(draft.high);
    const body = {
      name: draft.name.trim() || suggestedName,
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
          : columnOrWhole,
      arguments: argumentsOf(),
      ...(draft.kind === "library" ? { unit: draft.unit } : {}),
      schedule:
        draft.kind === "library" || draft.kind === "sql"
          ? draft.schedule === "scan"
            ? null
            : draft.schedule
          : null,
    } as SaveQualityRuleDto;
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

  const columnSelect = (allowWhole: boolean) => (
    <div className="space-y-1.5">
      <Label>{t("governance.quality.where")}</Label>
      <Select value={draft.column} onValueChange={(column) => set({ column })}>
        <SelectTrigger data-testid="rule-column">
          <SelectValue placeholder={t("governance.quality.pickColumn")} />
        </SelectTrigger>
        <SelectContent>
          {allowWhole && (
            <SelectItem value={WHOLE}>
              {t("governance.quality.wholeAsset")}
            </SelectItem>
          )}
          {columns.map((column) => (
            <SelectItem key={column} value={column}>
              {column}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {rule
              ? t("governance.quality.editTitle")
              : t("governance.quality.addTitle")}
          </DialogTitle>
          <DialogDescription>
            {t(`governance.quality.kindHint.${draft.kind}` as TranslationKey, {
              object: "{object}",
              property: "{property}",
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ToggleGroup
            type="single"
            value={draft.kind}
            onValueChange={(value) => {
              if (!value) return;
              const kind = value as Kind;
              set({ kind, ...KIND_DEFAULTS[kind] });
            }}
            className="flex-wrap justify-start"
          >
            {(["library", "sql", "detector", "metadata"] as const).map(
              (kind) => (
                <ToggleGroupItem
                  key={kind}
                  value={kind}
                  disabled={!isTable && (kind === "library" || kind === "sql")}
                  data-testid={`rule-kind-${kind}`}
                >
                  {t(`governance.quality.kind.${kind}` as TranslationKey)}
                </ToggleGroupItem>
              ),
            )}
          </ToggleGroup>

          {draft.kind === "library" && (
            <div className="grid gap-3 sm:grid-cols-2">
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
                        ? {
                            operator: "mustBeGreaterThan",
                            low: "0",
                            unit: "rows",
                          }
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
                        {t(
                          `governance.quality.metric.${metric}` as TranslationKey,
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {draft.metric !== "rowCount" &&
                columnSelect(draft.metric === "duplicateValues")}
              {draft.metric === "invalidValues" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="rule-valid">
                      {t("governance.quality.validValues")}
                    </Label>
                    <Input
                      id="rule-valid"
                      value={draft.validValues}
                      placeholder="open, paid, void"
                      onChange={(event) =>
                        set({ validValues: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rule-pattern">
                      {t("governance.quality.pattern")}
                    </Label>
                    <Input
                      id="rule-pattern"
                      value={draft.pattern}
                      placeholder="^[A-Z]{2}[0-9]+$"
                      onChange={(event) => set({ pattern: event.target.value })}
                    />
                  </div>
                </>
              )}
              {draft.metric === "missingValues" && (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="rule-missing">
                    {t("governance.quality.missingValues")}
                  </Label>
                  <Input
                    id="rule-missing"
                    value={draft.missingValues}
                    placeholder="N/A, -, unknown"
                    onChange={(event) =>
                      set({ missingValues: event.target.value })
                    }
                  />
                </div>
              )}
            </div>
          )}

          {draft.kind === "sql" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="rule-query">
                  {t("governance.quality.query")}
                </Label>
                <Textarea
                  id="rule-query"
                  rows={4}
                  className="font-mono text-xs"
                  value={draft.query}
                  onChange={(event) => set({ query: event.target.value })}
                  data-testid="rule-query"
                />
                <p className="text-xs text-muted-foreground">
                  {t("governance.quality.queryHint", {
                    object: "{object}",
                    property: "{property}",
                  })}
                </p>
              </div>
              {columnSelect(true)}
            </div>
          )}

          {draft.kind === "detector" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("governance.quality.detector")}</Label>
                <Select
                  value={draft.detectorType}
                  onValueChange={(detectorType) => set({ detectorType })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>
                      {t("governance.quality.anyFindings")}
                    </SelectItem>
                    {DETECTORS.map((detector) => (
                      <SelectItem key={detector} value={detector}>
                        {detector}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {columnSelect(true)}
              {draft.detectorType === "CUSTOM" && (
                <div className="space-y-1.5">
                  <Label htmlFor="rule-custom">
                    {t("governance.quality.customKey")}
                  </Label>
                  <Input
                    id="rule-custom"
                    value={draft.customDetectorKey}
                    onChange={(event) =>
                      set({ customDetectorKey: event.target.value })
                    }
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="rule-type">
                  {t("governance.quality.findingType")}
                </Label>
                <Input
                  id="rule-type"
                  value={draft.findingType}
                  placeholder="EMAIL_ADDRESS"
                  onChange={(event) => set({ findingType: event.target.value })}
                />
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
                    dimension:
                      metric === "freshness" ? "timeliness" : "completeness",
                    operator:
                      metric === "freshness"
                        ? "mustBeLessOrEqualTo"
                        : "mustBeGreaterThan",
                    low: metric === "freshness" ? "24" : "0",
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rowCount">
                    {t("governance.quality.metric.rowCount")}
                  </SelectItem>
                  <SelectItem value="freshness">
                    {t("governance.quality.metric.freshness")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label>{t("governance.quality.condition")}</Label>
              <Select
                value={draft.operator}
                onValueChange={(operator) => set({ operator })}
              >
                <SelectTrigger data-testid="rule-operator">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUALITY_OPERATORS.map((operator) => (
                    <SelectItem key={operator} value={operator}>
                      {t(
                        `governance.quality.operator.${operator}` as TranslationKey,
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              type="number"
              className="w-24"
              value={draft.low}
              onChange={(event) => set({ low: event.target.value })}
              aria-label={t("governance.quality.threshold")}
              data-testid="rule-threshold"
            />
            {isBetween(draft.operator) ? (
              <Input
                type="number"
                className="w-24"
                value={draft.high}
                onChange={(event) => set({ high: event.target.value })}
                aria-label={t("governance.quality.upper")}
              />
            ) : draft.kind === "library" && draft.metric !== "rowCount" ? (
              <Select
                value={draft.unit}
                onValueChange={(value) => set({ unit: value as Draft["unit"] })}
              >
                <SelectTrigger className="w-28" data-testid="rule-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rows">
                    {t("governance.quality.unit.rows")}
                  </SelectItem>
                  <SelectItem value="percent">
                    {t("governance.quality.unit.percent")}
                  </SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <span className="pb-2 text-sm text-muted-foreground">{unit}</span>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>{t("governance.quality.dimensionLabel")}</Label>
              <Select
                value={draft.dimension}
                onValueChange={(dimension) => set({ dimension })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUALITY_DIMENSIONS.map((dimension) => (
                    <SelectItem key={dimension} value={dimension}>
                      {t(
                        `governance.quality.dimension.${dimension}` as TranslationKey,
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("governance.quality.severity")}</Label>
              <Select
                value={draft.severity}
                onValueChange={(severity) => set({ severity })}
              >
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
            {(draft.kind === "library" || draft.kind === "sql") && (
              <div className="space-y-1.5">
                <Label>{t("governance.quality.schedule")}</Label>
                <Select
                  value={draft.schedule}
                  onValueChange={(schedule) => set({ schedule })}
                >
                  <SelectTrigger data-testid="rule-schedule">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCHEDULES.map((schedule) => (
                      <SelectItem key={schedule} value={schedule}>
                        {t(
                          `governance.quality.scheduleOption.${schedule}` as TranslationKey,
                        )}
                      </SelectItem>
                    ))}
                    {!SCHEDULES.includes(
                      draft.schedule as (typeof SCHEDULES)[number],
                    ) && (
                      <SelectItem value={draft.schedule}>
                        {draft.schedule}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-name">{t("governance.quality.name")}</Label>
            <Input
              id="rule-name"
              value={draft.name}
              placeholder={suggestedName}
              onChange={(event) => set({ name: event.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => void save()}
            disabled={busy}
            data-testid="rule-save"
          >
            {t("governance.quality.saveAndRun")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Data quality of an asset (GOV §5.4): rules, ODCS-shaped, each keeping its
 * results; a failing one keeps a QUALITY finding open. Rules check a column
 * or the whole table with a query (library, SQL — tables SQL can read), count
 * open findings, or read what the scan recorded.
 */
export function QualityStep({
  assetId,
  quality,
  columns,
  isTable,
  onChange,
}: {
  assetId: string;
  quality: AssetQualityDto | null;
  columns: string[];
  isTable: boolean;
  onChange: (next: AssetQualityDto) => void;
}) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const [editing, setEditing] = useState<QualityRuleDto | "new" | null>(null);
  const [running, setRunning] = useState(false);
  const measuring = Boolean(quality?.measuring);

  // A whole-table query answers in seconds to a minute: follow it.
  useEffect(() => {
    if (!measuring) return;
    const timer = setInterval(() => {
      api.governance
        .governanceControllerAssetQuality({ id: assetId })
        .then(onChange)
        .catch(() => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [measuring, assetId, onChange]);

  if (!quality) {
    return (
      <Card>
        <CardContent className="flex justify-center py-6">
          <Spinner />
        </CardContent>
      </Card>
    );
  }

  const run = async () => {
    setRunning(true);
    try {
      onChange(
        await api.governance.governanceControllerRunQuality({ id: assetId }),
      );
    } catch (error) {
      toast.error(
        await extractApiErrorMessage(error, t("governance.saveFailed")),
      );
    } finally {
      setRunning(false);
    }
  };

  const remove = async (rule: QualityRuleDto) => {
    try {
      onChange(
        await api.governance.governanceControllerRemoveQualityRule({
          ruleId: rule.id,
        }),
      );
    } catch (error) {
      toast.error(
        await extractApiErrorMessage(error, t("governance.saveFailed")),
      );
    }
  };

  const describe = (rule: QualityRuleDto) => {
    const threshold = rule.threshold as number | number[];
    const bound = Array.isArray(threshold)
      ? `${threshold[0]}–${threshold[1]}`
      : String(threshold);
    const what =
      rule.type === "detector"
        ? `${rule.arguments.detectorType ?? t("governance.quality.anyFindings")}${
            rule.arguments.findingType ? ` ${rule.arguments.findingType}` : ""
          }`
        : rule.type === "sql"
          ? t("governance.quality.metric.query")
          : t(`governance.quality.metric.${rule.metric}` as TranslationKey);
    const where = rule.columnName ? ` · ${rule.columnName}` : "";
    return `${what}${where} — ${t(
      `governance.quality.operator.${rule.operator}` as TranslationKey,
    )} ${bound} ${t(`governance.quality.unit.${rule.unit}` as TranslationKey)}`;
  };

  return (
    <Card data-testid="quality-step">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            {t("governance.quality.title")}
            {quality.score !== null && quality.score !== undefined && (
              <ToneBadge
                tone={quality.failing ? "error" : "done"}
                data-testid="quality-score"
              >
                {quality.score}
              </ToneBadge>
            )}
          </CardTitle>
          <CardDescription>
            {quality.rules.length === 0
              ? t("governance.quality.empty")
              : t("governance.quality.summary", {
                  rules: quality.rules.length,
                  failing: quality.failing,
                })}
            {measuring && (
              <span
                className="ml-2 inline-flex items-center gap-1"
                data-testid="quality-measuring"
              >
                <Spinner size="sm" />
                {t("governance.quality.measuring")}
              </span>
            )}
          </CardDescription>
        </div>
        {quality.canGovern && (
          <span className="flex shrink-0 gap-2">
            {quality.rules.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void run()}
                disabled={running || measuring}
                data-testid="quality-run"
              >
                <Play className="h-3.5 w-3.5" aria-hidden />
                {t("governance.quality.run")}
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => setEditing("new")}
              data-testid="quality-add"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t("governance.quality.add")}
            </Button>
          </span>
        )}
      </CardHeader>
      {quality.rules.length > 0 && (
        <CardContent>
          <ul className="divide-y divide-border/60">
            {quality.rules.map((rule) => (
              <li
                key={rule.id}
                className="flex items-center gap-3 py-2.5"
                data-testid="quality-rule"
              >
                <StatusIcon rule={rule} measuring={measuring} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {rule.name}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {t(
                        `governance.quality.dimension.${rule.dimension}` as TranslationKey,
                      )}
                    </Badge>
                    {rule.schedule && (
                      <span
                        className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground"
                        title={rule.schedule}
                      >
                        <Clock className="h-3 w-3" aria-hidden />
                        {SCHEDULES.includes(
                          scheduleOf(
                            rule.schedule,
                          ) as (typeof SCHEDULES)[number],
                        )
                          ? t(
                              `governance.quality.scheduleOption.${scheduleOf(rule.schedule)}` as TranslationKey,
                            )
                          : rule.schedule}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {describe(rule)}
                  </div>
                  {rule.latest && (
                    <div className="text-xs">
                      {rule.latest.error ? (
                        <span className="text-amber-700 dark:text-amber-400">
                          {rule.latest.error}
                        </span>
                      ) : (
                        <span>
                          {t("governance.quality.measured", {
                            value: rule.latest.measuredValue ?? "—",
                          })}
                        </span>
                      )}
                      {rule.findingId && (
                        <Link
                          href={nsPath(`/findings/${rule.findingId}`)}
                          className="ml-2 underline-offset-2 hover:underline"
                        >
                          {t("governance.quality.openFinding")}
                        </Link>
                      )}
                    </div>
                  )}
                </div>
                <History rule={rule} />
                {quality.canGovern && (
                  <span className="flex shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      aria-label={t("governance.quality.edit", {
                        name: rule.name,
                      })}
                      onClick={() => setEditing(rule)}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      aria-label={t("governance.quality.delete", {
                        name: rule.name,
                      })}
                      onClick={() => void remove(rule)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      )}
      {editing && (
        <RuleDialog
          assetId={assetId}
          columns={columns}
          isTable={isTable}
          rule={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={onChange}
        />
      )}
    </Card>
  );
}
