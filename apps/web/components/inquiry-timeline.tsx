"use client";

import * as React from "react";
import {
  Archive,
  Bot,
  Download,
  Link2,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  Telescope,
  Unlink,
} from "lucide-react";
import { api, type InquiryActivityDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { ToneBadge } from "@workspace/ui/components";
import { formatDate, formatRelative } from "@/lib/date";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

type Meta = { icon: React.ReactNode; labelKey: string; tone?: "fresh" | "error" };

const TYPE_META: Record<string, Meta> = {
  INQUIRY_CREATED: { icon: <Telescope className="h-3.5 w-3.5" />, labelKey: "created" },
  MATCHERS_UPDATED: { icon: <Pencil className="h-3.5 w-3.5" />, labelKey: "matchersUpdated" },
  STATUS_CHANGED: { icon: <Archive className="h-3.5 w-3.5" />, labelKey: "statusChanged" },
  REMATCHED: { icon: <RefreshCw className="h-3.5 w-3.5" />, labelKey: "rematched" },
  MATCHES_LANDED: { icon: <Sparkles className="h-3.5 w-3.5" />, labelKey: "matchesLanded", tone: "fresh" },
  MATCHES_RETIRED: { icon: <Unlink className="h-3.5 w-3.5" />, labelKey: "matchesRetired", tone: "error" },
  CASE_LINKED: { icon: <Link2 className="h-3.5 w-3.5" />, labelKey: "caseLinked" },
  CASE_UNLINKED: { icon: <Unlink className="h-3.5 w-3.5" />, labelKey: "caseUnlinked" },
  PULLED_TO_CASE: { icon: <Download className="h-3.5 w-3.5" />, labelKey: "pulledToCase" },
  AUTO_PULLED: { icon: <Bot className="h-3.5 w-3.5" />, labelKey: "autoPulled" },
};

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

function strList(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

/** The matcher dimensions that actually moved, as "+a, -b" per dimension. */
function matcherDiff(payload: Record<string, unknown>): string[] {
  const before = (payload.before ?? {}) as Record<string, unknown>;
  const after = (payload.after ?? {}) as Record<string, unknown>;
  const lines: string[] = [];
  for (const key of Object.keys({ ...before, ...after })) {
    const b = before[key];
    const a = after[key];
    if (typeof b === "boolean" || typeof a === "boolean") {
      if (b !== a) lines.push(`${key}: ${String(b)} → ${String(a)}`);
      continue;
    }
    const bs = strList(b);
    const as = strList(a);
    const added = as.filter((x) => !bs.includes(x));
    const removed = bs.filter((x) => !as.includes(x));
    if (added.length === 0 && removed.length === 0) continue;
    const parts = [
      ...added.map((x) => `+${x}`),
      ...removed.map((x) => `−${x}`),
    ];
    lines.push(`${key}: ${parts.join(", ")}`);
  }
  return lines;
}

/**
 * A watch's own history.
 *
 * This is the durable half of the New/Gone story. Those flags are derived from
 * the source's latest run, so they are gone the moment it runs again — without
 * this, a scan's effect on a standing question would leave no trace at all once
 * the next one landed.
 */
export function InquiryTimeline({ inquiryId }: { inquiryId: string }) {
  const { t } = useTranslation();
  const [items, setItems] = React.useState<InquiryActivityDto[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(
    async (after?: string) => {
      try {
        setError(null);
        const res = await api.inquiries.inquiriesControllerTimeline({
          id: inquiryId,
          cursor: after,
        });
        setItems((prev) => (after ? [...prev, ...res.items] : res.items));
        // The generated client models a null cursor as undefined.
        setCursor(res.nextCursor ?? null);
      } catch (err) {
        console.error(err);
        setError(t("investigations.inquiryTimeline.failed"));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inquiryId],
  );

  React.useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load]);

  const label = (item: InquiryActivityDto): string => {
    const meta: Meta | undefined = TYPE_META[item.activityType];
    const p = (item.payload ?? {}) as Record<string, unknown>;
    const key =
      `investigations.inquiryTimeline.${meta?.labelKey ?? "rematched"}` as TranslationKey;
    return t(key, {
      count: String(num(p.count) || num(p.pulled)),
    });
  };

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />{" "}
        {t("investigations.inquiryTimeline.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground max-w-2xl text-xs">
        {t("investigations.inquiryTimeline.desc")}
      </p>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          {t("investigations.inquiryTimeline.empty")}
        </p>
      ) : (
        <div className="divide-y divide-border rounded-[4px] border-2 border-border bg-card">
          {items.map((item) => {
            const meta = TYPE_META[item.activityType];
            const payload = (item.payload ?? {}) as Record<string, unknown>;
            const samples = strList(payload.sampleLabels);
            const diff =
              item.activityType === "MATCHERS_UPDATED"
                ? matcherDiff(payload)
                : [];
            return (
              <div key={item.id} className="flex gap-3 px-3 py-2.5">
                <span className="text-muted-foreground mt-0.5 shrink-0">
                  {meta?.icon ?? <RefreshCw className="h-3.5 w-3.5" />}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm">{label(item)}</span>
                    {meta?.tone && (
                      <ToneBadge tone={meta.tone} dot>
                        {String(num(payload.count) || num(payload.pulled))}
                      </ToneBadge>
                    )}
                    {typeof payload.caseTitle === "string" && (
                      <span className="text-muted-foreground text-xs">
                        {payload.caseTitle}
                      </span>
                    )}
                  </div>

                  {samples.length > 0 && (
                    <p className="text-muted-foreground truncate font-mono text-[11px]">
                      {samples.join(", ")}
                    </p>
                  )}

                  {diff.length > 0 && (
                    <div className="space-y-0.5">
                      <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-[0.14em]">
                        {t("investigations.inquiryTimeline.showDiff")}
                      </p>
                      {diff.map((line) => (
                        <p
                          key={line}
                          className="text-muted-foreground font-mono text-[11px]"
                        >
                          {line}
                        </p>
                      ))}
                    </div>
                  )}

                  {payload.capped === true && (
                    <p className="text-muted-foreground text-[11px]">
                      {t("investigations.inquiryTimeline.cappedNote", {
                        available: String(num(payload.available)),
                      })}
                    </p>
                  )}
                </div>

                <span
                  className="text-muted-foreground shrink-0 text-[10px]"
                  title={formatDate(item.createdAt)}
                >
                  {formatRelative(item.createdAt)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {cursor && (
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="outline"
            disabled={loadingMore}
            onClick={() => {
              setLoadingMore(true);
              void load(cursor).finally(() => setLoadingMore(false));
            }}
          >
            {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("investigations.inquiryTimeline.loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
