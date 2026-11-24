"use client";

import * as React from "react";
import Link from "next/link";
import { api, type DataRequestListItemDto } from "@workspace/api-client";
import { DataRequestStateBadge } from "@/components/case-status-badge";
import { useTranslation } from "@/hooks/use-translation";
import { formatRelative } from "@/lib/date";
import { useNsPath } from "@/lib/ns-path";

const TEAM_WAITING_STATES = new Set([
  "SUBMITTED",
  "IN_PROGRESS",
  "CHANGES_REQUESTED",
]);
const MINE_NEWS_STATES = new Set(["DELIVERED", "DECLINED"]);
const NEWS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function filterTeamWaitingRequests(
  items: DataRequestListItemDto[],
): DataRequestListItemDto[] {
  return items.filter((item) => TEAM_WAITING_STATES.has(item.state));
}

export function filterMineRecentNews(
  items: DataRequestListItemDto[],
  now = Date.now(),
): DataRequestListItemDto[] {
  return items.filter(
    (item) =>
      MINE_NEWS_STATES.has(item.state) &&
      now - new Date(item.updatedAt).getTime() <= NEWS_WINDOW_MS,
  );
}

/**
 * Loads the two waiting lists for the current person:
 * - requests routed to their groups that still need action;
 * - their own requests that were delivered or declined in the last 14 days.
 */
export function useWaitingDataRequests(enabled = true) {
  const [team, setTeam] = React.useState<DataRequestListItemDto[] | null>(null);
  const [mine, setMine] = React.useState<DataRequestListItemDto[] | null>(null);

  const load = React.useCallback(async () => {
    if (!enabled) return;
    const [teamRes, mineRes] = await Promise.all([
      api.dataRequests
        .dataRequestsControllerList({ scope: "team" })
        .catch(() => ({ items: [], total: 0 })),
      api.dataRequests
        .dataRequestsControllerList({ scope: "mine" })
        .catch(() => ({ items: [], total: 0 })),
    ]);
    const now = Date.now();
    setTeam(filterTeamWaitingRequests(teamRes.items));
    setMine(filterMineRecentNews(mineRes.items, now));
  }, [enabled]);

  React.useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  const count =
    team !== null && mine !== null ? team.length + mine.length : undefined;

  return { team, mine, count, reload: load };
}

/**
 * Data requests that need the current person's attention on the dashboard:
 * requests waiting on their data-team groups, and recent outcomes on requests
 * they opened themselves.
 */
export function DataRequestsList({
  team,
  mine,
  emptyText,
}: {
  /** Pre-loaded team queue; omit to let the list fetch on mount. */
  team?: DataRequestListItemDto[] | null;
  /** Pre-loaded requester news; omit to let the list fetch on mount. */
  mine?: DataRequestListItemDto[] | null;
  emptyText?: string;
}) {
  const { t } = useTranslation();
  const managed = team === undefined && mine === undefined;
  const fetched = useWaitingDataRequests(managed);
  const resolvedTeam = managed ? fetched.team : (team ?? null);
  const resolvedMine = managed ? fetched.mine : (mine ?? null);

  if (resolvedTeam === null || resolvedMine === null) return null;

  if (resolvedTeam.length === 0 && resolvedMine.length === 0) {
    return (
      <p
        className="rounded-[4px] border border-dashed p-4 text-sm text-muted-foreground"
        data-testid="data-requests-none"
      >
        {emptyText ?? t("dashboard.waiting.noDataRequests")}
      </p>
    );
  }

  return (
    <div className="space-y-4" data-testid="data-requests-waiting">
      {resolvedTeam.length > 0 && (
        <div className="space-y-2">
          <h5 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {t("dashboard.waiting.dataRequestsTeam")}
          </h5>
          <div className="space-y-2">
            {resolvedTeam.map((request) => (
              <DataRequestRow key={request.id} request={request} />
            ))}
          </div>
        </div>
      )}

      {resolvedMine.length > 0 && (
        <div className="space-y-2">
          <h5 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {t("dashboard.waiting.dataRequestsMine")}
          </h5>
          <div className="space-y-2">
            {resolvedMine.map((request) => (
              <DataRequestRow key={request.id} request={request} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DataRequestRow({ request }: { request: DataRequestListItemDto }) {
  const { t } = useTranslation();
  const nsPath = useNsPath();

  return (
    <Link
      href={nsPath(`/cases/${request.id}`)}
      className="block rounded-[4px] border border-border border-l-2 border-l-sky-500 p-3 text-sm transition-colors hover:bg-muted/40"
      data-testid={`data-request-row-${request.id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">
          {request.title}
        </span>
        <DataRequestStateBadge state={request.state} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <span className="font-mono text-[11px] text-foreground/80">
          → {request.routeGroup.name}
        </span>
        <span aria-hidden>·</span>
        <span>
          {t("dashboard.waiting.dataRequestsRequestedBy", {
            who: request.requester.name,
          })}
        </span>
        <span className="ml-auto text-[11px] tabular-nums">
          {formatRelative(request.updatedAt)}
        </span>
      </div>
    </Link>
  );
}
