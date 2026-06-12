"use client";

import * as React from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Switch,
  Textarea,
} from "@workspace/ui/components";
import { Bot, FolderSearch, Workflow } from "lucide-react";
import { toast } from "sonner";
import { useInstanceSettings } from "@/components/instance-settings-provider";
import { useTranslation } from "@/hooks/use-translation";

/**
 * Settings card for the Investigation Autopilot: two autonomous agents
 * (inquiry management + case management) with per-agent enable flags and
 * free-text operator guidance. The agents use the instance-wide default AI
 * provider configured in the assistant card.
 */
export function AutopilotSettingsCard() {
  const { t } = useTranslation();
  const { settings, saving, updateSettings } = useInstanceSettings();

  const [busy, setBusy] = React.useState(false);
  const [inquiryDesired, setInquiryDesired] = React.useState("");
  const [inquirySearchable, setInquirySearchable] = React.useState("");
  const [caseGuidance, setCaseGuidance] = React.useState("");

  React.useEffect(() => {
    setInquiryDesired(settings.autopilotInquiryDesired ?? "");
    setInquirySearchable(settings.autopilotInquirySearchable ?? "");
    setCaseGuidance(settings.autopilotCaseGuidance ?? "");
  }, [
    settings.autopilotInquiryDesired,
    settings.autopilotInquirySearchable,
    settings.autopilotCaseGuidance,
  ]);

  const aiReady = settings.aiEnabled && !!settings.aiProviderConfigId;

  const save = React.useCallback(
    async (payload: Parameters<typeof updateSettings>[0], message: string) => {
      try {
        setBusy(true);
        await updateSettings(payload);
        toast.success(message);
      } catch (saveError) {
        toast.error(
          saveError instanceof Error
            ? saveError.message
            : t("settings.failedToSave"),
        );
      } finally {
        setBusy(false);
      }
    },
    [updateSettings, t],
  );

  const disabled = busy || saving;

  return (
    <Card className="panel-card rounded-[6px]">
      <CardHeader className="gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-[#d97706]" />
            <p className="text-xs font-mono uppercase tracking-[0.14em]">
              {t("settings.autopilot.subtitle")}
            </p>
          </div>
          <CardTitle>{t("settings.autopilot.title")}</CardTitle>
          <CardDescription>
            {t("settings.autopilot.description")}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {!aiReady && (
          <p className="rounded-[4px] border border-dashed border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
            {t("settings.autopilot.requiresAi")}
          </p>
        )}

        {/* Inquiry agent */}
        <div className="space-y-3 rounded-[4px] border-2 border-border bg-muted/20 px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <FolderSearch className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-sm font-medium">
                  {t("settings.autopilot.inquiryEnable")}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settings.autopilot.inquiryEnableDesc")}
              </p>
            </div>
            <Switch
              checked={settings.autopilotInquiryEnabled}
              disabled={disabled || !aiReady}
              onCheckedChange={(checked) =>
                void save(
                  { autopilotInquiryEnabled: checked },
                  t("settings.autopilot.enabledToast"),
                )
              }
              aria-label={t("settings.autopilot.inquiryEnable")}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-mono uppercase tracking-[0.12em]">
              {t("settings.autopilot.inquiryDesired")}
            </Label>
            <Textarea
              value={inquiryDesired}
              onChange={(e) => setInquiryDesired(e.target.value)}
              placeholder={t("settings.autopilot.inquiryDesiredPlaceholder")}
              rows={3}
              maxLength={4000}
              disabled={disabled}
              className="rounded-[4px] border-2 border-border text-sm"
            />
            <Label className="text-xs font-mono uppercase tracking-[0.12em]">
              {t("settings.autopilot.inquirySearchable")}
            </Label>
            <Textarea
              value={inquirySearchable}
              onChange={(e) => setInquirySearchable(e.target.value)}
              placeholder={t("settings.autopilot.inquirySearchablePlaceholder")}
              rows={3}
              maxLength={4000}
              disabled={disabled}
              className="rounded-[4px] border-2 border-border text-sm"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                disabled={
                  disabled ||
                  (inquiryDesired === (settings.autopilotInquiryDesired ?? "") &&
                    inquirySearchable ===
                      (settings.autopilotInquirySearchable ?? ""))
                }
                onClick={() =>
                  void save(
                    {
                      autopilotInquiryDesired: inquiryDesired,
                      autopilotInquirySearchable: inquirySearchable,
                    },
                    t("settings.autopilot.guidanceSaved"),
                  )
                }
              >
                {t("settings.autopilot.saveGuidance")}
              </Button>
            </div>
          </div>
        </div>

        {/* Case agent */}
        <div className="space-y-3 rounded-[4px] border-2 border-border bg-muted/20 px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-sm font-medium">
                  {t("settings.autopilot.caseEnable")}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settings.autopilot.caseEnableDesc")}
              </p>
            </div>
            <Switch
              checked={settings.autopilotCaseEnabled}
              disabled={disabled || !aiReady}
              onCheckedChange={(checked) =>
                void save(
                  { autopilotCaseEnabled: checked },
                  t("settings.autopilot.enabledToast"),
                )
              }
              aria-label={t("settings.autopilot.caseEnable")}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-mono uppercase tracking-[0.12em]">
              {t("settings.autopilot.caseGuidance")}
            </Label>
            <Textarea
              value={caseGuidance}
              onChange={(e) => setCaseGuidance(e.target.value)}
              placeholder={t("settings.autopilot.caseGuidancePlaceholder")}
              rows={3}
              maxLength={4000}
              disabled={disabled}
              className="rounded-[4px] border-2 border-border text-sm"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                disabled={
                  disabled ||
                  caseGuidance === (settings.autopilotCaseGuidance ?? "")
                }
                onClick={() =>
                  void save(
                    { autopilotCaseGuidance: caseGuidance },
                    t("settings.autopilot.guidanceSaved"),
                  )
                }
              >
                {t("settings.autopilot.saveGuidance")}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
