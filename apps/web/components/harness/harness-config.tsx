"use client";

import * as React from "react";
import {
  Button,
  Label,
  Switch,
  Textarea,
} from "@workspace/ui/components";
import {
  FlaskConical,
  FolderSearch,
  Plug,
  SlidersHorizontal,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@workspace/ui/lib/utils";
import { useInstanceSettings } from "@/components/instance-settings-provider";
import { useTranslation } from "@/hooks/use-translation";
import { HarnessMcp } from "./harness-mcp";

type GuidanceField = {
  value: string;
  set: (v: string) => void;
  saved: string;
  label: string;
  placeholder: string;
};

/**
 * Harness configuration — every autonomous capability with its enable flag and
 * free-text guidance. Replaces the old "Investigation Autopilot" settings card
 * and adds the config-tuning, detector-authoring and external-MCP capabilities.
 */
export function HarnessConfig() {
  const { t } = useTranslation();
  const { settings, saving, updateSettings } = useInstanceSettings();
  const [busy, setBusy] = React.useState(false);

  const [inquiryDesired, setInquiryDesired] = React.useState("");
  const [inquirySearchable, setInquirySearchable] = React.useState("");
  const [caseGuidance, setCaseGuidance] = React.useState("");
  const [configGuidance, setConfigGuidance] = React.useState("");
  const [detectorGuidance, setDetectorGuidance] = React.useState("");

  React.useEffect(() => {
    setInquiryDesired(settings.autopilotInquiryDesired ?? "");
    setInquirySearchable(settings.autopilotInquirySearchable ?? "");
    setCaseGuidance(settings.autopilotCaseGuidance ?? "");
    setConfigGuidance(settings.autopilotConfigGuidance ?? "");
    setDetectorGuidance(settings.autopilotDetectorGuidance ?? "");
  }, [
    settings.autopilotInquiryDesired,
    settings.autopilotInquirySearchable,
    settings.autopilotCaseGuidance,
    settings.autopilotConfigGuidance,
    settings.autopilotDetectorGuidance,
  ]);

  const aiReady = settings.aiEnabled && !!settings.aiProviderConfigId;
  const disabled = busy || saving;

  const save = React.useCallback(
    async (payload: Parameters<typeof updateSettings>[0], message: string) => {
      try {
        setBusy(true);
        await updateSettings(payload);
        toast.success(message);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("settings.failedToSave"));
      } finally {
        setBusy(false);
      }
    },
    [updateSettings, t],
  );

  return (
    <div className="space-y-4">
      {!aiReady && (
        <p className="rounded-[4px] border border-dashed border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
          {t("harness.config.requiresAi")}
        </p>
      )}

      <Capability
        icon={FolderSearch}
        name={t("harness.config.agents.inquiry.name")}
        desc={t("harness.config.agents.inquiry.desc")}
        enabled={settings.autopilotInquiryEnabled}
        disabled={disabled || !aiReady}
        onToggle={(v) =>
          void save(
            { autopilotInquiryEnabled: v },
            t("harness.config.enabledToast"),
          )
        }
        fields={[
          {
            value: inquiryDesired,
            set: setInquiryDesired,
            saved: settings.autopilotInquiryDesired ?? "",
            label: t("settings.autopilot.inquiryDesired"),
            placeholder: t("settings.autopilot.inquiryDesiredPlaceholder"),
          },
          {
            value: inquirySearchable,
            set: setInquirySearchable,
            saved: settings.autopilotInquirySearchable ?? "",
            label: t("settings.autopilot.inquirySearchable"),
            placeholder: t("settings.autopilot.inquirySearchablePlaceholder"),
          },
        ]}
        onSaveFields={() =>
          void save(
            {
              autopilotInquiryDesired: inquiryDesired,
              autopilotInquirySearchable: inquirySearchable,
            },
            t("harness.config.saved"),
          )
        }
        disabledSave={disabled}
        saveLabel={t("harness.config.save")}
      />

      <Capability
        icon={Workflow}
        name={t("harness.config.agents.case.name")}
        desc={t("harness.config.agents.case.desc")}
        enabled={settings.autopilotCaseEnabled}
        disabled={disabled || !aiReady}
        onToggle={(v) =>
          void save({ autopilotCaseEnabled: v }, t("harness.config.enabledToast"))
        }
        fields={[
          {
            value: caseGuidance,
            set: setCaseGuidance,
            saved: settings.autopilotCaseGuidance ?? "",
            label: t("harness.config.guidance"),
            placeholder: t("settings.autopilot.caseGuidancePlaceholder"),
          },
        ]}
        onSaveFields={() =>
          void save(
            { autopilotCaseGuidance: caseGuidance },
            t("harness.config.saved"),
          )
        }
        disabledSave={disabled}
        saveLabel={t("harness.config.save")}
      />

      <Capability
        icon={SlidersHorizontal}
        name={t("harness.config.agents.config.name")}
        desc={t("harness.config.agents.config.desc")}
        enabled={settings.autopilotConfigEnabled}
        disabled={disabled || !aiReady}
        onToggle={(v) =>
          void save(
            { autopilotConfigEnabled: v },
            t("harness.config.enabledToast"),
          )
        }
        fields={[
          {
            value: configGuidance,
            set: setConfigGuidance,
            saved: settings.autopilotConfigGuidance ?? "",
            label: t("harness.config.guidance"),
            placeholder: t("harness.config.agents.config.desc"),
          },
        ]}
        onSaveFields={() =>
          void save(
            { autopilotConfigGuidance: configGuidance },
            t("harness.config.saved"),
          )
        }
        disabledSave={disabled}
        saveLabel={t("harness.config.save")}
      />

      <Capability
        icon={FlaskConical}
        name={t("harness.config.agents.detector.name")}
        desc={t("harness.config.agents.detector.desc")}
        enabled={settings.autopilotDetectorEnabled}
        disabled={disabled || !aiReady}
        onToggle={(v) =>
          void save(
            { autopilotDetectorEnabled: v },
            t("harness.config.enabledToast"),
          )
        }
        fields={[
          {
            value: detectorGuidance,
            set: setDetectorGuidance,
            saved: settings.autopilotDetectorGuidance ?? "",
            label: t("harness.config.guidance"),
            placeholder: t("harness.config.agents.detector.desc"),
          },
        ]}
        onSaveFields={() =>
          void save(
            { autopilotDetectorGuidance: detectorGuidance },
            t("harness.config.saved"),
          )
        }
        disabledSave={disabled}
        saveLabel={t("harness.config.save")}
      />

      <Capability
        icon={Plug}
        name={t("harness.config.agents.mcp.name")}
        desc={t("harness.config.agents.mcp.desc")}
        enabled={settings.autopilotMcpEnabled}
        disabled={disabled || !aiReady}
        onToggle={(v) =>
          void save({ autopilotMcpEnabled: v }, t("harness.config.enabledToast"))
        }
        fields={[]}
        disabledSave
        saveLabel={t("harness.config.save")}
      />

      {settings.autopilotMcpEnabled && <HarnessMcp />}
    </div>
  );
}

