"use client";

import * as React from "react";
import { toast } from "sonner";
import { api } from "@workspace/api-client";
import type { RunnerLimitsDto } from "@workspace/api-client";
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
import { apiErrorMessage } from "@/lib/data-query";

const FIELDS = [
  "maxConcurrentRunners",
  "autoScheduleMaxConcurrent",
  "maxRunnersPerSource",
] as const;

type Field = (typeof FIELDS)[number];

/**
 * Settings → General: the scan limits of this workspace. A value saved here
 * outranks the Helm chart and the all-in-one image for this workspace; an
 * empty field hands the limit back to them. Scans at once can only hold the
 * workspace below the installation-wide limit, which `effective` reflects.
 */
export function RunnerLimitsCard() {
  const { t } = useTranslation();
  const canChange = useCan("workspace.settings");
  const [limits, setLimits] = React.useState<RunnerLimitsDto | null>(null);
  const [draft, setDraft] = React.useState<Record<Field, string>>({
    maxConcurrentRunners: "",
    autoScheduleMaxConcurrent: "",
    maxRunnersPerSource: "",
  });
  const [busy, setBusy] = React.useState(false);

  const apply = (next: RunnerLimitsDto) => {
    setLimits(next);
    setDraft({
      maxConcurrentRunners: String(next.maxConcurrentRunners.override ?? ""),
      autoScheduleMaxConcurrent: String(
        next.autoScheduleMaxConcurrent.override ?? "",
      ),
      maxRunnersPerSource: String(next.maxRunnersPerSource.override ?? ""),
    });
  };

  React.useEffect(() => {
    api.deploymentSettings
      .deploymentSettingsControllerGet()
      .then(apply)
      .catch(() => undefined);
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const toValue = (raw: string) => (raw.trim() === "" ? null : Number(raw));
      apply(
        await api.deploymentSettings.deploymentSettingsControllerUpdate({
          updateRunnerLimitsDto: {
            maxConcurrentRunners: toValue(draft.maxConcurrentRunners),
            autoScheduleMaxConcurrent: toValue(draft.autoScheduleMaxConcurrent),
            maxRunnersPerSource: toValue(draft.maxRunnersPerSource),
          },
        }),
      );
      toast.success(t("runnerLimits.saved"));
    } catch (error) {
      toast.error(await apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="runner-limits-settings">
      <CardHeader>
        <CardTitle>{t("runnerLimits.title")}</CardTitle>
        <CardDescription>{t("runnerLimits.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          {FIELDS.map((field) => {
            const limit = limits?.[field];
            return (
              <div key={field} className="space-y-1">
                <Label htmlFor={`runner-limit-${field}`} className="text-xs">
                  {t(`runnerLimits.${field}`)}
                </Label>
                <Input
                  id={`runner-limit-${field}`}
                  data-testid={`runner-limit-${field}`}
                  type="number"
                  min={0}
                  max={10000}
                  className="h-8"
                  placeholder={
                    limit ? String(limit.deploymentDefault) : undefined
                  }
                  value={draft[field]}
                  disabled={!canChange}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      [field]: event.target.value,
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {t(`runnerLimits.${field}Hint`)}
                </p>
                {limit && (
                  <p className="text-xs text-muted-foreground">
                    {limit.override === null
                      ? t("runnerLimits.followsDeployment", {
                          value: limit.deploymentDefault,
                        })
                      : t("runnerLimits.overridden", {
                          value: limit.deploymentDefault,
                        })}
                  </p>
                )}
                {limit &&
                  limit.override !== null &&
                  limit.override > 0 &&
                  limit.effective !== limit.override && (
                    <p
                      className="text-xs text-amber-600 dark:text-amber-400"
                      data-testid={`runner-limit-${field}-capped`}
                    >
                      {t("runnerLimits.cappedByInstallation", {
                        value: limit.effective,
                      })}
                    </p>
                  )}
              </div>
            );
          })}
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!canChange || busy || !limits}
          onClick={() => void save()}
        >
          {t("runnerLimits.save")}
        </Button>
      </CardContent>
    </Card>
  );
}
