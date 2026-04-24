"use client";

import type { ReactNode } from "react";
import { useTranslation } from "@/hooks/use-translation";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";

export function SourceDetectorConfigCard({
  children,
  visibleCount,
  enabledCount,
  isSaving,
  onBack,
  onSave,
  onSaveAndScan,
  saveAndScanTestId,
  showActions = true,
}: {
  children: ReactNode;
  visibleCount: number;
  enabledCount: number;
  isSaving: boolean;
  onBack: () => void;
  onSave: () => void;
  onSaveAndScan: () => void;
  saveAndScanTestId?: string;
  showActions?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Card className="bg-background border-0 shadow-none">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="uppercase tracking-[0.06em]">
              {t("sources.edit.detectorConfig")}
            </CardTitle>
            <CardDescription>
              {t("sources.edit.detectorConfigDesc")}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.12em]">
            <Badge variant="secondary">
              {t("sources.edit.visible", {
                count: visibleCount,
              })}
            </Badge>
            <Badge className="bg-accent text-accent-foreground">
              {t("sources.edit.enabled", {
                count: enabledCount,
              })}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        {children}

        {showActions && (
          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <Button
              variant="outline"
              className="rounded-[4px] border-2 border-black"
              onClick={onBack}
              disabled={isSaving}
            >
              {t("sources.edit.back")}
            </Button>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                variant="outline"
                className="rounded-[4px] border-2 border-black"
                onClick={onSave}
                disabled={isSaving}
              >
                {t("common.save")}
              </Button>
              <Button
                className="rounded-[4px] border-2 border-black bg-black text-white hover:bg-black/90"
                onClick={onSaveAndScan}
                disabled={isSaving}
                data-testid={saveAndScanTestId}
              >
                {t("sources.edit.saveAndScan")}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
