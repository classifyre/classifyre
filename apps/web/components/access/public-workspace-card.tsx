"use client";

import * as React from "react";
import { Globe } from "lucide-react";
import { toast } from "sonner";
import { api } from "@workspace/api-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Label } from "@workspace/ui/components/label";
import { Switch } from "@workspace/ui/components/switch";
import { useNamespace } from "@/components/namespace-provider";
import { useCan } from "@/hooks/use-me";
import { useTranslation } from "@/hooks/use-translation";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

/**
 * Makes the workspace public or private (docs/prd/IAM §13 step 8h). Public
 * means read-only for everyone of the tenant without a grant on it, and for
 * people who have not signed in when it is in the first tenant; never for
 * another tenant. Making it public asks first; making it private does not.
 */
export function PublicWorkspaceCard() {
  const { t } = useTranslation();
  const { namespace, refresh } = useNamespace();
  const canPublish = useCan("workspace.publish");
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const isPublic = namespace?.public ?? false;

  const save = async (next: boolean) => {
    if (!namespace || busy) return;
    setBusy(true);
    try {
      await api.namespaces.update(namespace.id, { public: next });
      await refresh();
      toast.success(t(next ? "publicWorkspace.published" : "publicWorkspace.unpublished"));
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("publicWorkspace.saveFailed")));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <Card className="panel-card rounded-[6px]" data-testid="public-workspace">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4" />
          <p className="text-xs font-mono uppercase tracking-[0.14em]">
            {t("publicWorkspace.title")}
          </p>
        </div>
        <div className="flex items-start gap-3">
          <Switch
            id="public-workspace"
            data-testid="public-workspace-switch"
            checked={isPublic}
            disabled={!canPublish || busy || !namespace}
            onCheckedChange={(checked) => (checked ? setConfirming(true) : void save(false))}
          />
          <div className="space-y-1">
            <Label htmlFor="public-workspace">{t("publicWorkspace.label")}</Label>
            <p className="text-sm text-muted-foreground">{t("publicWorkspace.description")}</p>
          </div>
        </div>
      </CardContent>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("publicWorkspace.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("publicWorkspace.confirmDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="public-workspace-confirm"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void save(true);
              }}
            >
              {t("publicWorkspace.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
