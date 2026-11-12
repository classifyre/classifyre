"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { ActorChip } from "@/components/actor-chip";
import type { AssetUsageDto } from "@/lib/governance";

/**
 * Who uses a table (GOV §5.3): reads and exports per day over the last
 * days, the people who read it most, and the export formats. From the audit
 * trail's per-table events, so only reads that went through Classifyre.
 */
export function UsageCard({
  usage,
  loading,
}: {
  usage: AssetUsageDto | null;
  loading: boolean;
}) {
  const { t } = useTranslation();
  if (loading && !usage) {
    return (
      <Card>
        <CardContent className="flex justify-center py-6">
          <Spinner />
        </CardContent>
      </Card>
    );
  }
  if (!usage) return null;
  const peak = Math.max(
    1,
    ...usage.perDay.map((day) => day.reads + day.exports),
  );
  return (
    <Card data-testid="usage-card">
      <CardHeader>
        <CardTitle>{t("governance.usage.title")}</CardTitle>
        <CardDescription>
          {t("governance.usage.description", { days: usage.days })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          {(
            [
              ["reads", usage.reads],
              ["exports", usage.exports],
              ["readers", usage.readers],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="rounded-md border border-border/60 p-2">
              <div className="text-xl font-black">{value}</div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {t(`governance.usage.${key}`)}
              </div>
            </div>
          ))}
        </div>
        {usage.reads + usage.exports > 0 ? (
          <>
            <div
              className="flex h-12 items-end gap-px"
              role="img"
              aria-label={t("governance.usage.chart", { days: usage.days })}
            >
              {usage.perDay.map((day) => (
                <div
                  key={day.day}
                  title={`${day.day}: ${day.reads} / ${day.exports}`}
                  className="flex-1 rounded-t-sm bg-accent-ink/70"
                  style={{
                    height: `${Math.max(
                      day.reads + day.exports > 0 ? 8 : 2,
                      ((day.reads + day.exports) / peak) * 100,
                    )}%`,
                    opacity: day.reads + day.exports > 0 ? 1 : 0.25,
                  }}
                />
              ))}
            </div>
            {usage.topReaders.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-semibold">
                  {t("governance.usage.topReaders")}
                </div>
                <ul className="space-y-1">
                  {usage.topReaders.map((reader) => (
                    <li
                      key={reader.actorRef}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <ActorChip actorRef={reader.actorRef} />
                      <span className="text-muted-foreground">
                        {t("governance.usage.readerCounts", {
                          reads: reader.reads,
                          exports: reader.exports,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {usage.exportsByFormat.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("governance.usage.formats", {
                  list: usage.exportsByFormat
                    .map((item) => `${item.format} × ${item.count}`)
                    .join(", "),
                })}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("governance.usage.none")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
