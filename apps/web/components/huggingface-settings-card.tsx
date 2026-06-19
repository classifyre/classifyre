"use client";

import * as React from "react";
import type { TranslationKey } from "@/i18n";
import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
} from "@workspace/ui/components";
import { Eye, EyeOff, KeyRound, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useInstanceSettings } from "@/components/instance-settings-provider";
import { useTranslation } from "@/hooks/use-translation";

const HF_PREFIX = "settings.huggingFace" as const;

function hfKey(suffix: string): TranslationKey {
  return `${HF_PREFIX}.${suffix}` as TranslationKey;
}

export function HuggingFaceSettingsCard() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useInstanceSettings();
  const [token, setToken] = React.useState("");
  const [showToken, setShowToken] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const isInstanceManaged = settings.hfTokenInstanceSet;
  const hasUserToken = settings.hfTokenSet;

  const handleSave = async () => {
    if (!token.trim()) return;
    try {
      setSaving(true);
      await updateSettings({ hfToken: token.trim() });
      setToken("");
      toast.success(t(hfKey("savedToast")));
    } catch {
      toast.error(t(hfKey("saveFailedToast")));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    try {
      setSaving(true);
      await updateSettings({ hfToken: null });
      toast.success(t(hfKey("removedToast")));
    } catch {
      toast.error(t(hfKey("removeFailedToast")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="panel-card rounded-[6px]">
      <CardContent className="p-5">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            <p className="text-xs font-mono uppercase tracking-[0.14em]">
              {t(hfKey("heading"))}
            </p>
          </div>

          <p className="-mt-2 text-xs text-muted-foreground">
            {isInstanceManaged ? t(hfKey("instanceManaged")) : t(hfKey("desc"))}
          </p>

          {isInstanceManaged ? (
            <div className="rounded-[4px] border border-muted bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {t(hfKey("instanceActive"))}
            </div>
          ) : hasUserToken ? (
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-xs font-mono">
                {t(hfKey("tokenConfigured"))}
              </span>
              <div className="ml-auto">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleRemove}
                  disabled={saving}
                  className="h-7 gap-1 text-[11px]"
                >
                  {saving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                  {t(hfKey("remove"))}
                </Button>
              </div>
            </div>
          ) : null}

          {!isInstanceManaged ? (
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label
                  htmlFor="hf-token"
                  className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground"
                >
                  {hasUserToken ? t(hfKey("updateToken")) : t(hfKey("heading"))}
                </Label>
                <div className="relative">
                  <Input
                    id="hf-token"
                    type={showToken ? "text" : "password"}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder={hasUserToken ? "" : t(hfKey("tokenPlaceholder"))}
                    className="h-9 rounded-[4px] border-2 border-border pr-8 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showToken ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
              <Button
                onClick={handleSave}
                disabled={saving || !token.trim()}
                className="h-9 shrink-0 gap-1 text-xs"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Save
              </Button>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
