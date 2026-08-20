"use client";

import * as React from "react";
import Link from "next/link";
import { api } from "@workspace/api-client";
import { Loader2, Send, Sparkles, Undo2, X } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { useNsPath } from "@/lib/ns-path";
import { useOptionalAiHealth } from "@/components/ai-health";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import {
  buildMessages,
  parseAiReply,
  type AiMessage,
  type NotebookAiContext,
} from "@/lib/notebook-ai";

export interface CellAiAssistantProps {
  context: NotebookAiContext;
  /** Applied when the model returns code. */
  onApplyCode: (source: string) => void;
  /** Restores whatever the cell held before the last applied change. */
  onUndo: (source: string) => void;
  onClose: () => void;
  disabled?: boolean;
}

interface Turn {
  role: "user" | "assistant";
  content: string;
  /** Set on an assistant turn that changed the cell, for Undo. */
  replaced?: string;
  applied?: boolean;
}

/**
 * Ask the model to write or explain this cell.
 *
 * One provider call per turn and nothing else — no MCP, no tools, no other API
 * requests. The model is given the whole notebook, the declared packages, the
 * variables and the *names* of the secrets, so it can write
 * `ctx.secret("api_token")` without ever being told what the token is.
 *
 * A reply containing a python block replaces the cell; a reply without one is
 * treated as an answer and changes nothing. That keeps "write this for me" and
 * "why does this fail?" in the same box without a mode switch.
 */
export function CellAiAssistant({
  context,
  onApplyCode,
  onUndo,
  onClose,
  disabled = false,
}: CellAiAssistantProps) {
  const { t } = useTranslation();
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [question, setQuestion] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const endRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, busy]);

  const ask = React.useCallback(async () => {
    const asked = question.trim();
    if (!asked || busy) return;

    setBusy(true);
    setError(null);
    setQuestion("");

    // History is the prose exchange only. The notebook itself is rebuilt into
    // the system prompt each turn, so the model never reasons about a stale
    // copy of code the user has since edited.
    const history: AiMessage[] = turns.map((turn) => ({
      role: turn.role,
      content: turn.content,
    }));
    const previousSource =
      context.cells.find((cell) => cell.id === context.targetCellId)?.source ??
      "";

    setTurns((current) => [...current, { role: "user", content: asked }]);

    try {
      const response = await api.ai.aiControllerComplete({
        aiCompleteRequestDto: {
          messages: buildMessages(context, history, asked),
        },
      });
      const reply = parseAiReply(response.content ?? "");

      if (reply.code) {
        onApplyCode(reply.code);
      }
      setTurns((current) => [
        ...current,
        {
          role: "assistant",
          content: reply.text || t("notebook.ai.updatedCell"),
          replaced: reply.code ? previousSource : undefined,
          applied: Boolean(reply.code),
        },
      ]);
    } catch (caught) {
      setError(await extractApiErrorMessage(caught, t("notebook.ai.failed")));
    } finally {
      setBusy(false);
    }
  }, [question, busy, turns, context, onApplyCode, t]);

  return (
    <div
      className="space-y-3 rounded-md border bg-muted/20 p-3"
      data-testid={`cell-ai-${context.targetCellId}`}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs font-semibold">
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
          {t("notebook.ai.title")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onClose}
          aria-label={t("common.close")}
          data-testid={`cell-ai-close-${context.targetCellId}`}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {turns.length === 0 && !busy && (
        <p className="text-xs text-muted-foreground">
          {t("notebook.ai.placeholderHint")}
        </p>
      )}

      {turns.length > 0 && (
        <div
          className="max-h-72 space-y-2 overflow-y-auto"
          data-testid="cell-ai-history"
        >
          {turns.map((turn, index) => (
            <div
              key={index}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs",
                turn.role === "user"
                  ? "bg-background"
                  : "border border-border/60 bg-card",
              )}
              data-testid={`cell-ai-turn-${turn.role}`}
            >
              <p className="whitespace-pre-wrap break-words">{turn.content}</p>
              {turn.applied && turn.replaced !== undefined && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    {t("notebook.ai.cellUpdated")}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-[11px]"
                    onClick={() => onUndo(turn.replaced!)}
                    data-testid="cell-ai-undo"
                  >
                    <Undo2 className="mr-1 h-3 w-3" />
                    {t("notebook.ai.undo")}
                  </Button>
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("notebook.ai.thinking")}
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      {error && (
        <p
          className="text-xs font-medium text-destructive"
          data-testid="cell-ai-error"
        >
          {error}
        </p>
      )}

      <div className="flex items-end gap-2">
        <Textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline. Matches every other chat
            // box, and the notebook's own Shift+Enter never reaches here.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void ask();
            }
          }}
          placeholder={t("notebook.ai.placeholder")}
          disabled={disabled || busy}
          rows={2}
          className="min-h-0 resize-none bg-background text-xs"
          data-testid={`cell-ai-input-${context.targetCellId}`}
        />
        <Button
          type="button"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => void ask()}
          disabled={disabled || busy || !question.trim()}
          aria-label={t("notebook.ai.send")}
          data-testid={`cell-ai-send-${context.targetCellId}`}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

/**
 * The toolbar button that opens the assistant.
 *
 * Disabled rather than hidden when no provider is configured: an absent control
 * teaches nothing, whereas a disabled one with a link is how someone finds out
 * the feature exists and what it needs.
 */
export function CellAiButton({
  cellId,
  open,
  onToggle,
  disabled = false,
}: {
  cellId: string;
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  // Optional on purpose: this button can be rendered outside the dashboard
  // shell, and an absent provider should disable it rather than throw.
  const health = useOptionalAiHealth();
  const status = health?.status ?? "not_configured";
  const available = status === "ok";

  if (!available) {
    const reason =
      status === "error"
        ? t("notebook.ai.providerError")
        : t("notebook.ai.notConfigured");
    return (
      <Link
        href={nsPath("/harness?tab=config")}
        title={`${reason} ${t("notebook.ai.configureHint")}`}
        aria-label={`${reason} ${t("notebook.ai.configureHint")}`}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/50 hover:bg-accent hover:text-muted-foreground"
        data-testid={`cell-ai-unavailable-${cellId}`}
      >
        <Sparkles className="h-3.5 w-3.5" />
      </Link>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-6 w-6", open && "bg-accent text-accent-foreground")}
      onClick={onToggle}
      disabled={disabled}
      title={t("notebook.ai.title")}
      aria-label={t("notebook.ai.title")}
      data-testid={`cell-ai-open-${cellId}`}
    >
      <Sparkles className="h-3.5 w-3.5" />
    </Button>
  );
}
