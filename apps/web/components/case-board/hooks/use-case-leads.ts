"use client";

import * as React from "react";
import { toast } from "sonner";
import { api, type CaseLeadDto } from "@workspace/api-client";
import { useTranslation } from "@/hooks/use-translation";
import { useBoardStore, useUiStore } from "../store/board-context";
import { absolutePosition } from "../store/ops";
import { isPendingLead, locateLead } from "../store/leads";
import { freeSpotNear, itemExtent, newEvidenceSize, takenRects } from "../store/geometry";
import { useFlyToEvidence } from "./use-place-evidence";
import { useVisibleCentre } from "./use-visible-centre";

type XY = { x: number; y: number };

/** How far right of what it relates to an accepted lead lands. */
const BESIDE = 96;
/** An accepted lead is flown to once placed, unless it takes longer than this. */
const FLY_WAIT_MS = 20_000;

export interface CaseLeads {
  leads: CaseLeadDto[];
  loading: boolean;
  /** Leads with a review in flight. */
  busy: ReadonlySet<string>;
  refreshing: boolean;
  reload: () => Promise<void>;
  /** Accept a lead: dropped at `at`, or placed next to what it relates to. */
  accept: (lead: CaseLeadDto, at?: XY) => Promise<void>;
  /** A lead dragged from the panel was dropped on the canvas: that is accepting it. */
  acceptDropped: (leadId: string, at: XY) => void;
  dismiss: (leadIds: string[], reason?: string) => Promise<void>;
  /** Look for new leads now (the case also does it by itself). */
  refresh: () => Promise<void>;
  showOnBoard: (lead: CaseLeadDto) => void;
}

/**
 * The case's leads as the board works with them. A lead leaves the list the
 * moment it is accepted or dismissed (the server confirms after), and an
 * accepted one lands where it was dropped, or right of the evidence it relates
 * to, and the board flies to it once it is placed.
 */
