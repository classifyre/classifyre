"use client";

import * as React from "react";
import { LayoutDashboard } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Switch } from "@workspace/ui/components/switch";
import { useInstanceSettings } from "@/components/instance-settings-provider";
import { useTranslation } from "@/hooks/use-translation";

/**
 * Settings → General: the rollout switch for the case board. Per workspace,
 * off by default until the board reaches parity with the legacy case graph
 * (docs/architecture/CASE_BOARD_PRD.md §9).
 */
export function CaseBoardSettingsCard() {
  const { t } = useTranslation();
  const { settings, saving, updateSettings } = useInstanceSettings();
  const enabled = settings.caseBoardEnabled;

  return (
    <Card className="panel-card rounded-[6px]">
      <CardContent className="flex items-start justify-between gap-6 p-5">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="h-4 w-4" />
            <p className="text-xs font-mono uppercase tracking-[0.14em]">{t("caseBoard.settings.title")}</p>
            <span className="rounded-[3px] border border-border px-1 font-mono text-[9px] uppercase">
              {t("caseBoard.settings.preview")}
            </span>
          </div>
          <p className="max-w-2xl text-xs text-muted-foreground">{t("caseBoard.settings.description")}</p>
          <p className="text-xs">{enabled ? t("caseBoard.settings.enabled") : t("caseBoard.settings.disabled")}</p>
        </div>
        <Switch
          checked={enabled}
          disabled={saving}
          aria-label={t("caseBoard.settings.title")}
          onCheckedChange={async (value) => {
            try {
              await updateSettings({ caseBoardEnabled: value });
            } catch (error) {
              toast.error(error instanceof Error ? error.message : String(error));
            }
          }}
          data-testid="case-board-switch"
        />
      </CardContent>
    </Card>
  );
}
