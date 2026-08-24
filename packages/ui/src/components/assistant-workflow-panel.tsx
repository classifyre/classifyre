"use client";

import * as React from "react";
import {
  Bot,
  Loader2,
  MessageSquarePlus,
  Send,
  Upload,
  X,
} from "lucide-react";

import { cn } from "../lib/utils";
import { Badge } from "./badge";
import { Button } from "./button";
import { Textarea } from "./textarea";

export type AssistantPanelAttachment = {
  kind?: string;
  title: string;
  payload: unknown;
};

export type AssistantPanelToolCall = {
  name: string;
  status: string;
};

export type AssistantPanelMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  attachments?: AssistantPanelAttachment[];
  toolCalls?: AssistantPanelToolCall[];
};

export type AssistantPanelPendingConfirmation = {
  title: string;
  detail: string;
};

export type AssistantPanelUploadedFile = {
  id: string;
  label: string;
};

/**
 * One thing the user can point the assistant at with "@".
 *
 * `token` is what gets inserted into the message ("@cell:2"); `group` only
 * drives the heading the option is listed under. The panel does not know what
 * a cell or a detector is — the page that owns them supplies these.
 */
export type AssistantPanelMention = {
  token: string;
  label: string;
  hint?: string;
  group: string;
};

export type AssistantPanelThread = {
  id: string;
  title: string;
};

/** How far back from the caret a mention token may start. */
const MENTION_MAX_LENGTH = 64;

/**
 * The "@..." the caret currently sits inside, or null.
 *
 * A mention starts at an "@" that follows the start of the text or whitespace,
 * and runs to the caret with no whitespace in between — so "email @ me" and a
 * finished "@cell:2 now" both close the menu, while "@cel" keeps it open.
 */
export function activeMentionQuery(
  value: string,
  caret: number,
): { start: number; query: string } | null {
  const from = Math.max(0, caret - MENTION_MAX_LENGTH);
  const slice = value.slice(from, caret);
  const at = slice.lastIndexOf("@");
  if (at === -1) {
    return null;
  }
  const start = from + at;
  const before = start === 0 ? "" : value[start - 1];
  if (before && !/\s/.test(before)) {
    return null;
  }
  const query = value.slice(start + 1, caret);
  if (/\s/.test(query)) {
    return null;
  }
  return { start, query };
}

/** Mentions matching what has been typed after the "@", best-effort substring. */
export function filterMentions(
  mentions: readonly AssistantPanelMention[],
  query: string,
): AssistantPanelMention[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return mentions.slice(0, 40);
  }
  return mentions
    .filter((mention) =>
      `${mention.token} ${mention.label}`.toLowerCase().includes(needle),
    )
    .slice(0, 40);
}

type AssistantWorkflowPanelProps = {
  title: string;
  subtitle?: string;
  messages: readonly AssistantPanelMessage[];
  pendingConfirmation?: AssistantPanelPendingConfirmation | null;
  onConfirm?: () => void;
  onCancelConfirmation?: () => void;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  canSend: boolean;
  disabled?: boolean;
  submitting?: boolean;
  placeholder: string;
  footerNote?: React.ReactNode;
  uploadedFiles?: readonly AssistantPanelUploadedFile[];
  onUploadClick?: () => void;
  uploadDisabled?: boolean;
  uploadingFile?: boolean;
  onClose?: () => void;
  className?: string;
  headerClassName?: string;
  /** Things the user can reference with "@". Omit to disable the menu. */
  mentions?: readonly AssistantPanelMention[];
  /** Past conversations in this context. Omit to hide the thread controls. */
  threads?: readonly AssistantPanelThread[];
  activeThreadId?: string | null;
  onNewThread?: () => void;
  onSelectThread?: (id: string) => void;
};

