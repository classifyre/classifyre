"use client";

import * as React from "react";

import { Button } from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";

function extractText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map((item) => extractText(item)).join("");
  }

  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    return extractText(props.children ?? "");
  }

  return "";
}

function useCopyFeedback(timeoutMs = 1600) {
  const [copied, setCopied] = React.useState(false);

  const markCopied = React.useCallback(() => {
    setCopied(true);
    const timeout = window.setTimeout(() => setCopied(false), timeoutMs);
    return () => window.clearTimeout(timeout);
  }, [timeoutMs]);

  return { copied, markCopied };
}

async function copyText(value: string): Promise<boolean> {
  if (!value) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function MdxCodeBlock(props: React.ComponentPropsWithoutRef<"pre">) {
  const { className, children, ...rest } = props;
  const { copied, markCopied } = useCopyFeedback();
  const content = React.useMemo(() => extractText(children), [children]);

  const handleCopy = React.useCallback(async () => {
    const didCopy = await copyText(content);
    if (didCopy) {
      markCopied();
    }
  }, [content, markCopied]);

  return (
    <div className="group my-6">
      <div className="relative">
        <Button
          type="button"
          variant="outline"
          size="icon-xs"
          onClick={() => {
            void handleCopy();
          }}
          className="absolute top-2 right-2 z-10 border-border bg-background/80 text-foreground backdrop-blur hover:bg-accent hover:text-accent-foreground"
          aria-label={copied ? "Code copied" : "Copy code block"}
          title={copied ? "Copied" : "Copy"}
        >
          {copied ? <CheckGlyph /> : <CopyGlyph />}
        </Button>

        <pre
          className={cn(
            "overflow-auto rounded-[4px] border-2 border-border bg-card p-4 font-mono text-xs leading-6 text-foreground [&_code]:block [&_code]:min-w-max [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:font-mono [&_code]:text-xs [&_code]:leading-6 [&_code]:text-foreground",
            className,
          )}
          {...rest}
        >
          {children}
        </pre>
      </div>
    </div>
  );
}

export function MdxInlineCode(props: React.ComponentPropsWithoutRef<"code">) {
  const { className, ...rest } = props;
  const hasLanguageClass =
    typeof className === "string" && className.includes("language-");

  if (hasLanguageClass) {
    return (
      <code className={cn("border-0 bg-transparent p-0", className)} {...rest}>
        {props.children}
      </code>
    );
  }

  return (
    <code
      className={cn(
        "rounded-[4px] border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[0.85em] text-foreground",
        className,
      )}
      {...rest}
    />
  );
}

function CopyGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className="size-3.5"
      aria-hidden="true"
    >
      <path
        d="M9 9h10v12H9zM5 3h10v3M5 3h9a1 1 0 011 1v2H8a1 1 0 00-1 1v11H6a1 1 0 01-1-1z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className="size-3.5"
      aria-hidden="true"
    >
      <path
        d="M20 6L9 17l-5-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
