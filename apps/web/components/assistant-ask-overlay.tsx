"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import { Sparkles } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from "@workspace/ui/components/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@workspace/ui/components/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";
import { useAssistantModel } from "@/components/assistant-model-provider";
import { useTranslation } from "@/hooks/use-translation";

export type AssistantOverlayProps = {
  title: string;
  summary?: string;
  promptContext: string;
  buttonLabel?: string;
  buttonClassName?: string;
  buttonContent?: React.ReactNode;
  buttonAriaLabel?: string;
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
  buttonSize?: React.ComponentProps<typeof Button>["size"];
  contentSide?: "top" | "right" | "bottom" | "left";
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

function chunkResponse(text: string) {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let current = "";
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > 48) {
      chunks.push(current);
      current = word;
    } else {
      current = next;
    }
  });
  if (current) chunks.push(current);
  return chunks;
}

export function AssistantAskOverlay({
  title,
  summary,
  promptContext,
  buttonLabel = "Ask AI",
  buttonClassName,
  buttonContent,
  buttonAriaLabel,
  buttonVariant = "outline",
  buttonSize = "sm",
  contentSide = "top",
}: AssistantOverlayProps) {
  const { generateText } = useAssistantModel();
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState("");
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [pending, setPending] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement | null>(null);
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setMessages([]);
    setInput("");
  }, [open, title]);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(max-width: 640px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const handleAsk = async (value?: string) => {
    const trimmed = (value ?? input).trim();
    if (!trimmed) return;
    setPending(true);
    setInput("");

    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: "user",
      content: trimmed,
    };
    const assistantId = `${Date.now()}-assistant`;
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);

    try {
      const history = [...messages, userMessage];
      const answer = await generateText([
        {
          role: "system",
          content: `${promptContext}\nAnswer concisely with actionable guidance.`,
        },
        ...history.map((m) => ({ role: m.role, content: m.content })),
      ]);

      const chunks = chunkResponse(answer.trim());
      if (chunks.length === 0) {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId ? { ...message, content: "" } : message,
          ),
        );
        setPending(false);
        return;
      }
      let index = 0;

      const interval = window.setInterval(() => {
        index += 1;
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? { ...message, content: chunks.slice(0, index).join(" ") }
              : message,
          ),
        );
        if (index >= chunks.length) {
          window.clearInterval(interval);
          setPending(false);
        }
      }, 35);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to generate response.";
      setMessages((prev) =>
        prev.map((item) =>
          item.id === assistantId
            ? { ...item, content: `Error: ${message}` }
            : item,
        ),
      );
      setPending(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleAsk();
    }
  };

  const chatBody = (
    <>
      {messages.length > 0 && (
        <ScrollArea className="h-56 rounded-sm border bg-muted/30 p-3">
          <div className="flex flex-col gap-2">
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
                    "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-xs overflow-x-auto",
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background border",
                  )}
                >
                  {message.role === "assistant" ? (
                    <ReactMarkdown>
                      {message.content || (pending ? "..." : "")}
                    </ReactMarkdown>
                  ) : (
                    message.content
                  )}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </ScrollArea>
      )}

      <div className="space-y-2">
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("ai.ask")}
          className="min-h-[80px]"
        />
        <Button
          onClick={() => handleAsk()}
          disabled={!input.trim() || pending}
          className="w-full"
        >
          {pending ? (
            <Spinner size="sm" label={t("ai.thinking")} />
          ) : (
            t("common.send")
          )}
        </Button>
      </div>
    </>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant={buttonVariant}
                size={buttonSize}
                className={cn("gap-2", buttonClassName)}
                aria-label={buttonAriaLabel ?? buttonLabel}
              >
                {buttonContent ?? buttonLabel}
              </Button>
            </PopoverTrigger>
            {!isMobile && (
              <PopoverContent
                align="end"
                side={contentSide}
                className="w-[360px] space-y-4"
              >
                <PopoverHeader>
                  <PopoverTitle className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    {title}
                  </PopoverTitle>
                  {summary && (
                    <PopoverDescription>{summary}</PopoverDescription>
                  )}
                </PopoverHeader>
                {chatBody}
              </PopoverContent>
            )}
          </Popover>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          Ask the AI assistant
        </TooltipContent>
      </Tooltip>

      {isMobile && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] sm:h-auto sm:max-w-lg">
            <DialogHeader className="gap-1">
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                {title}
              </DialogTitle>
              {summary && <DialogDescription>{summary}</DialogDescription>}
            </DialogHeader>

            {chatBody}
            <DialogClose asChild>
              <Button variant="outline" size="sm" className="w-full">
                Hide assistant
              </Button>
            </DialogClose>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
