"use client";

import * as React from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { Check, Loader2, MessageSquare, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import type {
  DataRequestCommentThreadDto,
  ThreadEntryDto,
} from "@workspace/api-client";
import type { DataRequestPin } from "@workspace/schemas/data-request";
import { Button } from "@workspace/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { ActorChip } from "@/components/actor-chip";
import { apiErrorMessage } from "@/lib/data-query";
import {
  getDataRequestCommentEntries,
  replyDataRequestComment,
  resolveDataRequestComment,
} from "@/lib/data-requests";
import { useRequest, useRequestStore } from "../store/request-context";

export interface RequestCommentPinData extends Record<string, unknown> {
  pin: DataRequestPin;
  thread: DataRequestCommentThreadDto | null;
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

  const { pin, thread, canComment } = data;
  const open = openThreadId === pin.threadId;
  const resolved = Boolean(thread?.resolvedAt);

  const [entries, setEntries] = React.useState<ThreadEntryDto[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [reply, setReply] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    getDataRequestCommentEntries(caseId, pin.threadId)
      .then((res) => {
        if (active) setEntries(res.items ?? []);
      })
      .catch(async (err) => {
        if (active) toast.error(await apiErrorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, caseId, pin.threadId]);

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim() || busy) return;
    setBusy(true);
    try {
      await replyDataRequestComment(
        caseId,
        pin.threadId,
        reply.trim(),
      );
      const refreshed = await getDataRequestCommentEntries(caseId, pin.threadId);
      setEntries(refreshed.items ?? []);
      setReply("");
    } catch (err) {
      toast.error(await apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleResolve = async () => {
    setBusy(true);
    try {
      await resolveDataRequestComment(caseId, pin.threadId, !resolved);
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
            "flex h-7 items-center gap-1 rounded-full border px-2 font-mono text-[10px] shadow-xs transition-transform hover:scale-105",
            resolved
              ? "border-border bg-muted text-muted-foreground"
              : "border-amber-500/70 bg-amber-50 text-amber-900 dark:bg-amber-950/70 dark:text-amber-200",
          )}
          data-testid={`comment-pin-${pin.threadId}`}
        >
          <MessageSquare className="h-3 w-3" />
          <span>{thread?.entryCount ?? 1}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 space-y-3 p-3"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b pb-2">
          <span className="truncate text-xs font-medium">
            {thread?.title ?? t("dataRequest.canvas.commentTitle")}
          </span>
          {canComment && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px]"
              disabled={busy}
              onClick={toggleResolve}
            >
              {resolved ? (
                <>
                  <RotateCcw className="mr-1 h-3 w-3" />
                  {t("dataRequest.canvas.reopenComment")}
                </>
              ) : (
                <>
                  <Check className="mr-1 h-3 w-3" />
                  {t("dataRequest.canvas.resolveComment")}
                </>
              )}
            </Button>
          )}
        </div>

        <div className="max-h-52 space-y-2 overflow-y-auto">
          {loading ? (
            <div className="flex items-center gap-1.5 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("common.loading")}
            </div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                className="space-y-1 rounded border bg-muted/30 p-2 text-xs"
              >
                {entry.author && (
                  <div className="text-[11px] text-muted-foreground">
                    <ActorChip actorRef={entry.author} />
                  </div>
                )}
                <p className="whitespace-pre-wrap break-words text-foreground">
                  {entry.body}
                </p>
              </div>
            ))
          )}
        </div>

        {canComment && !resolved && (
          <form onSubmit={sendReply} className="space-y-1.5 border-t pt-2">
            <Textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={t("dataRequest.canvas.replyPlaceholder")}
              rows={2}
              className="text-xs"
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                className="h-7 text-xs"
                disabled={!reply.trim() || busy}
              >
                <Send className="mr-1 h-3 w-3" />
                {t("dataRequest.canvas.reply")}
              </Button>
            </div>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
});
