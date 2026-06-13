"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  api,
  LinkThreadSupportDtoStanceEnum,
  LinkThreadSupportDtoTargetTypeEnum,
  type GraphNodeDto,
  type ThreadResponseDto,
} from "@workspace/api-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Button } from "@workspace/ui/components/button";
import { Label } from "@workspace/ui/components/label";
import { Textarea } from "@workspace/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Loader2 } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";

export type LinkTarget = {
  targetType: LinkThreadSupportDtoTargetTypeEnum;
  targetId: string;
};

export interface LinkHypothesisDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  node: GraphNodeDto | null;
  hypotheses: ThreadResponseDto[];
  hypothesisColors: Record<string, string>;
  /**
   * Resolves a graph node to a case-scoped link target (CaseEvidence.id /
   * CaseFinding.id), adding the node as evidence first when necessary.
   */
  resolveTarget: (node: GraphNodeDto) => Promise<LinkTarget>;
  onLinked: () => void;
}

export function LinkHypothesisDialog({
  open,
  onOpenChange,
  node,
  hypotheses,
  hypothesisColors,
  resolveTarget,
  onLinked,
}: LinkHypothesisDialogProps) {
  const { t } = useTranslation();
  const [threadId, setThreadId] = React.useState("");
  const [stance, setStance] = React.useState<LinkThreadSupportDtoStanceEnum>(
    LinkThreadSupportDtoStanceEnum.Supports,
  );
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const STANCE_OPTIONS: Array<{ value: LinkThreadSupportDtoStanceEnum; label: string }> = [
    { value: LinkThreadSupportDtoStanceEnum.Supports, label: t("caseGraph.linkHypothesisDialog.supportsLabel") },
    { value: LinkThreadSupportDtoStanceEnum.Contradicts, label: t("caseGraph.linkHypothesisDialog.contradictsLabel") },
    { value: LinkThreadSupportDtoStanceEnum.Neutral, label: t("caseGraph.linkHypothesisDialog.neutralLabel") },
  ];

  React.useEffect(() => {
    if (open) {
      setThreadId(hypotheses[0]?.id ?? "");
      setStance(LinkThreadSupportDtoStanceEnum.Supports);
      setNote("");
    }
  }, [open, hypotheses]);

  const link = async () => {
    if (!node || !threadId) return;
    setSaving(true);
    try {
      const target = await resolveTarget(node);
      await api.threads.caseThreadsControllerLinkSupport({
        id: threadId,
        linkThreadSupportDto: {
          targetType: target.targetType,
          targetId: target.targetId,
          stance,
          note: note.trim() || undefined,
        },
      });
      toast.success(t("caseGraph.linkHypothesisDialog.linked"));
      onOpenChange(false);
      onLinked();
    } catch (err) {
      console.error(err);
      toast.error(t("caseGraph.linkHypothesisDialog.failedToLink"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("caseGraph.linkHypothesisDialog.title")}</DialogTitle>
          <DialogDescription>
            {node ? t("caseGraph.linkHypothesisDialog.recordDesc", { label: node.label }) : ""}
            {node && node.type !== "finding" ? ` ${t("caseGraph.linkHypothesisDialog.addedIfNeeded")}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>{t("caseGraph.linkHypothesisDialog.hypothesisLabel")}</Label>
            <Select value={threadId} onValueChange={setThreadId}>
              <SelectTrigger>
                <SelectValue placeholder={t("caseGraph.linkHypothesisDialog.hypothesisPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {hypotheses.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 border border-foreground/40"
                        style={{ background: hypothesisColors[h.id] ?? "#888" }}
                      />
                      {h.title}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("caseGraph.linkHypothesisDialog.stanceLabel")}</Label>
            <Select
              value={stance}
              onValueChange={(v) => setStance(v as LinkThreadSupportDtoStanceEnum)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STANCE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("caseGraph.linkHypothesisDialog.noteLabel")}</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("caseGraph.linkHypothesisDialog.notePlaceholder")}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={link} disabled={!node || !threadId || saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("caseGraph.linkHypothesisDialog.link")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
