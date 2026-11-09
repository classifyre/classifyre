"use client";

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { History } from "lucide-react";
import { api, type AuditEventDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet";
import { ActorChip } from "@/components/actor-chip";
import { useTranslation } from "@/hooks/use-translation";
import { formatDate, formatRelative } from "@/lib/date";

const PAGE = 50;

export interface AuditFilter {
  entityType?: string;
  entityId?: string;
  actor?: string;
}

/** Audit events for a filter, newest first, with "load more". */
export function useAuditEvents(filter: AuditFilter | null, pageSize = PAGE) {
  const [events, setEvents] = useState<AuditEventDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const key = filter ? JSON.stringify(filter) : null;

  const load = useCallback(
    async (before?: string) => {
      if (!key) return;
      setLoading(true);
      try {
        const page = await api.identity.auditControllerList({
          ...(JSON.parse(key) as AuditFilter),
          before,
          limit: pageSize,
        });
        setEvents((current) => (before ? [...current, ...page] : page));
        setHasMore(page.length === pageSize);
      } catch (error) {
        console.error("Failed to load audit events:", error);
      } finally {
        setLoading(false);
      }
    },
    [key, pageSize],
  );

  useEffect(() => {
    setEvents([]);
    void load();
  }, [load]);

  const loadMore = () => {
    const last = events[events.length - 1];
    if (last) void load(last.id);
  };

  return { events, loading, hasMore, loadMore, reload: () => load() };
}

/** One row of the audit trail: who, what, which fields, when. */
function AuditEventRow({
  event,
  showEntity,
}: {
  event: AuditEventDto;
  showEntity?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <li className="space-y-1 border-b border-border py-2 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ActorChip actorRef={event.actor} />
        <time
          className="text-[11px] text-muted-foreground"
          dateTime={new Date(event.occurredAt).toISOString()}
          title={formatDate(event.occurredAt)}
        >
          {formatRelative(event.occurredAt)}
        </time>
      </div>
      <p className="font-mono text-[11px] text-foreground">
        {event.channel === "mcp"
          ? t("audit.mcpTool", { tool: event.operation })
          : event.operation}
        {showEntity && event.entityType && (
          <span className="text-muted-foreground">
            {" · "}
            {event.entityType}
            {event.entityId ? ` ${event.entityId.slice(0, 8)}` : ""}
          </span>
        )}
      </p>
      {event.fields.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {t("audit.fields", { fields: event.fields.join(", ") })}
        </p>
      )}
    </li>
  );
}

export function AuditEventList({
  filter,
  showEntity = false,
}: {
  filter: AuditFilter;
  showEntity?: boolean;
}) {
  const { t } = useTranslation();
  const { events, loading, hasMore, loadMore } = useAuditEvents(filter);

  if (!loading && events.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("audit.empty")}
      </p>
    );
  }
  return (
    <div>
      <ul>
        {events.map((event) => (
          <AuditEventRow key={event.id} event={event} showEntity={showEntity} />
        ))}
      </ul>
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full"
          disabled={loading}
          onClick={loadMore}
        >
          {t("audit.loadMore")}
        </Button>
      )}
    </div>
  );
}

/**
 * "Created by A · Last changed by B, 2 h ago · History" under an entity's
 * title (§11.2). `createdBy` comes from the entity itself where it records
 * one; the last change and the history come from the audit trail.
 */
export function ChangedBy({
  entityType,
  entityId,
  createdBy,
  createdAt,
  className,
}: {
  entityType: string;
  entityId: string;
  createdBy?: string | null;
  createdAt?: Date | string | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { events } = useAuditEvents({ entityType, entityId }, 1);
  const last = events[0];

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground ${className ?? ""}`}
    >
      {createdBy && (
        <span className="inline-flex items-center gap-1">
          {t("audit.createdBy")}
          <ActorChip actorRef={createdBy} />
          {createdAt && <span>· {formatRelative(createdAt)}</span>}
        </span>
      )}
      {last && (
        <span className="inline-flex items-center gap-1">
          {t("audit.lastChangedBy")}
          <ActorChip actorRef={last.actor} />
          <span>· {formatRelative(last.occurredAt)}</span>
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 gap-1 px-1.5 text-xs"
        onClick={() => setOpen(true)}
      >
        <History className="h-3 w-3" aria-hidden />
        {t("audit.history")}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t("audit.historyTitle")}</SheetTitle>
            <SheetDescription>{t("audit.historyDescription")}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            {open && <AuditEventList filter={{ entityType, entityId }} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
