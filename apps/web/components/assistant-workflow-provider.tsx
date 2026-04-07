"use client";

import * as React from "react";
import { Bot, Loader2, Send, Sparkles, Upload, Wand2, X } from "lucide-react";
import {
  api,
  type AssistantChatMessage,
  type AssistantChatResponse,
  type AssistantPendingConfirmation,
  type AssistantParsedUpload,
  type AssistantToolCallSummary,
  type AssistantUiAction,
  type AssistantPageContext,
} from "@workspace/api-client";
import { assistantContexts } from "@workspace/schemas/assistant";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import { Badge } from "@workspace/ui/components/badge";
import { cn } from "@workspace/ui/lib/utils";
import { toast } from "sonner";
import { usePathname } from "next/navigation";
import { Rnd } from "react-rnd";
import { useInstanceSettings } from "@/components/instance-settings-provider";

type AssistantAttachment = Extract<
  AssistantUiAction,
  { type: "attach_result" }
>;

type AssistantTranscriptMessage = AssistantChatMessage & {
  id: string;
  attachments?: AssistantAttachment[];
  toolCalls?: AssistantToolCallSummary[];
  isIntro?: boolean;
};

export type AssistantPageBridge = {
  contextKey: keyof typeof assistantContexts;
  canOpen: boolean;
  getContext: () => Promise<AssistantPageContext> | AssistantPageContext;
  applyAction: (action: AssistantUiAction) => Promise<void> | void;
};

type AssistantWorkflowContextValue = {
  active: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  bridge: AssistantPageBridge | null;
  registerBridge: (bridge: AssistantPageBridge | null) => void;
};

const AssistantWorkflowContext =
  React.createContext<AssistantWorkflowContextValue | null>(null);

function nextId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"] as const;
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

type AssistantWindowState = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const DESKTOP_WINDOW_WIDTH = 520;
const MIN_WINDOW_WIDTH = 340;
const MIN_WINDOW_HEIGHT = 420;
const MOBILE_BREAKPOINT = 760;

function createAssistantWindowState(
  viewportWidth: number,
  viewportHeight: number,
): AssistantWindowState {
  const mobileWidth = Math.max(280, viewportWidth - 16);
  const mobileHeight = Math.max(360, viewportHeight - 86);

  if (viewportWidth < MOBILE_BREAKPOINT) {
    return {
      x: 8,
      y: 72,
      width: mobileWidth,
      height: mobileHeight,
    };
  }

  const width = Math.min(
    DESKTOP_WINDOW_WIDTH,
    Math.max(MIN_WINDOW_WIDTH, viewportWidth - 48),
  );
  const height = Math.min(780, Math.max(520, viewportHeight - 112));

  return {
    x: Math.max(8, viewportWidth - width - 24),
    y: Math.max(16, viewportHeight - height - 24),
    width,
    height,
  };
}

function clampAssistantWindowState(
  state: AssistantWindowState,
  viewportWidth: number,
  viewportHeight: number,
): AssistantWindowState {
  const maxWidth = Math.max(280, viewportWidth - 8);
  const maxHeight = Math.max(320, viewportHeight - 8);
  const width = Math.min(state.width, maxWidth);
  const height = Math.min(state.height, maxHeight);
  const x = Math.min(Math.max(0, state.x), Math.max(0, viewportWidth - width));
  const y = Math.min(
    Math.max(0, state.y),
    Math.max(0, viewportHeight - height),
  );
  return { x, y, width, height };
}

