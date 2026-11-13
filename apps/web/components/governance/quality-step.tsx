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
} from "@workspace/api-client";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
  ToneBadge,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import { useNsPath } from "@/lib/ns-path";
import {
  QualityRuleBuilder,
  SCHEDULES,
  scheduleOf,
  KIND_ICON,
  type RuleKind,
} from "./quality-rule-builder";
import { QualityLifecycle } from "./quality-lifecycle";

function KindIcon({ kind }: { kind: RuleKind }) {
  const { t } = useTranslation();
  const Icon = KIND_ICON[kind] ?? CircleDashed;
  return (
    <span
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] border border-border/60 bg-muted/40"
      title={t(`governance.qualityBuilder.kind.${kind}.title` as TranslationKey)}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
    </span>
  );
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

/**
 * Data quality of an asset (GOV §5.4): rules, ODCS-shaped, each keeping its
 * results; a failing one keeps a QUALITY finding open. Rules check a column
 * or the whole table with a query (library, SQL — tables SQL can read), count
 * open findings, or read what the scan recorded.
 */
export function QualityStep({
  assetId,
  quality,
  isTable,
  onChange,
}: {
  assetId: string;
  quality: AssetQualityDto | null;
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

  if (editing) {
    return (
      <QualityRuleBuilder
        assetId={assetId}
        isTable={isTable}
        rule={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={onChange}
      />
    );
  }

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
      <CardContent className="space-y-4">
        <QualityLifecycle defaultOpen={quality.rules.length === 0} />
        {quality.rules.length > 0 && (
          <ul className="divide-y divide-border/60">
            {quality.rules.map((rule) => (
              <li
                key={rule.id}
                className="flex items-center gap-3 py-2.5"
                data-testid="quality-rule"
              >
                <StatusIcon rule={rule} measuring={measuring} />
                <KindIcon kind={rule.type as RuleKind} />
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
        )}
      </CardContent>
    </Card>
  );
}
