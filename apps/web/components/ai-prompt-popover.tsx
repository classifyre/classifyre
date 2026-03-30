"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { cn } from "@workspace/ui/lib/utils";
import { aiAccentBase, aiAccentHoverYellow } from "@/lib/ai-styles";

export interface AiPromptPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  onAsk: () => void | Promise<void>;
  isThinking: boolean;
  askDisabled: boolean;
  disabled?: boolean;
  triggerTitle: string;
  title: string;
  placeholder: string;
  askLabel?: string;
  examples?: readonly string[];
  promptHint?: string;
  result?: React.ReactNode;
  error?: string | null;
  triggerClassName?: string;
  popoverClassName?: string;
}

export function AiPromptPopover({
  open,
  onOpenChange,
  prompt,
  onPromptChange,
  onAsk,
  isThinking,
  askDisabled,
  disabled = false,
  triggerTitle,
  title,
  placeholder,
  askLabel = "Ask",
  examples,
  promptHint,
  result,
  error,
  triggerClassName,
  popoverClassName,
}: AiPromptPopoverProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const handleExampleSelect = (example: string) => {
    onPromptChange(example);
    queueMicrotask(() => {
      inputRef.current?.focus();
      const nextLength = example.length;
      inputRef.current?.setSelectionRange(nextLength, nextLength);
    });
  };

  const showIdleHint = !result && !error && !isThinking && Boolean(promptHint);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          className={cn(
            "h-9 w-9 rounded-[4px] shrink-0 transition-all",
            cn(aiAccentBase, aiAccentHoverYellow),
            triggerClassName,
          )}
          title={triggerTitle}
        >
          {isThinking ? (
            <svg
              className="animate-spin h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z"
              />
            </svg>
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className={cn(
          "w-80 space-y-2 rounded-[6px] border-2 border-border bg-popover p-3 shadow-[4px_4px_0_var(--color-border)]",
          popoverClassName,
        )}
      >
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-accent fill-accent" />
          <span className="text-[10px] font-mono font-semibold uppercase tracking-[0.14em] text-foreground">
            {title}
          </span>
        </div>

        <div className="flex gap-2">
          <Input
            ref={inputRef}
            autoFocus
            placeholder={placeholder}
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void onAsk();
              }
            }}
            disabled={isThinking}
            className="h-8 rounded-[4px] border-2 border-border/30 bg-background font-mono text-xs focus:border-border"
          />
          <Button
            type="button"
            size="sm"
            onClick={() => void onAsk()}
            disabled={askDisabled}
            className={cn(
              "h-8 shrink-0 rounded-[4px] border-2 border-border px-3 font-mono text-xs font-semibold transition-colors",
              isThinking
                ? "cursor-not-allowed border-border/30 bg-foreground/10 text-foreground/40"
                : "bg-foreground text-primary-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {isThinking ? (
              <svg
                className="animate-spin h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8H4z"
                />
              </svg>
            ) : (
              askLabel
            )}
          </Button>
        </div>

        {examples && examples.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {examples.map((example) => {
              const selected = prompt.trim() === example;
              return (
                <Button
                  key={example}
                  type="button"
                  size="sm"
                  variant="outline"
                  className={cn(
                    "h-auto max-w-full rounded-[4px] border-2 border-border px-2 py-1 text-left font-mono text-[10px] whitespace-normal",
                    selected && "bg-accent/20",
                  )}
                  onClick={() => handleExampleSelect(example)}
                >
                  {example}
                </Button>
              );
            })}
          </div>
        )}

        {result}

        {error && (
          <p className="text-[10px] font-mono leading-snug text-destructive">
            {error}
          </p>
        )}

        {showIdleHint && (
          <p className="text-[10px] font-mono text-muted-foreground">
            {promptHint}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
