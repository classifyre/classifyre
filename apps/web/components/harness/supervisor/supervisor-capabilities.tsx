"use client";

import * as React from "react";
import { Lock, TriangleAlert } from "lucide-react";
import { api, type SupervisorCapabilityDto } from "@workspace/api-client";
import { Label, Switch } from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

/**
 * The capability menu.
 *
 * The only real control over an agent that has authority over everything, so it
 * is a list of decisions a person can actually make — "it may tune detection" —
 * rather than two hundred tool checkboxes, which is a control nobody uses.
 */
export function SupervisorCapabilities() {
  const { t } = useTranslation();
  const [caps, setCaps] = React.useState<SupervisorCapabilityDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      try {
        const res = await api.autopilot.supervisorControllerCapabilities();
        setCaps(res.capabilities);
      } catch {
        /* transient */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggle = async (id: string, enabled: boolean) => {
    const next = caps.map((c) => (c.id === id ? { ...c, enabled } : c));
    setCaps(next);
    setSaving(true);
    try {
      const res = await api.autopilot.supervisorControllerSetCapabilities({
        updateCapabilitiesDto: {
          disabled: next.filter((c) => !c.enabled && !c.alwaysOn).map((c) => c.id),
        },
      });
      setCaps(res.capabilities);
      toast.success(t("harness.supervisor.capabilities.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.failedToSave"));
      setCaps(caps);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        {t("harness.loading")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="max-w-3xl space-y-1">
        <p className="text-sm text-muted-foreground">
          {t("harness.supervisor.capabilities.desc")}
        </p>
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {t("harness.supervisor.capabilities.readsNote")}
        </p>
      </div>

      <div className="space-y-2">
        {caps.map((cap) => (
          <div
            key={cap.id}
            className={cn(
              "flex items-start gap-3 rounded-[4px] border-2 p-3",
              cap.destructive && cap.enabled
                ? "border-rose-500/50 bg-rose-500/[0.05]"
                : cap.enabled
                  ? "border-[#d97706]/40 bg-[#d97706]/[0.04]"
                  : "border-border bg-muted/20",
            )}
          >
            <Switch
              id={`cap-${cap.id}`}
              checked={cap.enabled}
              disabled={cap.alwaysOn || saving}
              onCheckedChange={(v) => void toggle(cap.id, v)}
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Label
                  htmlFor={`cap-${cap.id}`}
                  className="font-serif text-sm font-black uppercase tracking-[0.03em]"
                >
                  {t(
                    `harness.supervisor.capabilities.${cap.labelKey}` as TranslationKey,
                  )}
                </Label>
                {cap.alwaysOn && (
                  <span className="inline-flex items-center gap-1 rounded-[3px] border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                    <Lock className="h-2.5 w-2.5" />
                    {t("harness.supervisor.capabilities.alwaysOn")}
                  </span>
                )}
                {cap.destructive && (
                  <span className="inline-flex items-center gap-1 rounded-[3px] border border-rose-500/50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-rose-600 dark:text-rose-400">
                    <TriangleAlert className="h-2.5 w-2.5" />
                    {t("harness.supervisor.capabilities.destructive")}
                  </span>
                )}
                {cap.toolCount > 0 && (
                  <span className="font-mono text-[9px] uppercase tracking-wider tabular-nums text-muted-foreground">
                    {t("harness.supervisor.capabilities.toolCount", {
                      count: String(cap.toolCount),
                    })}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {cap.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