export function useCaseLeads(caseId: string, onFlyTo: (nodeId: string) => void): CaseLeads {
  const { t } = useTranslation();
  const store = useBoardStore();
  const ui = useUiStore();
  const centre = useVisibleCentre();
  const flyToEvidence = useFlyToEvidence(onFlyTo);
  const [leads, setLeads] = React.useState<CaseLeadDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<ReadonlySet<string>>(() => new Set());
  const [refreshing, setRefreshing] = React.useState(false);
  const leadsRef = React.useRef(leads);
  leadsRef.current = leads;
  const flyWhenPlaced = React.useRef<{ assetId: string; findingId: string | null; until: number } | null>(null);

  const reload = React.useCallback(async () => {
    try {
      setLeads(await api.cases.caseLeadsControllerList({ caseId }));
    } catch {
      // Keep what is shown; the next poll tries again.
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  // The accepted evidence arrives with the next board read, unplaced; fly to
  // it once auto-place has put it down (and its finding is in the case).
  React.useEffect(
    () =>
      store.subscribe((s) => {
        const pending = flyWhenPlaced.current;
        if (!pending) return;
        if (Date.now() > pending.until) {
          flyWhenPlaced.current = null;
          return;
        }
        const itemId = s.itemByAsset.get(pending.assetId);
        const item = itemId ? s.items.get(itemId) : undefined;
        if (!itemId || !item || item.x === null || item.y === null) return;
        if (pending.findingId && !s.bubbles.get(itemId)?.rows.some((r) => r.findingId === pending.findingId)) return;
        flyWhenPlaced.current = null;
        flyToEvidence(itemId, pending.findingId);
      }),
    [store, flyToEvidence],
  );

  const setStatus = React.useCallback((ids: readonly string[], status: CaseLeadDto["status"]) => {
    const set = new Set(ids);
    setLeads((list) => list.map((l) => (set.has(l.id) ? { ...l, status, reviewedAt: new Date() } : l)));
  }, []);
  const setBusyIds = React.useCallback((ids: readonly string[], on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const accept = React.useCallback(
    async (lead: CaseLeadDto, at?: XY) => {
      const s = store.getState();
      if (s.readOnly) return;
      const assetId = lead.assetId ?? null;
      if (assetId && !s.itemByAsset.has(assetId)) {
        // A new asset joins the board: where it was dropped, else beside what it relates to.
        const size = newEvidenceSize();
        let spot = at;
        if (!spot) {
          const viaId = lead.viaAssetId ? s.itemByAsset.get(lead.viaAssetId) : undefined;
          const via = viaId ? s.items.get(viaId) : undefined;
          let anchor: XY;
          if (via && via.x !== null && via.y !== null) {
            const pos = absolutePosition(s.items, via.id);
            const ext = itemExtent(s, via);
            anchor = { x: pos.x + ext.dx + ext.width + BESIDE, y: pos.y };
          } else {
            const c = centre();
            anchor = { x: c.x - size.width / 2, y: c.y - size.height / 2 };
          }
          spot = freeSpotNear(anchor, size, takenRects(s));
        }
        const hints = new Map(ui.getState().placementHints);
        hints.set(`asset:${assetId}`, spot);
        if (lead.findingId) hints.set(`finding:${lead.findingId}`, spot);
        ui.getState().set({ placementHints: hints });
      }
      // A drop lands in view; an accept from the list may not.
      if (!at && assetId) {
        flyWhenPlaced.current = { assetId, findingId: lead.findingId ?? null, until: Date.now() + FLY_WAIT_MS };
      }
      setBusyIds([lead.id], true);
      setStatus([lead.id], "ACCEPTED");
      try {
        await api.cases.caseLeadsControllerReview({
          caseId,
          leadId: lead.id,
          reviewCaseLeadDto: { action: "ACCEPT" },
        });
        toast.success(t("caseLeads.accepted"));
        store.getState().refetch();
      } catch {
        flyWhenPlaced.current = null;
        toast.error(t("caseLeads.acceptFailed"));
      } finally {
        setBusyIds([lead.id], false);
        void reload();
      }
    },
    [caseId, store, ui, centre, reload, setBusyIds, setStatus, t],
  );

  const acceptDropped = React.useCallback(
    (leadId: string, at: XY) => {
      const lead = leadsRef.current.find((l) => l.id === leadId);
      if (lead && isPendingLead(lead)) void accept(lead, at);
    },
    [accept],
  );

  const dismiss = React.useCallback(
    async (leadIds: string[], reason?: string) => {
      if (leadIds.length === 0) return;
      setBusyIds(leadIds, true);
      setStatus(leadIds, "DISMISSED");
      try {
        if (leadIds.length === 1) {
          await api.cases.caseLeadsControllerReview({
            caseId,
            leadId: leadIds[0]!,
            reviewCaseLeadDto: { action: "DISMISS", reason },
          });
          toast.success(t("caseLeads.dismissed"));
        } else {
          const res = await api.cases.caseLeadsControllerReviewMany({
            caseId,
            reviewCaseLeadsDto: { leadIds, action: "DISMISS", reason },
          });
          toast.success(t("caseLeads.dismissedMany", { count: res.updated }));
        }
      } catch {
        toast.error(t("caseLeads.dismissFailed"));
      } finally {
        setBusyIds(leadIds, false);
        void reload();
      }
    },
    [caseId, reload, setBusyIds, setStatus, t],
  );

  const refresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await api.cases.caseLeadsControllerGenerate({ caseId });
      if (res.full) toast.message(t("caseLeads.refreshFull"));
      else if (res.proposed === 0) toast.message(t("caseLeads.refreshedNone"));
      else toast.success(res.proposed === 1 ? t("caseLeads.refreshedOne") : t("caseLeads.refreshed", { count: res.proposed }));
      await reload();
    } catch {
      toast.error(t("caseLeads.refreshFailed"));
    } finally {
      setRefreshing(false);
    }
  }, [caseId, reload, t]);

  const showOnBoard = React.useCallback(
    (lead: CaseLeadDto) => {
      const target = locateLead(store.getState().itemByAsset, lead);
      if (target) flyToEvidence(target.itemId, target.findingId);
    },
    [store, flyToEvidence],
  );

  return { leads, loading, busy, refreshing, reload, accept, acceptDropped, dismiss, refresh, showOnBoard };
}
