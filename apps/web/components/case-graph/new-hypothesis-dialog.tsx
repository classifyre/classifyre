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
      toast.success("Hypothesis created");
      onOpenChange(false);
      onCreated(thread);
    } catch (err) {
      console.error(err);
      toast.error("Failed to create hypothesis");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New hypothesis</DialogTitle>
          <DialogDescription>
            {linkNodeLabel
              ? `“${linkNodeLabel}” will be linked to it as the first piece of evidence.`
              : "A competing explanation you can attach supporting or contradicting evidence to."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Credentials leaked through CI logs"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Statement (optional)</Label>
            <Textarea
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              placeholder="What exactly does this hypothesis claim, and what would prove or refute it?"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={create} disabled={!title.trim() || saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create hypothesis
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
