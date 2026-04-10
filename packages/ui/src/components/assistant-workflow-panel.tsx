"use client";

import * as React from "react";
import { Bot, Loader2, Send, Upload, X } from "lucide-react";

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
}: AssistantWorkflowPanelProps) {
  const messagesScrollRef = React.useRef<HTMLDivElement | null>(null);

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
      </header>

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
            <Textarea
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onSend();
                }
              }}
              disabled={disabled}
              placeholder={placeholder}
              className="min-h-[108px] rounded-[6px] border-2 border-black bg-background shadow-[4px_4px_0_var(--color-border)]"
            />
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
