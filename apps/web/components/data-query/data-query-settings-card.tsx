"use client";

import * as React from "react";
import { toast } from "sonner";
import { api } from "@workspace/api-client";
import type { DataQuerySettingsDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { useTranslation } from "@/hooks/use-translation";
import { useCan } from "@/hooks/use-me";
import { ActorChip } from "@/components/actor-chip";
import { apiErrorMessage } from "@/lib/data-query";

/** Settings → Data: the SQL limits of the workspace. */
export function DataQuerySettingsCard() {
  const { t } = useTranslation();
  const canChange = useCan("workspace.settings");
  const [settings, setSettings] = React.useState<DataQuerySettingsDto | null>(
    null,
  );
  const [maxRows, setMaxRows] = React.useState("");
  const [timeout, setTimeoutValue] = React.useState("");
  const [exportRows, setExportRows] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const apply = (next: DataQuerySettingsDto) => {
    setSettings(next);
    setMaxRows(String(next.maxRows));
    setTimeoutValue(String(next.timeoutSeconds));
    setExportRows(String(next.exportMaxRows));
  };

  React.useEffect(() => {
    api.dataQuery
      .dataQueryControllerGetSettings()
      .then(apply)
      .catch(() => undefined);
  }, []);

  const save = async (patch: {
    maxRows?: number;
    timeoutSeconds?: number;
    exportMaxRows?: number;
  }) => {
    setBusy(true);
    try {
      apply(
        await api.dataQuery.dataQueryControllerUpdateSettings({
          updateDataQuerySettingsDto: patch,
        }),
      );
      toast.success(t("dataQuery.settings.saved"));
    } catch (error) {
      toast.error(await apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="data-query-settings">
      <CardHeader>
        <CardTitle>{t("dataQuery.settings.title")}</CardTitle>
        <CardDescription>{t("dataQuery.settings.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="data-query-max-rows" className="text-xs">
              {t("dataQuery.settings.maxRows")}
            </Label>
            <Input
              id="data-query-max-rows"
              type="number"
              min={1}
              max={100000}
              className="h-8 w-32"
              value={maxRows}
              disabled={!canChange}
              onChange={(event) => setMaxRows(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="data-query-timeout" className="text-xs">
              {t("dataQuery.settings.timeout")}
            </Label>
            <Input
              id="data-query-timeout"
              type="number"
              min={5}
              max={900}
              className="h-8 w-32"
              value={timeout}
              disabled={!canChange}
              onChange={(event) => setTimeoutValue(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="data-query-export-rows" className="text-xs">
              {t("dataQuery.settings.exportMaxRows")}
            </Label>
            <Input
              id="data-query-export-rows"
              type="number"
              min={1}
              max={10000000}
              className="h-8 w-36"
              value={exportRows}
              disabled={!canChange}
              onChange={(event) => setExportRows(event.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={!canChange || busy || !settings}
            onClick={() =>
              void save({
                maxRows: Number(maxRows),
                timeoutSeconds: Number(timeout),
                exportMaxRows: Number(exportRows),
              })
            }
          >
            {t("dataQuery.settings.save")}
          </Button>
        </div>
        {settings?.updatedBy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {t("dataQuery.settings.changedBy")}
            <ActorChip actorRef={settings.updatedBy} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
