"use client";

import * as React from "react";
import { Check, FolderPlus, HelpCircle, Scissors, Search, X } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { useTranslation } from "@/hooks/use-translation";

/**
 * Every level ends in an action; this is that action for a pair.
 *
 * "Unsure, next" is a first-class button, not a way out. Forcing a binary
 * decision on an ambiguous pair produces bad labels, and the count of unsure
 * verdicts is itself the signal that the cutoffs are in the wrong place.
 */
export function PairActionBar({
  onConfirm,
  onReject,
  onSplit,
  onUnsure,
  onCase,
  onInquiry,
  canSplit,
  busy,
}: {
  onConfirm: () => void;
  onReject: () => void;
  onSplit: () => void;
  onUnsure: () => void;
  onCase: () => void;
  onInquiry: () => void;
  canSplit: boolean;
  busy: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={onConfirm} disabled={busy}>
        <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        {t("review.actions.confirm")}
      </Button>

      {/* The negative verdict, next to the positive one. Without it the only
          way to disagree was "unsure", which is a different statement and
          produces a different (worse) training signal. */}
      <Button size="sm" variant="outline" onClick={onReject} disabled={busy}>
        <X className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        {t("review.actions.reject")}
      </Button>

      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              size="sm"
              variant="outline"
              onClick={onSplit}
              disabled={busy || !canSplit}
            >
              <Scissors className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {t("review.actions.split")}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px]">
          {canSplit
            ? t("review.ego.caption")
            : t("review.ego.noBridge")}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="outline" onClick={onUnsure} disabled={busy}>
            <HelpCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {t("review.actions.unsure")}
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px]">
          {t("review.actions.unsureHint")}
        </TooltipContent>
      </Tooltip>

      <span className="mx-1 hidden h-5 w-px bg-border sm:block" />

      <Button size="sm" variant="ghost" onClick={onCase} disabled={busy}>
        <FolderPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        {t("review.actions.case")}
      </Button>
      <Button size="sm" variant="ghost" onClick={onInquiry} disabled={busy}>
        <Search className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        {t("review.actions.inquiry")}
      </Button>
    </div>
  );
}
