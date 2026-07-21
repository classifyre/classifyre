"use client";

import * as React from "react";
import { Sparkles, Wand2 } from "lucide-react";
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
import { AssistantWorkflowPanel, Button } from "@workspace/ui/components";
import { toast } from "sonner";
import { usePathname, useRouter } from "next/navigation";
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

export function AssistantWorkflowProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { settings } = useInstanceSettings();
  const router = useRouter();
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
  const uploadInputRef = React.useRef<HTMLInputElement | null>(null);

  // Reset the conversation only when the assistant context actually changes
  // (e.g. navigating from source.create to detector.create). Incidental bridge
  // re-registration on the same page must NOT slam the panel closed. Pages
  // without a bridge share the "app.global" context, so the conversation
  // survives navigation between them.
  const contextKey = bridge?.contextKey ?? "app.global";
  const prevContextKeyRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (prevContextKeyRef.current === contextKey) {
      return;
    }
    prevContextKeyRef.current = contextKey;
    setMessages([]);
    setPendingConfirmation(null);
    setInput("");
    setUploadedFiles([]);
    setOpen(false);
  }, [contextKey]);

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

        // Navigation is handled centrally so it works on every page, with or
        // without a page bridge. Only app-internal paths are accepted.
        if (action.type === "navigate") {
          if (action.route.startsWith("/") && !action.route.startsWith("//")) {
            router.push(action.route);
          }
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
    [bridge, router],
  );

  // Pages without a bridge still get a context-aware assistant: read-only
  // tools plus navigation, keyed to the current route.
  const buildGlobalContext =
    React.useCallback((): AssistantPageContext => {
      return {
        key: "app.global",
        route: pathname || "/",
        title:
          typeof document !== "undefined" && document.title
            ? document.title
            : "Classifyre",
        entityId: null,
        values: {},
        schema: null,
        validation: { isValid: true, missingFields: [], errors: [] },
        metadata: {},
      };
    }, [pathname]);

  const sendMessage = React.useCallback(
    async (
      content: string,
      confirmationDecision?: "confirm" | "cancel" | null,
    ) => {
      if (bridge && !bridge.canOpen) {
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
        const context = bridge
          ? await bridge.getContext()
          : buildGlobalContext();
        const response = await api.assistantRespond({
          messages: [...messages, nextUserMessage].map(
            ({ role, content: text }) => ({
              role,
              content: text,
            }),
          ),
          confirmationDecision: confirmationDecision ?? null,
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
    [
      bridge,
      buildGlobalContext,
      handleResponse,
      messages,
      pendingConfirmation,
      uploadedFiles,
    ],
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

  // Single source of truth: the assistant is active whenever AI is enabled and
  // we're not in read-only demo mode. Pages with a bridge can veto via canOpen;
  // pages without a bridge fall back to the global context.
  const active =
    (bridge ? bridge.canOpen : true) &&
    settings.aiEnabled &&
    !settings.demoMode;
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
    if (!active) {
      return null;
    }

    return assistantContexts[bridge?.contextKey ?? "app.global"];
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

  return (
    <AssistantWorkflowContext.Provider value={contextValue}>
      {children}
      <AssistantWorkflowFab />
      {active && open ? (
        // Anchored to the bottom-right; on narrow viewports it stretches to
        // fill the screen. Fixed placement (no drag/resize) means it can never
        // open off-screen.
        <div
          className="fixed inset-x-3 bottom-3 top-16 z-[60] flex flex-col sm:inset-x-auto sm:bottom-4 sm:right-4 sm:top-auto sm:h-[min(680px,calc(100dvh-6rem))] sm:w-[min(440px,calc(100vw-2rem))]"
        >
          <input
            ref={uploadInputRef}
            type="file"
            accept=".csv,.tsv,.txt,.md,.log,.json,.xlsx,text/plain,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(event) => void handleFileUpload(event)}
          />
          <AssistantWorkflowPanel
            title={contextMeta?.title ?? "Assistant"}
            messages={messages}
            pendingConfirmation={pendingConfirmation}
            onConfirm={() => void sendMessage("Confirm", "confirm")}
            onCancelConfirmation={() => {
              setPendingConfirmation(null);
              toast("Assistant action cancelled");
            }}
            input={input}
            onInputChange={setInput}
            onSend={() => void sendMessage(input)}
            canSend={active && !submitting && Boolean(input.trim())}
            disabled={!active || submitting}
            submitting={submitting}
            placeholder={
              active
                ? "Ask about your data or describe what to do — I can fill forms, run MCP tools, and navigate for you…"
                : "Assistant is unavailable for this page."
            }
            uploadedFiles={uploadedFiles.map((file, index) => ({
              id: `${file.fileName}-${index}`,
              label: `${file.fileName} · ${formatBytes(file.bytes)}`,
            }))}
            onUploadClick={() => uploadInputRef.current?.click()}
            uploadDisabled={!active || submitting || uploadingFile}
            uploadingFile={uploadingFile}
            footerNote={
              active
                ? "Patches apply locally first. MCP mutations stay behind confirmation."
                : "Enable AI in settings to activate the assistant."
            }
            onClose={() => setOpen(false)}
          />
        </div>
      ) : null}
    </AssistantWorkflowContext.Provider>
  );
}

function AssistantWorkflowFab() {
  const context = useAssistantWorkflow();
  // `context.active` already accounts for aiEnabled + demoMode.
  if (!context.active) {
    return null;
  }

  return (
    // Sticky bottom toolbars publish their height as --assistant-fab-offset
    // (see StickyActionToolbar), so the FAB rides above them instead of
    // covering Save/Test/Run — which lets it stay visible on mobile too.
    <div
      className="pointer-events-none fixed right-4 z-40 md:right-6"
      style={{
        bottom:
          "calc(1rem + env(safe-area-inset-bottom, 0px) + var(--assistant-fab-offset, 0px))",
      }}
    >
      <Button
        type="button"
        onClick={() => context.setOpen(true)}
        aria-label="Open assistant"
        className="pointer-events-auto h-12 w-12 rounded-[6px] border-2 border-border bg-[var(--color-accent)] p-0 text-[var(--color-accent-foreground)] shadow-[6px_6px_0_var(--color-border)] transition-[transform,color] hover:-translate-y-[1px] hover:text-[var(--color-primary-foreground)] md:h-14 md:w-auto md:px-4"
      >
        <Wand2 className="h-4 w-4 md:mr-2" />
        <span className="hidden md:inline">Assistant</span>
      </Button>
    </div>
  );
}

export function AssistantWorkflowTrigger() {
  const context = useAssistantWorkflow();

  // `context.active` already accounts for aiEnabled + demoMode.
  if (!context.active) {
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