export function AssistantWorkflowProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [bridge, setBridge] = React.useState<AssistantPageBridge | null>(null);
  const [open, setOpen] = React.useState(false);
  const [messages, setMessages] = React.useState<AssistantTranscriptMessage[]>(
    [],
  );
  const [pendingConfirmation, setPendingConfirmation] =
    React.useState<AssistantPendingConfirmation | null>(null);
  const [input, setInput] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [uploadingFile, setUploadingFile] = React.useState(false);
  const [uploadedFiles, setUploadedFiles] = React.useState<
    AssistantParsedUpload[]
  >([]);
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });
  const [assistantWindow, setAssistantWindow] =
    React.useState<AssistantWindowState | null>(null);
  const messagesScrollRef = React.useRef<HTMLDivElement | null>(null);
  const uploadInputRef = React.useRef<HTMLInputElement | null>(null);

  const isCompactViewport =
    viewport.width > 0 && viewport.width < MOBILE_BREAKPOINT;
  const minWindowWidth = isCompactViewport
    ? Math.max(280, viewport.width - 16)
    : MIN_WINDOW_WIDTH;
  const minWindowHeight = Math.min(
    MIN_WINDOW_HEIGHT,
    Math.max(320, viewport.height - 96),
  );
  const maxWindowWidth = Math.max(280, viewport.width - 8);
  const maxWindowHeight = Math.max(320, viewport.height - 8);
  const effectiveViewport = React.useMemo(() => {
    if (viewport.width > 0 && viewport.height > 0) {
      return viewport;
    }

    if (typeof window !== "undefined") {
      return {
        width: window.innerWidth,
        height: window.innerHeight,
      };
    }

    return {
      width: 1280,
      height: 800,
    };
  }, [viewport]);

  React.useEffect(() => {
    setMessages([]);
    setPendingConfirmation(null);
    setInput("");
    setUploadedFiles([]);
    setOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const updateViewport = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  React.useEffect(() => {
    if (!open || viewport.width === 0 || viewport.height === 0) {
      return;
    }

    setAssistantWindow((current) => {
      const baseState = current;
      const next = baseState
        ? clampAssistantWindowState(baseState, viewport.width, viewport.height)
        : createAssistantWindowState(viewport.width, viewport.height);

      if (
        current &&
        current.x === next.x &&
        current.y === next.y &&
        current.width === next.width &&
        current.height === next.height
      ) {
        return current;
      }

      return next;
    });
  }, [open, viewport.height, viewport.width]);

  React.useEffect(() => {
    if (!open) {
      setAssistantWindow(null);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

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
  }, [messages, open]);

  const registerBridge = React.useCallback(
    (nextBridge: AssistantPageBridge | null) => {
      setBridge(nextBridge);
    },
    [],
  );

  const handleResponse = React.useCallback(
    async (response: AssistantChatResponse) => {
      const attachments = response.actions.filter(
        (action): action is AssistantAttachment =>
          action.type === "attach_result",
      );

      for (const action of response.actions) {
        if (action.type === "show_toast") {
          const showToast =
            action.tone === "success"
              ? toast.success
              : action.tone === "error"
                ? toast.error
                : toast;
          showToast(action.title, {
            description: action.description,
          });
          continue;
        }

        if (action.type === "attach_result") {
          continue;
        }

        await bridge?.applyAction(action);
      }

      setMessages((current) => [
        ...current,
        {
          id: nextId("assistant"),
          role: "assistant",
          content: response.reply,
          attachments,
          toolCalls: response.toolCalls,
        },
      ]);
      setPendingConfirmation(response.pendingConfirmation);
    },
    [bridge],
  );

  const sendMessage = React.useCallback(
    async (content: string) => {
      if (!bridge || !bridge.canOpen) {
        return;
      }

      const trimmed = content.trim();
      if (!trimmed) {
        return;
      }

      const nextUserMessage: AssistantTranscriptMessage = {
        id: nextId("user"),
        role: "user",
        content: trimmed,
      };

      setSubmitting(true);
      setMessages((current) => [...current, nextUserMessage]);
      setInput("");

      try {
        const context = await bridge.getContext();
        const response = await api.assistantRespond({
          messages: [...messages, nextUserMessage].map(
            ({ role, content: text }) => ({
              role,
              content: text,
            }),
          ),
          context: {
            ...context,
            metadata: {
              ...(context.metadata ?? {}),
              assistant_uploads: uploadedFiles.map((file) => ({
                fileName: file.fileName,
                fileType: file.fileType,
                bytes: file.bytes,
                summary: file.summary,
                truncated: file.truncated,
                rowCount: file.rowCount,
                lineCount: file.lineCount,
                columns: file.columns,
                sampleRows: file.sampleRows,
                topLevelKeys: file.topLevelKeys,
                jsonPreview: file.jsonPreview,
                textPreview: file.textPreview,
              })),
            },
          },
          pendingConfirmation,
        });

        await handleResponse(response);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Assistant request failed";
        toast.error("Assistant request failed", {
          description: message,
        });
        setMessages((current) => [
          ...current,
          {
            id: nextId("assistant"),
            role: "assistant",
            content: `I hit an error while calling the assistant workflow.\n\n${message}`,
          },
        ]);
      } finally {
        setSubmitting(false);
      }
    },
    [bridge, handleResponse, messages, pendingConfirmation, uploadedFiles],
  );

  const handleFileUpload = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) {
        return;
      }

      setUploadingFile(true);
      try {
        const parsed = await api.assistantParseUpload(file, file.name);
        setUploadedFiles((current) => [...current, parsed].slice(-5));
        setMessages((current) => [
          ...current,
          {
            id: nextId("assistant"),
            role: "assistant",
            content: `Attached "${parsed.fileName}" (${formatBytes(parsed.bytes)}). ${parsed.summary}`,
          },
        ]);
        toast.success(`Uploaded ${parsed.fileName}`, {
          description: parsed.summary,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to parse uploaded file";
        toast.error("File upload failed", {
          description: message,
        });
      } finally {
        setUploadingFile(false);
      }
    },
    [],
  );

  const active = Boolean(bridge?.canOpen);
  const contextValue = React.useMemo<AssistantWorkflowContextValue>(
    () => ({
      active,
      open,
      setOpen,
      bridge,
      registerBridge,
    }),
    [active, bridge, open, registerBridge],
  );

  const contextMeta = React.useMemo(() => {
    if (!active || !bridge) {
      return null;
    }

    return assistantContexts[bridge.contextKey];
  }, [active, bridge]);
  const introMessage =
    contextMeta?.summary?.trim() ||
    "Use the assistant to patch the current page and confirm MCP actions.";

  React.useEffect(() => {
    if (!open || !active) {
      return;
    }

    setMessages((current) => {
      if (current.length > 0) {
        return current;
      }

      return [
        {
          id: nextId("assistant"),
          role: "assistant",
          content: introMessage,
          isIntro: true,
        },
      ];
    });
  }, [active, introMessage, open]);

  const resolvedAssistantWindow = React.useMemo(() => {
    if (!open) {
      return null;
    }

    if (assistantWindow) {
      return assistantWindow;
    }

    const baseState = createAssistantWindowState(
      effectiveViewport.width,
      effectiveViewport.height,
    );
    return clampAssistantWindowState(
      baseState,
      effectiveViewport.width,
      effectiveViewport.height,
    );
  }, [
    assistantWindow,
    effectiveViewport.height,
    effectiveViewport.width,
    open,
  ]);

  return (
    <AssistantWorkflowContext.Provider value={contextValue}>
      {children}
      <AssistantWorkflowFab />
      {open && resolvedAssistantWindow ? (
        <Rnd
          size={{
            width: resolvedAssistantWindow.width,
            height: resolvedAssistantWindow.height,
          }}
          position={{
            x: resolvedAssistantWindow.x,
            y: resolvedAssistantWindow.y,
          }}
          minWidth={minWindowWidth}
          minHeight={minWindowHeight}
          maxWidth={maxWindowWidth}
          maxHeight={maxWindowHeight}
          bounds="window"
          dragHandleClassName="assistant-drag-handle"
          disableDragging={isCompactViewport}
          enableResizing={!isCompactViewport}
          onDragStop={(_event, data) => {
            setAssistantWindow((current) =>
              current ? { ...current, x: data.x, y: data.y } : current,
            );
          }}
          onResizeStop={(_event, _direction, ref, _delta, position) => {
            setAssistantWindow({
              x: position.x,
              y: position.y,
              width: ref.offsetWidth,
              height: ref.offsetHeight,
            });
          }}
          style={{ zIndex: 60, position: "fixed" }}
        >
          <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[8px] border-2 border-border bg-card text-card-foreground shadow-[8px_8px_0_var(--color-border)]">
            <header className="assistant-drag-handle shrink-0 cursor-grab active:cursor-grabbing select-none border-b-2 border-border bg-foreground px-4 py-3 text-primary-foreground">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] border border-primary-foreground/45 bg-primary-foreground/10">
                      <Bot className="h-4 w-4" />
                    </span>
                    <h3 className="text-sm font-semibold uppercase tracking-[0.08em]">
                      {contextMeta?.title ?? "Assistant"}
                    </h3>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="rounded-[4px] border border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
                  onClick={() => setOpen(false)}
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Close assistant</span>
                </Button>
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
                        message.role === "user"
                          ? "justify-end"
                          : "justify-start",
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
                            key={`${message.id}-${attachment.kind}`}
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
                        onClick={() => void sendMessage("Confirm")}
                        disabled={submitting}
                        className="rounded-[4px] border-2 border-black bg-foreground text-primary-foreground shadow-[3px_3px_0_var(--color-border)]"
                      >
                        Confirm
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setPendingConfirmation(null);
                          toast("Assistant action cancelled");
                        }}
                        disabled={submitting}
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
                  <input
                    ref={uploadInputRef}
                    type="file"
                    accept=".csv,.tsv,.txt,.md,.log,.json,text/plain,text/csv,application/json"
                    className="hidden"
                    onChange={(event) => void handleFileUpload(event)}
                  />
                  <Textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendMessage(input);
                      }
                    }}
                    disabled={!active || submitting}
                    placeholder={
                      active
                        ? "Describe what should change on this page or which MCP action you want to confirm…"
                        : "Assistant is unavailable for this page."
                    }
                    className="min-h-[108px] rounded-[6px] border-2 border-black bg-background shadow-[4px_4px_0_var(--color-border)]"
                  />
                  {uploadedFiles.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {uploadedFiles.map((file, index) => (
                        <Badge
                          key={`${file.fileName}-${index}`}
                          variant="outline"
                          className="rounded-[4px] border-border font-mono text-[10px]"
                        >
                          {file.fileName} · {formatBytes(file.bytes)}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-muted-foreground">
                      {active
                        ? "Patches apply locally first. MCP mutations stay behind confirmation."
                        : "Open a supported source or detector workflow to activate the assistant."}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => uploadInputRef.current?.click()}
                        disabled={!active || submitting || uploadingFile}
                        className="rounded-[4px] border-2 border-border bg-background shadow-[3px_3px_0_var(--color-border)]"
                      >
                        {uploadingFile ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="mr-2 h-4 w-4" />
                        )}
                        {uploadingFile ? "Uploading..." : "Upload"}
                      </Button>
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
                        onClick={() => void sendMessage(input)}
                        disabled={!active || submitting || !input.trim()}
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
        </Rnd>
      ) : null}
    </AssistantWorkflowContext.Provider>
  );
}

