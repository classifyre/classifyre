"use client";

import * as React from "react";
import { toast } from "sonner";
import { api, type CaseActivityDto, type InquiryActivityDto } from "@workspace/api-client";
import { watchEntryId } from "@/components/case-timeline";
import { useTranslation } from "@/hooks/use-translation";
import { useBoardStore, useUiStore } from "../store/board-context";

type CaseActivityType = CaseActivityDto["activityType"];
type WatchActivityType = InquiryActivityDto["activityType"];

/**
 * Where a "What changed" link goes: one timeline entry, or the newest entry
 * of some kinds — the case's own (optionally about one watch), or a watch's
 * scan deltas blended into the case timeline.
 */
export type TimelineTarget =
  | { entryId: string }
  | { types: CaseActivityType[]; inquiryId?: string }
  | { watchTypes: WatchActivityType[]; inquiryIds: string[] };

/**
 * Open the timeline at the entry that explains something on screen (an
 * alert, a count), marked, with its address in the URL so it can be shared.
 * When nothing on the timeline explains it yet, `fallback` runs instead (a
 * better explanation elsewhere), or the timeline opens anyway and says so.
 * Resolves to whether an entry was found.
 */
export function useTimelineLink(): (target: TimelineTarget, opts?: { fallback?: () => void }) => Promise<boolean> {
  const { t } = useTranslation();
  const ui = useUiStore();
  const store = useBoardStore();
  return React.useCallback(
    async (target: TimelineTarget, opts?: { fallback?: () => void }) => {
      const caseId = store.getState().caseId;
      let entryId: string | null = null;
      try {
        if ("entryId" in target) {
          entryId = target.entryId;
        } else if ("types" in target) {
          const page = await api.cases.caseTimelineControllerGetTimeline({
            caseId,
            types: target.types.join(","),
            inquiryId: target.inquiryId,
            limit: "1",
          });
          entryId = page.items[0]?.id ?? null;
        } else {
          const pages = await Promise.all(
            target.inquiryIds.map((id) =>
              api.inquiries
                .inquiriesControllerTimeline({ id, types: target.watchTypes.join(","), limit: "1" })
                .catch(() => null),
            ),
          );
          const newest = pages
            .flatMap((page) => page?.items ?? [])
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
          entryId = newest ? watchEntryId(newest.id) : null;
        }
      } catch {
        entryId = null;
      }
      if (entryId) {
        ui.getState().focusTimeline(entryId);
        return true;
      }
      if (opts?.fallback) {
        opts.fallback();
        return false;
      }
      ui.getState().openDrawer("timeline");
      toast.message(t("caseBoard.timelineLink.none"));
      return false;
    },
    [store, ui, t],
  );
}
