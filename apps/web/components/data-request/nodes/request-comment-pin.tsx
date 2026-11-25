"use client";

import * as React from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { Check, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type DataRequestCommentThreadDto,
  type ThreadEntryDto,
} from "@workspace/api-client";
import type { DataRequestPin } from "@workspace/schemas/data-request";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { apiErrorMessage } from "@/lib/data-query";
import { CommentThreadPanel } from "@/components/case-board/nodes/comment-pin";
import { useRequest, useRequestStore } from "../store/request-context";

export interface RequestCommentPinData extends Record<string, unknown> {
  pin: DataRequestPin;
  thread: DataRequestCommentThreadDto | null;
  anchorLabel?: string | null;
  canComment: boolean;
}

export type RequestCommentPinNode = Node<
  RequestCommentPinData,
  "request-comment"
>;

export const RequestCommentPin = React.memo(function RequestCommentPin({
  data,
}: NodeProps<RequestCommentPinNode>) {
  const { t } = useTranslation();
  const store = useRequestStore();
  const caseId = useRequest((s) => s.caseId);
  const openThreadId = useRequest((s) => s.openCommentThreadId);

  const { pin, thread, anchorLabel, canComment } = data;
  const open = openThreadId === pin.threadId;
  const resolved = Boolean(thread?.resolvedAt);

  const [entries, setEntries] = React.useState<ThreadEntryDto[] | null>(null);
  const [busy, setBusy] = React.useState(false);

  const loadEntries = React.useCallback(async () => {
    try {
      const res =
        await api.dataRequests.dataRequestsControllerGetCommentEntries({
          id: caseId,
          threadId: pin.threadId,
        });
      setEntries(res.items ?? []);
    } catch (err) {
      setEntries([]);
      toast.error(await apiErrorMessage(err));
    }
  }, [caseId, pin.threadId]);

  React.useEffect(() => {
    if (!open) return;
    setEntries(null);
    void loadEntries();
  }, [open, loadEntries]);

  const handleReply = async (body: string) => {
    setBusy(true);
    try {
      await api.dataRequests.dataRequestsControllerReplyComment({
        id: caseId,
        threadId: pin.threadId,
        addDataRequestCommentReplyDto: { body },
      });
      await loadEntries();
    } catch (err) {
      toast.error(await apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleResolve = async () => {
    setBusy(true);
    try {
      await api.dataRequests.dataRequestsControllerResolveComment({
        id: caseId,
        threadId: pin.threadId,
        resolveDataRequestCommentDto: { resolved: !resolved },
      });
      await store.getState().reloadFromServer();
    } catch (err) {
      toast.error(await apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) =>
        store.getState().setOpenCommentThreadId(next ? pin.threadId : null)
      }
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-7 items-center gap-1 rounded-full rounded-bl-none border px-2 font-mono text-[10px] shadow-xs transition-transform hover:scale-105",
            resolved
              ? "border-border bg-muted text-muted-foreground"
              : "border-amber-500/70 bg-amber-50 text-amber-900 dark:bg-amber-950/70 dark:text-amber-200",
          )}
          title={anchorLabel ?? thread?.title ?? t("dataRequest.canvas.commentTitle")}
          data-testid={`comment-pin-${pin.threadId}`}
        >
          <MessageSquare className="h-3 w-3" />
          {anchorLabel && (
            <span className="max-w-[90px] truncate">{anchorLabel}</span>
          )}
          <span>{thread?.entryCount ?? 1}</span>
          {resolved && <Check className="h-3 w-3" aria-hidden />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="nowheel nodrag w-80 p-0"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        {open && (
          <CommentThreadPanel
            entries={entries}
            headerLabel={thread?.title ?? t("dataRequest.canvas.commentTitle")}
            anchorLabel={anchorLabel}
            resolved={resolved}
            readOnly={!canComment}
            busy={busy}
            allowReplyWhenResolved={false}
            onResolve={handleResolve}
            onReply={handleReply}
          />
        )}
      </PopoverContent>
    </Popover>
  );
});