function AssistantWorkflowFab() {
  const context = useAssistantWorkflow();
  const { settings } = useInstanceSettings();
  if (!context.active || settings.demoMode) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-6 bottom-6 z-40">
      <Button
        type="button"
        onClick={() => context.setOpen(true)}
        className="pointer-events-auto h-14 rounded-[6px] border-2 border-black bg-[var(--color-accent)] px-4 text-[var(--color-accent-foreground)] shadow-[6px_6px_0_var(--color-border)] transition-[transform,color] hover:-translate-y-[1px] hover:text-[var(--color-primary-foreground)]"
      >
        <Wand2 className="mr-2 h-4 w-4" />
        Assitant
      </Button>
    </div>
  );
}

export function AssistantWorkflowTrigger() {
  const context = useAssistantWorkflow();
  const { settings } = useInstanceSettings();

  if (!context.active || settings.demoMode) {
    return null;
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="relative rounded-[4px] border-2 border-transparent hover:border-border"
      onClick={() => context.setOpen(true)}
    >
      <Sparkles className="h-5 w-5" />
      <span className="sr-only">Open MCP assistant</span>
    </Button>
  );
}

export function useAssistantWorkflow() {
  const value = React.useContext(AssistantWorkflowContext);

  if (!value) {
    throw new Error(
      "useAssistantWorkflow must be used within AssistantWorkflowProvider",
    );
  }

  return value;
}

export function useRegisterAssistantBridge(bridge: AssistantPageBridge | null) {
  const { registerBridge } = useAssistantWorkflow();

  React.useEffect(() => {
    registerBridge(bridge);
    return () => registerBridge(null);
  }, [bridge, registerBridge]);
}
