"use client";

import * as React from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type CaseHypothesisRuleDto } from "@workspace/api-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import { useTranslation } from "@/hooks/use-translation";
import type { RuleHypothesis } from "./hypothesis-rule-dialog";

/** Ink and glyph per stance: green for, red against, grey for neither. */
const STANCE_STYLE: Record<string, { glyph: string; ink: string }> = {
  SUPPORTS: { glyph: "+", ink: "text-emerald-600 dark:text-emerald-400" },
  CONTRADICTS: { glyph: "−", ink: "text-red-600 dark:text-red-400" },
  NEUTRAL: { glyph: "○", ink: "text-muted-foreground" },
};

/**
 * A watch's hypothesis rules as chips: the stance, which hypothesis (its colour
 * and H-number on the board), and what the rule narrows to. The hypothesis
 * opens the rule for editing; × removes it, asking whether the links it made
 * should go too (by default they stay).
 */
export function HypothesisRuleChips({
  caseId,
  rules,
  hypotheses,
  readOnly,
  onEdit,
  onChanged,
}: {
  caseId: string;
  rules: CaseHypothesisRuleDto[];
  hypotheses: RuleHypothesis[];
  readOnly?: boolean;
  onEdit: (rule: CaseHypothesisRuleDto) => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [removing, setRemoving] = React.useState<CaseHypothesisRuleDto | null>(null);
  const [alsoLinks, setAlsoLinks] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      const res = await api.cases.caseHypothesisRulesControllerRemove({
        id: caseId,
        ruleId: removing.id,
        removeLinks: alsoLinks,
      });
      toast.success(
        res.unlinked > 0
          ? t("caseHypothesisRules.removedUnlinked", { count: res.unlinked })
          : t("caseHypothesisRules.removed"),
      );
      setRemoving(null);
      onChanged();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("caseHypothesisRules.failedToRemove")));
    } finally {
      setBusy(false);
    }
  };

  if (rules.length === 0) return null;
  return (
    <>
      <ul className="flex flex-wrap gap-1" data-testid="hypothesis-rule-chips">
        {rules.map((rule) => {
          const meta = hypotheses.find((h) => h.id === rule.threadId);
          const style = STANCE_STYLE[rule.stance] ?? STANCE_STYLE.NEUTRAL!;
          return (
            <li key={rule.id} className="min-w-0 max-w-full">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="border-border bg-card inline-flex max-w-full items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-[11px]"
                    data-testid="hypothesis-rule-chip"
                    data-stance={rule.stance}
                  >
                    <span className={cn("shrink-0 font-mono text-[11px] font-semibold", style.ink)} aria-label={t(`caseHypothesisRules.stance.${rule.stance}`)}>
                      {style.glyph}
                    </span>
                    {meta && (
                      <span className="size-2 shrink-0 rounded-full" style={{ background: meta.color }} aria-hidden />
                    )}
                    {meta && <span className="shrink-0 font-mono text-[9px] text-muted-foreground">{meta.label}</span>}
                    {readOnly ? (
                      <span className="min-w-0 truncate">{rule.threadTitle}</span>
                    ) : (
                      <button
                        type="button"
                        className="min-w-0 truncate hover:underline"
                        onClick={() => onEdit(rule)}
                        aria-label={t("caseHypothesisRules.edit")}
                      >
                        {rule.threadTitle}
                      </button>
                    )}
                    {rule.kind && rule.pattern && (
                      <span className="min-w-0 max-w-[120px] shrink truncate font-mono text-[10px] text-muted-foreground">
                        · {t(`caseFilters.kind.${rule.kind}`)} {rule.pattern}
                      </span>
                    )}
                    {!readOnly && (
                      <button
                        type="button"
                        className="-mr-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-[2px] text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={t("caseHypothesisRules.remove")}
                        onClick={() => {
                          setAlsoLinks(false);
                          setRemoving(rule);
                        }}
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">
                    {t(`caseHypothesisRules.stance.${rule.stance}`)} · {rule.threadTitle}
                  </p>
                  <p className="font-mono text-[11px]">
                    {rule.kind && rule.pattern
                      ? `${t(`caseFilters.kind.${rule.kind}`)}: ${rule.pattern}`
                      : t("caseHypothesisRules.everyAnswer")}
                  </p>
                  {rule.description && <p className="text-xs">{rule.description}</p>}
                  <p className="text-[11px] opacity-70">{t("caseHypothesisRules.linkCount", { count: rule.linkCount })}</p>
                  {rule.createdBy && (
                    <p className="text-[11px] opacity-70">{t("caseFilters.addedBy", { name: rule.createdBy })}</p>
                  )}
                </TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && !busy && setRemoving(null)}>
        <AlertDialogContent data-testid="hypothesis-rule-remove-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("caseHypothesisRules.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("caseHypothesisRules.removeBody", {
                hypothesis: removing?.threadTitle ?? "",
                count: removing?.linkCount ?? 0,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {(removing?.linkCount ?? 0) > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={alsoLinks}
                onCheckedChange={(v) => setAlsoLinks(v === true)}
                className="mt-0.5"
                data-testid="hypothesis-rule-remove-links"
              />
              <span>
                {t("caseHypothesisRules.removeLinks", { count: removing?.linkCount ?? 0 })}
                <span className="text-muted-foreground block text-xs">{t("caseHypothesisRules.removeLinksHint")}</span>
              </span>
            </label>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {t("caseHypothesisRules.removeConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