export function AssistantWorkflowPanel({
  title,
  subtitle,
  messages,
  pendingConfirmation = null,
  onConfirm,
  onCancelConfirmation,
  input,
  onInputChange,
  onSend,
  canSend,
  disabled = false,
  submitting = false,
  placeholder,
  footerNote,
  uploadedFiles = [],
  onUploadClick,
  uploadDisabled = false,
  uploadingFile = false,
  onClose,
  className,
  headerClassName,
  mentions,
  threads,
  activeThreadId = null,
  onNewThread,
  onSelectThread,
}: AssistantWorkflowPanelProps) {
  const messagesScrollRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [caret, setCaret] = React.useState(0);
  const [mentionOpen, setMentionOpen] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState(0);
  const [threadsOpen, setThreadsOpen] = React.useState(false);

  const mentionQuery =
    mentions && mentions.length > 0 && mentionOpen
      ? activeMentionQuery(input, caret)
      : null;
  const mentionMatches = React.useMemo(
    () => (mentionQuery ? filterMentions(mentions ?? [], mentionQuery.query) : []),
    [mentionQuery, mentions],
  );
  const mentionActive = mentionMatches.length > 0;

  React.useEffect(() => {
    setHighlighted(0);
  }, [mentionQuery?.query]);

  /** Swap the "@..." under the caret for the chosen token, then keep typing. */
  const insertMention = React.useCallback(
    (mention: AssistantPanelMention) => {
      if (!mentionQuery) {
        return;
      }
      const next = `${input.slice(0, mentionQuery.start)}${mention.token} ${input.slice(caret)}`;
      const nextCaret = mentionQuery.start + mention.token.length + 1;
      onInputChange(next);
      setMentionOpen(false);
      requestAnimationFrame(() => {
        const element = inputRef.current;
        if (!element) {
          return;
        }
        element.focus();
        element.setSelectionRange(nextCaret, nextCaret);
        setCaret(nextCaret);
      });
    },
    [caret, input, mentionQuery, onInputChange],
  );

  React.useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const container = messagesScrollRef.current;
      if (!container) {
        return;
      }

      container.scrollTo({
        top: container.scrollHeight,
        behavior: messages.length > 1 ? "smooth" : "auto",
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [messages]);

  return (
    <section
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-[8px] border-2 border-border bg-card text-card-foreground shadow-[8px_8px_0_var(--color-border)]",
        className,
      )}
    >
      <header
        className={cn(
          "shrink-0 border-b-2 border-border bg-foreground px-4 py-3 text-primary-foreground",
          headerClassName,
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] border border-primary-foreground/45 bg-primary-foreground/10">
                <Bot className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.08em]">
                  {title}
                </h3>
                {subtitle ? (
                  <p className="text-[11px] uppercase tracking-[0.14em] text-primary-foreground/60">
                    {subtitle}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onNewThread ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-[4px] border border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
                onClick={() => {
                  setThreadsOpen(false);
                  onNewThread();
                }}
                title="New chat"
                data-testid="assistant-new-thread"
              >
                <MessageSquarePlus className="h-4 w-4" />
                <span className="sr-only">New chat</span>
              </Button>
            ) : null}
            {threads && threads.length > 1 && onSelectThread ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-[4px] border border-primary-foreground/30 px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
                onClick={() => setThreadsOpen((open) => !open)}
                data-testid="assistant-threads-toggle"
              >
                {`Chats (${threads.length})`}
              </Button>
            ) : null}
            {onClose ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-[4px] border border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close assistant</span>
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      {threadsOpen && threads && onSelectThread ? (
        <div
          className="max-h-40 shrink-0 overflow-y-auto border-b-2 border-border bg-muted/40"
          data-testid="assistant-thread-list"
        >
          {threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              onClick={() => {
                onSelectThread(thread.id);
                setThreadsOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-2 border-b border-border/60 px-4 py-2 text-left text-xs last:border-b-0 hover:bg-accent hover:text-accent-foreground",
                thread.id === activeThreadId && "bg-accent/60 font-semibold",
              )}
              data-testid={`assistant-thread-${thread.id}`}
            >
              <span className="truncate">{thread.title}</span>
              {thread.id === activeThreadId ? (
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                  current
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="assistant-window-body flex min-h-0 flex-1 flex-col">
        <div
          ref={messagesScrollRef}
          className="assistant-scroll-area min-h-0 flex-1 overflow-y-auto px-4 py-4"
        >
          <div className="space-y-3 pr-1">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex",
                  message.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "min-w-0 max-w-[92%] rounded-[6px] border-2 px-4 py-3 shadow-[4px_4px_0_var(--color-border)]",
                    message.role === "user"
                      ? "border-black bg-foreground text-primary-foreground"
                      : "border-border bg-card",
                  )}
                >
                  <div className="whitespace-pre-wrap text-sm leading-6 break-words [overflow-wrap:anywhere]">
                    {message.content}
                  </div>

                  {message.attachments?.map((attachment) => (
                    <div
                      key={`${message.id}-${attachment.kind ?? attachment.title}`}
                      className="mt-3 rounded-[4px] border-2 border-border bg-background px-3 py-2"
                    >
                      <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                        {attachment.title}
                      </div>
                      <pre className="mt-2 overflow-x-auto text-xs leading-5 text-foreground/80">
                        {JSON.stringify(attachment.payload, null, 2)}
                      </pre>
                    </div>
                  ))}

                  {message.toolCalls?.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {message.toolCalls.map((toolCall) => (
                        <Badge
                          key={`${message.id}-${toolCall.name}`}
                          variant="outline"
                          className="rounded-[4px] border-black font-mono text-[10px]"
                        >
                          {toolCall.name}: {toolCall.status}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        {pendingConfirmation ? (
          <div className="shrink-0 border-t-2 border-border px-4 py-4">
            <div className="rounded-[6px] border-2 border-black bg-[var(--color-accent)] px-4 py-3 text-[var(--color-accent-foreground)] shadow-[4px_4px_0_var(--color-border)]">
              <div className="text-[11px] font-mono uppercase tracking-[0.16em]">
                Confirmation required
              </div>
              <div className="mt-1 text-sm font-semibold">
                {pendingConfirmation.title}
              </div>
              <div className="mt-1 text-sm opacity-80">
                {pendingConfirmation.detail}
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  onClick={onConfirm}
                  disabled={submitting || !onConfirm}
                  className="rounded-[4px] border-2 border-black bg-foreground text-primary-foreground shadow-[3px_3px_0_var(--color-border)]"
                >
                  Confirm
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCancelConfirmation}
                  disabled={submitting || !onCancelConfirmation}
                  className="rounded-[4px] border-2 border-black bg-background shadow-[3px_3px_0_var(--color-border)]"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="shrink-0 border-t-2 border-border px-4 py-4">
          <div className="space-y-3">
            <div className="relative">
              {mentionActive && mentionQuery ? (
                <div
                  className="absolute bottom-full left-0 z-10 mb-1 max-h-56 w-full overflow-y-auto rounded-[6px] border-2 border-black bg-popover text-popover-foreground shadow-[4px_4px_0_var(--color-border)]"
                  data-testid="assistant-mention-menu"
                >
                  {mentionMatches.map((mention, index) => (
                    <button
                      key={mention.token}
                      type="button"
                      // Mouse-down, not click: a click fires after the textarea
                      // has already lost focus and moved the caret.
                      onMouseDown={(event) => {
                        event.preventDefault();
                        insertMention(mention);
                      }}
                      onMouseEnter={() => setHighlighted(index)}
                      className={cn(
                        "flex w-full flex-col items-start gap-0.5 border-b border-border/60 px-3 py-1.5 text-left last:border-b-0",
                        index === highlighted && "bg-accent text-accent-foreground",
                      )}
                      data-testid={`assistant-mention-${mention.token}`}
                    >
                      <span className="font-mono text-[11px]">
                        {mention.token}
                        <span className="ml-2 font-sans text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {mention.group}
                        </span>
                      </span>
                      <span className="truncate text-xs">{mention.label}</span>
                      {mention.hint ? (
                        <span className="truncate text-[10px] text-muted-foreground">
                          {mention.hint}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(event) => {
                  onInputChange(event.target.value);
                  setCaret(event.target.selectionStart ?? 0);
                  setMentionOpen(true);
                }}
                onSelect={(event) =>
                  setCaret(event.currentTarget.selectionStart ?? 0)
                }
                onBlur={() => setMentionOpen(false)}
                onKeyDown={(event) => {
                  // While the mention menu is up it owns the arrows, Enter/Tab
                  // and Escape; otherwise Enter still sends.
                  if (mentionActive) {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setHighlighted(
                        (current) => (current + 1) % mentionMatches.length,
                      );
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setHighlighted(
                        (current) =>
                          (current - 1 + mentionMatches.length) %
                          mentionMatches.length,
                      );
                      return;
                    }
                    if (event.key === "Enter" || event.key === "Tab") {
                      const chosen = mentionMatches[highlighted];
                      if (chosen) {
                        event.preventDefault();
                        insertMention(chosen);
                        return;
                      }
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setMentionOpen(false);
                      return;
                    }
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    onSend();
                  }
                }}
                disabled={disabled}
                placeholder={placeholder}
                className="min-h-[108px] rounded-[6px] border-2 border-black bg-background shadow-[4px_4px_0_var(--color-border)]"
                data-testid="assistant-input"
              />
            </div>
            {uploadedFiles.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {uploadedFiles.map((file) => (
                  <Badge
                    key={file.id}
                    variant="outline"
                    className="rounded-[4px] border-border font-mono text-[10px]"
                  >
                    {file.label}
                  </Badge>
                ))}
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">{footerNote}</div>
              <div className="flex items-center gap-2">
                {onUploadClick ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onUploadClick}
                    disabled={uploadDisabled}
                    className="rounded-[4px] border-2 border-border bg-background shadow-[3px_3px_0_var(--color-border)]"
                  >
                    {uploadingFile ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    {uploadingFile ? "Uploading..." : "Upload"}
                  </Button>
                ) : null}
                {submitting ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled
                    className="rounded-[4px] border-2 border-border bg-background text-muted-foreground shadow-[3px_3px_0_var(--color-border)]"
                  >
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing
                  </Button>
                ) : null}
                <Button
                  type="button"
                  onClick={onSend}
                  disabled={!canSend}
                  className="rounded-[4px] border-2 border-black bg-foreground text-primary-foreground shadow-[3px_3px_0_var(--color-border)]"
                >
                  <Send className="mr-2 h-4 w-4" />
                  Send
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
