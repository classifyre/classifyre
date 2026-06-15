"use client";

import * as React from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  api,
  type CorrelationConfigResponseDto,
  type ExclusionRuleDto,
} from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Slider } from "@workspace/ui/components/slider";
import { Spinner } from "@workspace/ui/components/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { useTranslation } from "@/hooks/use-translation";

/**
 * Correlation tuning form — DB-backed weights, thresholds and exclusion rules.
 * Used both inline (the Fingerprints "Tune" tab) and inside a dialog. Saving
 * schedules a full recompute (a DUPLICATES FINDER run); `onSaved` fires after.
 */
export function CorrelationTuningPanel({
  onSaved,
  layout = "page",
}: {
  onSaved?: () => void;
  layout?: "page" | "dialog";
}) {
  const { t } = useTranslation();
  const [config, setConfig] = React.useState<CorrelationConfigResponseDto | null>(null);
  const [weights, setWeights] = React.useState<Record<string, number>>({});
  const [defaultWeight, setDefaultWeight] = React.useState(1);
  const [relatedMin, setRelatedMin] = React.useState(0.3);
  const [duplicateMin, setDuplicateMin] = React.useState(0.6);
  const [exclusions, setExclusions] = React.useState<ExclusionRuleDto[]>([]);
  const [exMode, setExMode] = React.useState<"value" | "regex" | "label">("value");
  const [exLabel, setExLabel] = React.useState("");
  const [exValue, setExValue] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const reload = React.useCallback(() => {
    setConfig(null);
    api.correlation
      .correlationControllerGetConfig()
      .then((c) => {
        setConfig(c);
        setWeights(Object.fromEntries(c.labels.map((l) => [l.label, l.weight])));
        setDefaultWeight(c.defaultWeight);
        setRelatedMin(c.relatedMin);
        setDuplicateMin(c.duplicateMin);
        setExclusions(c.exclusions ?? []);
      })
      .catch((e: unknown) =>
        toast.error(e instanceof Error ? e.message : t("correlation.tune.loadFailed")),
      );
  }, [t]);

  React.useEffect(() => reload(), [reload]);

  const save = async () => {
    setSaving(true);
    try {
      await api.correlation.correlationControllerUpdateConfig({
        updateCorrelationConfigDto: {
          defaultWeight,
          relatedMin: Math.min(relatedMin, duplicateMin),
          duplicateMin: Math.max(relatedMin, duplicateMin),
          labelWeights: weights,
          exclusions,
        },
      });
      toast.success(t("correlation.tune.saved"));
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("correlation.tune.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const addRule = () => {
    const label = exLabel.trim();
    const value = exValue.trim();
    if (exMode === "label" ? !label : !value) return;
    setExclusions((prev) => [
      ...prev,
      { mode: exMode, label: label || null, value: exMode === "label" ? null : value },
    ]);
    setExLabel("");
    setExValue("");
  };

  const ruleText = (r: ExclusionRuleDto) => {
    if (r.mode === "label") return `label = ${r.label}`;
    const scope = r.label ? `${r.label}: ` : "";
    return r.mode === "regex" ? `${scope}/${r.value}/` : `${scope}"${r.value}"`;
  };

  if (!config) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Spinner size="lg" label={t("correlation.tune.title")} />
      </div>
    );
  }

  const colsClass =
    layout === "page" ? "grid gap-4 lg:grid-cols-2" : "space-y-4";

  const Wrap = layout === "page" ? Card : React.Fragment;
  const wrapProps = layout === "page" ? {} : {};

  return (
    <div className="space-y-4">
      <div className={colsClass}>
        {/* ── Scoring ── */}
        <Wrap {...wrapProps}>
          {layout === "page" && (
            <CardHeader>
              <CardTitle className="text-base">
                {t("correlation.tune.scoringTitle")}
              </CardTitle>
              <CardDescription>{t("correlation.tune.desc")}</CardDescription>
            </CardHeader>
          )}
          <ContentWrap layout={layout}>
            <div className="space-y-4 rounded-[4px] border border-border bg-muted/30 p-3">
              <ThresholdSlider
                label={t("correlation.tune.relatedMin")}
                hint={t("correlation.tune.relatedMinHint")}
                value={relatedMin}
                onChange={setRelatedMin}
              />
              <ThresholdSlider
                label={t("correlation.tune.duplicateMin")}
                hint={t("correlation.tune.duplicateMinHint")}
                value={duplicateMin}
                onChange={setDuplicateMin}
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <div>
                <Label className="text-sm">{t("correlation.tune.defaultWeight")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("correlation.tune.defaultWeightHint")}
                </p>
              </div>
              <Input
                type="number"
                min={0}
                max={100}
                value={defaultWeight}
                onChange={(e) => setDefaultWeight(Number(e.target.value))}
                className="h-8 w-20"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm">{t("correlation.tune.labelWeights")}</Label>
              {config.labels.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("correlation.tune.noLabels")}
                </p>
              ) : (
                <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                  {config.labels.map((l) => (
                    <div
                      key={l.label}
                      className="flex items-center justify-between gap-3 rounded-[4px] border border-border/60 px-2.5 py-1.5"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-mono text-xs">{l.label}</span>
                        {!l.inUse && (
                          <Badge variant="outline" className="text-[9px] uppercase">
                            {t("correlation.tune.retired")}
                          </Badge>
                        )}
                      </div>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={weights[l.label] ?? defaultWeight}
                        onChange={(e) =>
                          setWeights((w) => ({ ...w, [l.label]: Number(e.target.value) }))
                        }
                        className="h-7 w-16"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ContentWrap>
        </Wrap>

        {/* ── Exclusions ── */}
        <Wrap {...wrapProps}>
          {layout === "page" && (
            <CardHeader>
              <CardTitle className="text-base">
                {t("correlation.tune.exclusions")}
              </CardTitle>
              <CardDescription>{t("correlation.tune.exclusionsHint")}</CardDescription>
            </CardHeader>
          )}
          <ContentWrap layout={layout}>
            {layout === "dialog" && (
              <div className="space-y-1">
                <Label className="text-sm">{t("correlation.tune.exclusions")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("correlation.tune.exclusionsHint")}
                </p>
              </div>
            )}
            {exclusions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("correlation.tune.noExclusions")}
              </p>
            ) : (
              <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {exclusions.map((r, i) => (
                  <div
                    key={r.id ?? i}
                    className="flex items-center justify-between gap-2 rounded-[4px] border border-border/60 px-2.5 py-1.5"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge variant="outline" className="text-[9px] uppercase">
                        {r.mode}
                      </Badge>
                      <span className="truncate font-mono text-xs" title={ruleText(r)}>
                        {ruleText(r)}
                      </span>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0"
                      onClick={() => setExclusions((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2 pt-1">
              <div className="w-28 shrink-0 space-y-1">
                <Label className="text-[10px] uppercase text-muted-foreground">
                  {t("correlation.tune.exMode")}
                </Label>
                <Select value={exMode} onValueChange={(v) => setExMode(v as typeof exMode)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="value">{t("correlation.tune.exValueMode")}</SelectItem>
                    <SelectItem value="regex">{t("correlation.tune.exRegexMode")}</SelectItem>
                    <SelectItem value="label">{t("correlation.tune.exLabelMode")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-24 shrink-0 space-y-1">
                <Label className="text-[10px] uppercase text-muted-foreground">
                  {t("correlation.tune.exLabelField")}
                </Label>
                <Input
                  value={exLabel}
                  onChange={(e) => setExLabel(e.target.value)}
                  placeholder={exMode === "label" ? "person" : t("correlation.tune.exAny")}
                  className="h-8 text-xs"
                />
              </div>
              {exMode !== "label" && (
                <div className="min-w-0 flex-1 space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground">
                    {exMode === "regex"
                      ? t("correlation.tune.exPatternField")
                      : t("correlation.tune.exValueField")}
                  </Label>
                  <Input
                    value={exValue}
                    onChange={(e) => setExValue(e.target.value)}
                    placeholder={exMode === "regex" ? "^(null|n/a)$" : "null"}
                    className="h-8 text-xs"
                  />
                </div>
              )}
              <Button size="sm" variant="outline" className="h-8" onClick={addRule}>
                {t("correlation.tune.exAdd")}
              </Button>
            </div>
          </ContentWrap>
        </Wrap>
      </div>

      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted-foreground">
          {t("correlation.tune.recomputeNote")}
        </span>
        <Button variant="outline" onClick={reload} disabled={saving}>
          {t("correlation.tune.reset")}
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? t("correlation.tune.saving") : t("correlation.tune.save")}
        </Button>
      </div>
    </div>
  );
}

function ContentWrap({
  layout,
  children,
}: {
  layout: "page" | "dialog";
  children: React.ReactNode;
}) {
  if (layout === "page") return <CardContent className="space-y-4">{children}</CardContent>;
  return <div className="space-y-4">{children}</div>;
}

function ThresholdSlider({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-sm">{label}</Label>
        <span className="font-mono text-xs tabular-nums">{Math.round(value * 100)}%</span>
      </div>
      <Slider
        min={0}
        max={1}
        step={0.05}
        value={[value]}
        onValueChange={(v) => onChange(v[0] ?? value)}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
