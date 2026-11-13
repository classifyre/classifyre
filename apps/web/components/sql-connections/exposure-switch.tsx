"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Label, Switch } from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { ActorChip } from "@/components/actor-chip";
import { formatDate } from "@/lib/date";
import { setExposure, type DataConnectionExposureDto } from "@/lib/sql-connections";

/**
 * Open to SQL connections, or not (opt-in, DQ §5.7): BI tools reach a table
 * only once it or its source is opened. Its owner, a steward or an admin
 * switches it; everyone else sees the state.
 */
export function ExposureSwitch({
  target,
  exposure,
  canChange,
  onChange,
}: {
  target: { type: "asset" | "source"; id: string };
  exposure: DataConnectionExposureDto;
  canChange: boolean;
  onChange: (next: DataConnectionExposureDto) => void;
}) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const id = `sql-exposure-${target.id}`;
  const locked = exposure.inheritedFromSource;
  return (
    <div
      className="flex flex-wrap items-start justify-between gap-3 rounded-[4px] border px-3 py-2.5"
      data-testid="sql-exposure"
    >
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id} className="font-medium">
          {target.type === "asset"
            ? t("sqlConnections.exposureTable")
            : t("sqlConnections.exposureSource")}
        </Label>
        <p className="text-xs text-muted-foreground">
          {exposure.open
            ? locked
              ? t("sqlConnections.openViaSource")
              : t("sqlConnections.openHint")
            : t("sqlConnections.closedHint")}
        </p>
        {exposure.open && exposure.openedAt && (
          <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {t("sqlConnections.openedAt", { when: formatDate(exposure.openedAt) })}
            {exposure.openedBy && <ActorChip actorRef={exposure.openedBy} />}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={exposure.open}
        disabled={!canChange || saving || locked}
        onCheckedChange={(open) =>
          void (async () => {
            setSaving(true);
            try {
              onChange(await setExposure(target, open));
              toast.success(
                open ? t("sqlConnections.opened") : t("sqlConnections.closed"),
              );
            } catch (caught) {
              toast.error(
                caught instanceof Error && caught.message
                  ? caught.message
                  : t("sqlConnections.failed"),
              );
            } finally {
              setSaving(false);
            }
          })()
        }
      />
    </div>
  );
}
