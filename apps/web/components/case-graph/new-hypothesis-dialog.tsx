"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  api,
  CreateThreadDtoKindEnum,
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
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Textarea } from "@workspace/ui/components/textarea";
import { Loader2 } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";

export interface NewHypothesisDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  caseId: string;
  /** Label of a node that will be linked right after creation, if any. */
  linkNodeLabel?: string | null;
  onCreated: (thread: ThreadResponseDto) => void;
}

export function NewHypothesisDialog({
  open,
  onOpenChange,
  caseId,
  linkNodeLabel,
  onCreated,
}: NewHypothesisDialogProps) {
  const { t } = useTranslation();
  const [title, setTitle] = React.useState("");
  const [statement, setStatement] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setTitle("");
      setStatement("");
    }
  }, [open]);

  const create = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const thread = await api.threads.caseThreadsControllerCreate({
        caseId,
        createThreadDto: {
          kind: CreateThreadDtoKindEnum.Hypothesis,
          title: title.trim(),
          statement: statement.trim() || undefined,
        },
      });
      toast.success(t("caseGraph.newHypothesisDialog.hypothesisCreated"));
      onOpenChange(false);
      onCreated(thread);
    } catch (err) {
      console.error(err);
      toast.error(t("caseGraph.newHypothesisDialog.failedToCreate"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("caseGraph.newHypothesisDialog.title")}</DialogTitle>
          <DialogDescription>
            {linkNodeLabel
              ? t("caseGraph.newHypothesisDialog.linkedNode", { label: linkNodeLabel })
              : t("caseGraph.newHypothesisDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>{t("caseGraph.newHypothesisDialog.titleLabel")}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("caseGraph.newHypothesisDialog.titlePlaceholder")}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("caseGraph.newHypothesisDialog.statementLabel")}</Label>
            <Textarea
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              placeholder={t("caseGraph.newHypothesisDialog.statementPlaceholder")}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={create} disabled={!title.trim() || saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("caseGraph.newHypothesisDialog.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
