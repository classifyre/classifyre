"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type CaseFindingTypeOptionDto,
  type CaseHypothesisRuleDto,
  type CaseHypothesisRulesChangeResponseDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import { useTranslation } from "@/hooks/use-translation";

export type RuleStance = "SUPPORTS" | "CONTRADICTS" | "NEUTRAL";
export const RULE_STANCES: RuleStance[] = ["SUPPORTS", "CONTRADICTS", "NEUTRAL"];

type Matcher = "ALL" | "FINDING_TYPE" | "VALUE_PATTERN";

/** A hypothesis a rule can link to, as the board knows it. */
export interface RuleHypothesis {
  id: string;
  title: string;
  /** "H1", "H2", … */
  label: string;
  color: string;
  status: string | null;
}

/** What opens the dialog: a new rule for a watch, or an existing one to edit. */
export interface HypothesisRuleRequest {
  inquiryId: string;
  rule?: CaseHypothesisRuleDto;
}

/**
 * Add (or edit) a hypothesis rule: the answers of one watch go to a hypothesis
 * with a stance — supports, contradicts or neutral — as they arrive, and land
 * beside it on the board. Optionally only some answers (a finding type or a
 * value pattern). When adding, it can also link what the case already holds
 * from the watch.
 */
export function HypothesisRuleDialog({
  caseId,
  watches,
  hypotheses,
  request,
  onClose,
  onApplied,
}: {
  caseId: string;
  watches: Array<{ id: string; title: string }>;
  hypotheses: RuleHypothesis[];
  /** Null while closed. */
  request: HypothesisRuleRequest | null;
  onClose: () => void;
  onApplied: (result: CaseHypothesisRulesChangeResponseDto) => void;
}) {
  const { t } = useTranslation();
  const open = request !== null;
  const editing = request?.rule ?? null;

  const [threadId, setThreadId] = React.useState<string>("");
  const [stance, setStance] = React.useState<RuleStance>("SUPPORTS");
  const [matcher, setMatcher] = React.useState<Matcher>("ALL");
  const [type, setType] = React.useState("");
  const [pattern, setPattern] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [applyToExisting, setApplyToExisting] = React.useState(true);
  const [options, setOptions] = React.useState<CaseFindingTypeOptionDto[] | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!request) return;
    const r = request.rule;
    setThreadId(r?.threadId ?? hypotheses[0]?.id ?? "");
    setStance((r?.stance as RuleStance | undefined) ?? "SUPPORTS");
    setMatcher(r?.kind ? (r.kind as Matcher) : "ALL");
    setType(r?.kind === "FINDING_TYPE" ? (r.pattern ?? "") : "");
    setPattern(r?.kind === "VALUE_PATTERN" ? (r.pattern ?? "") : "");
    setDescription(r?.description ?? "");
    setApplyToExisting(true);
    setSaving(false);
    // `hypotheses` is read once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  // The finding types this watch answers, to pick from.
  React.useEffect(() => {
    if (!open || matcher !== "FINDING_TYPE" || !request) return;
    let cancelled = false;
    setOptions(null);
    api.cases
      .caseCleanupControllerFilterOptions({ id: caseId, inquiryId: request.inquiryId })
      .then((res) => {
        if (!cancelled) setOptions(res.types);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, matcher, caseId, request]);

  const watch = watches.find((w) => w.id === request?.inquiryId);
  const typeChoices = React.useMemo(() => {
    const all = options ?? [];
    return type && !all.some((o) => o.findingType === type)
      ? [{ findingType: type, inCase: 0, answers: 0 } as CaseFindingTypeOptionDto, ...all]
      : all;
  }, [options, type]);

  const patternProblem = React.useMemo(() => {
    if (matcher !== "VALUE_PATTERN" || pattern === "") return null;
    try {
      new RegExp(pattern);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, [matcher, pattern]);

  const matcherValue = matcher === "FINDING_TYPE" ? type : matcher === "VALUE_PATTERN" ? pattern : "";
  const canSubmit = !saving && threadId !== "" && (matcher === "ALL" || matcherValue.trim() !== "") && !patternProblem;

  const submit = async () => {
    if (!request) return;
    setSaving(true);
    const narrowed = matcher !== "ALL";
    try {
      const res = editing
        ? await api.cases.caseHypothesisRulesControllerUpdate({
            id: caseId,
            ruleId: editing.id,
            updateCaseHypothesisRuleDto: {
              threadId,
              stance,
              kind: narrowed ? matcher : null,
              pattern: narrowed ? matcherValue.trim() : null,
              description: description.trim() || null,
              updateLinks: true,
            },
          })
        : await api.cases.caseHypothesisRulesControllerAdd({
            id: caseId,
            addCaseHypothesisRuleDto: {
              inquiryId: request.inquiryId,
              threadId,
              stance,
              kind: narrowed ? matcher : null,
              pattern: narrowed ? matcherValue.trim() : null,
              description: description.trim() || null,
              applyToExisting,
            },
          });
      toast.success(
        res.linked > 0
          ? t(editing ? "caseHypothesisRules.dialog.updatedLinks" : "caseHypothesisRules.dialog.appliedLinks", {
              count: res.linked,
            })
          : t(editing ? "caseHypothesisRules.dialog.updated" : "caseHypothesisRules.dialog.applied"),
      );
      onApplied(res);
      onClose();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("caseHypothesisRules.dialog.failed")));
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent className="max-w-lg" data-testid="hypothesis-rule-dialog">
        <DialogHeader>
          <DialogTitle>
            {editing ? t("caseHypothesisRules.dialog.editTitle") : t("caseHypothesisRules.dialog.title")}
          </DialogTitle>
          <DialogDescription>
            {t("caseHypothesisRules.dialog.description", { watch: watch?.title ?? "" })}
          </DialogDescription>
        </DialogHeader>

        {hypotheses.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="hypothesis-rule-no-hypotheses">
            {t("caseHypothesisRules.dialog.noHypotheses")}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("caseHypothesisRules.dialog.hypothesis")}</Label>
              <Select value={threadId} onValueChange={setThreadId}>
                <SelectTrigger data-testid="hypothesis-rule-thread">
                  <SelectValue placeholder={t("caseHypothesisRules.dialog.pickHypothesis")} />
                </SelectTrigger>
                <SelectContent>
                  {hypotheses.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      <span className="inline-flex items-center gap-2">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: h.color }} aria-hidden />
                        <span className="font-mono text-[10px] text-muted-foreground">{h.label}</span>
                        <span className="truncate">{h.title}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t("caseHypothesisRules.dialog.stance")}</Label>
              <ToggleGroup
                type="single"
                value={stance}
                onValueChange={(v) => v && setStance(v as RuleStance)}
                variant="outline"
                className="justify-start"
                data-testid="hypothesis-rule-stance"
              >
                {RULE_STANCES.map((s) => (
                  <ToggleGroupItem key={s} value={s} className="px-3 text-xs" data-testid={`hypothesis-rule-stance-${s.toLowerCase()}`}>
                    {t(`caseHypothesisRules.stance.${s}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className="text-muted-foreground text-[11px]">{t(`caseHypothesisRules.stanceHint.${stance}`)}</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t("caseHypothesisRules.dialog.which")}</Label>
              <ToggleGroup
                type="single"
                value={matcher}
                onValueChange={(v) => v && setMatcher(v as Matcher)}
                variant="outline"
                className="justify-start"
              >
                <ToggleGroupItem value="ALL" className="px-3 text-xs">
                  {t("caseHypothesisRules.dialog.whichAll")}
                </ToggleGroupItem>
                <ToggleGroupItem value="FINDING_TYPE" className="px-3 text-xs">
                  {t("caseHypothesisRules.dialog.whichType")}
                </ToggleGroupItem>
                <ToggleGroupItem value="VALUE_PATTERN" className="px-3 text-xs">
                  {t("caseHypothesisRules.dialog.whichValue")}
                </ToggleGroupItem>
              </ToggleGroup>
              {matcher === "FINDING_TYPE" && (
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger data-testid="hypothesis-rule-type">
                    <SelectValue
                      placeholder={options === null ? t("caseFilters.dialog.typesLoading") : t("caseHypothesisRules.dialog.pickType")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {typeChoices.map((o) => (
                      <SelectItem key={o.findingType} value={o.findingType}>
                        <span className="font-mono text-xs">{o.findingType}</span>
                        <span className="text-muted-foreground ml-2 text-[10px]">
                          {t("caseFilters.dialog.answers", { count: o.answers })}
                        </span>
                      </SelectItem>
                    ))}
                    {options !== null && typeChoices.length === 0 && (
                      <p className="text-muted-foreground px-2 py-1.5 text-xs">{t("caseFilters.dialog.typesEmpty")}</p>
                    )}
                  </SelectContent>
                </Select>
              )}
              {matcher === "VALUE_PATTERN" && (
                <>
                  <Input
                    value={pattern}
                    onChange={(e) => setPattern(e.target.value)}
                    placeholder={t("caseFilters.dialog.patternPlaceholder")}
                    className="font-mono text-xs"
                    data-testid="hypothesis-rule-pattern"
                  />
                  {patternProblem && <p className="text-destructive text-[11px]">{patternProblem}</p>}
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t("caseHypothesisRules.dialog.why")}</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("caseHypothesisRules.dialog.whyPlaceholder")}
                maxLength={500}
              />
            </div>

            {!editing && (
              <label className="flex items-start gap-2 text-xs">
                <Checkbox
                  checked={applyToExisting}
                  onCheckedChange={(v) => setApplyToExisting(v === true)}
                  className="mt-0.5"
                  data-testid="hypothesis-rule-existing"
                />
                <span>
                  {t("caseHypothesisRules.dialog.applyExisting")}
                  <span className="text-muted-foreground block text-[11px]">
                    {t("caseHypothesisRules.dialog.applyExistingHint")}
                  </span>
                </span>
              </label>
            )}
            {editing && (
              <p className="text-muted-foreground text-[11px]">{t("caseHypothesisRules.dialog.editHint")}</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit || hypotheses.length === 0} data-testid="hypothesis-rule-submit">
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {editing ? t("caseHypothesisRules.dialog.save") : t("caseHypothesisRules.dialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
