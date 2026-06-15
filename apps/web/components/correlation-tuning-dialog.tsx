"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  api,
  type CorrelationConfigResponseDto,
  type ExclusionRuleDto,
} from "@workspace/api-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
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
import { Trash2 } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";

/**
 * Fine-tune the (DB-backed) correlation engine: per-label weights — labels are
 * dynamic and auto-discovered from the data — plus the related/duplicate match
 * thresholds. Saving schedules a full recompute (a DUPLICATES FINDER run).
 */
export function CorrelationTuningDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: () => void;
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

  React.useEffect(() => {
    if (!open) return;
    setConfig(null);
    setExMode("value");
    setExLabel("");
    setExValue("");
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
  }, [open, t]);

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
      onOpenChange(false);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("correlation.tune.title")}</DialogTitle>
          <DialogDescription>{t("correlation.tune.desc")}</DialogDescription>
        </DialogHeader>

        {!config ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner label={t("correlation.tune.title")} />
          </div>
        ) : (
          <div className="space-y-5 overflow-y-auto pr-1">
            {/* Thresholds */}
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

            {/* Default weight */}
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

            {/* Per-label weights */}
            <div className="space-y-2">
              <Label className="text-sm">{t("correlation.tune.labelWeights")}</Label>
              {config.labels.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("correlation.tune.noLabels")}
                </p>
              ) : (
                <div className="max-h-64 space-y-1.5 overflow-y-auto">
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
                          setWeights((w) => ({
                            ...w,
                            [l.label]: Number(e.target.value),
                          }))
                        }
                        className="h-7 w-16"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Exclusions */}
            <div className="space-y-2 border-t border-border/60 pt-4">
              <Label className="text-sm">{t("correlation.tune.exclusions")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("correlation.tune.exclusionsHint")}
              </p>
              {exclusions.length > 0 && (
                <div className="space-y-1.5">
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
                        onClick={() =>
                          setExclusions((prev) => prev.filter((_, j) => j !== i))
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <div className="w-28 shrink-0 space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground">
                    {t("correlation.tune.exMode")}
                  </Label>
                  <Select
                    value={exMode}
                    onValueChange={(v) => setExMode(v as typeof exMode)}
                  >
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
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={saving || !config}>
            {saving ? t("correlation.tune.saving") : t("correlation.tune.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
        <span className="font-mono text-xs tabular-nums">
          {Math.round(value * 100)}%
        </span>
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