function Capability({
  icon: Icon,
  name,
  desc,
  enabled,
  disabled,
  onToggle,
  fields,
  onSaveFields,
  disabledSave,
  saveLabel,
}: {
  icon: LucideIcon;
  name: string;
  desc: string;
  enabled: boolean;
  disabled: boolean;
  onToggle: (v: boolean) => void;
  fields: GuidanceField[];
  onSaveFields?: () => void;
  disabledSave: boolean;
  saveLabel: string;
}) {
  const dirty = fields.some((f) => f.value !== f.saved);
  return (
    <div
      className={cn(
        "space-y-3 rounded-[4px] border-2 px-4 py-3 transition-colors",
        enabled
          ? "border-[#d97706]/40 bg-[#d97706]/[0.04]"
          : "border-border bg-muted/20",
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-sm font-medium">{name}</p>
          </div>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
        <Switch
          checked={enabled}
          disabled={disabled}
          onCheckedChange={onToggle}
          aria-label={name}
        />
      </div>

      {fields.length > 0 && (
        <div className="space-y-2">
          {fields.map((f, i) => (
            <div key={i} className="space-y-1">
              <Label className="font-mono text-[11px] uppercase tracking-[0.12em]">
                {f.label}
              </Label>
              <Textarea
                value={f.value}
                onChange={(e) => f.set(e.target.value)}
                placeholder={f.placeholder}
                rows={2}
                maxLength={4000}
                className="rounded-[4px] border-2 border-border text-sm"
              />
            </div>
          ))}
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={disabledSave || !dirty}
              onClick={onSaveFields}
            >
              {saveLabel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
