"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, type GraphNodeDto } from "@workspace/api-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { SeverityBadge } from "@workspace/ui/components/severity-badge";
import { Loader2 } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";

export interface AttachFindingsDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  caseId: string;
  asset: GraphNodeDto | null;
  /** Findings on this asset that are not yet attached to the case. */
  findings: GraphNodeDto[];
  onAttached: () => void;
}

export function AttachFindingsDialog({
  open,
  onOpenChange,
  caseId,
  asset,
  findings,
  onAttached,
}: AttachFindingsDialogProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) setSelected(new Set(findings.map((f) => f.id)));
  }, [open, findings]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const attach = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      const res = await api.cases.casesControllerAttachFindings({
        id: caseId,
        attachFindingsDto: { findingIds: Array.from(selected) },
      });
      toast.success(t("caseGraph.attachDialog.attached", { count: String(res.attached) }));
      onOpenChange(false);
      onAttached();
    } catch (err) {
      console.error(err);
      toast.error(t("caseGraph.attachDialog.failedToAttach"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("caseGraph.attachDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("caseGraph.attachDialog.description", {
              label: asset?.label ?? "",
              count: String(findings.length),
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-72 space-y-1 overflow-y-auto py-1">
          {findings.map((f) => (
            <label
              key={f.id}
              className="flex cursor-pointer items-start gap-2.5 border-2 border-border bg-card p-2 transition-colors hover:border-foreground/50"
            >
              <Checkbox
                checked={selected.has(f.id)}
                onCheckedChange={() => toggle(f.id)}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{f.label}</span>
                  {f.severity && (
                    <SeverityBadge severity={f.severity.toLowerCase() as never}>
                      {f.severity}
                    </SeverityBadge>
                  )}
                </div>
                {f.matchedContent && (
                  <p className="truncate font-mono text-[10px] text-muted-foreground">
                    {f.matchedContent}
                  </p>
                )}
              </div>
            </label>
          ))}
        </div>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              router.push(`/investigations/${caseId}/evidence/add${asset ? `?assetId=${asset.id}` : ""}`)
            }
          >
            {t("caseGraph.attachDialog.openFullPicker")}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={attach} disabled={selected.size === 0 || saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("caseGraph.attachDialog.attachFindings", { count: String(selected.size) })}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
