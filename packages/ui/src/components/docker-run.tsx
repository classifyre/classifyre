"use client";

import * as React from "react";

import { Button } from "./button";
import { cn } from "../lib/utils";
import { dockerImageRef } from "../lib/site-links";

/**
 * The `docker run` line that starts Classifyre, with a copy button.
 *
 * This replaced a platform-detecting download grid, and the difference is the
 * point: there is one artifact now, identical on every operating system, so
 * there is nothing to detect and nothing to choose. Shared by the marketing
 * site's landing page and /get, and by the docs site's install pages, so all
 * three quote the same command.
 *
 * The volumes are not decoration. Without them the database, the credential
 * key and the cached Python dependencies live in the container's writable
 * layer and are destroyed by the next `docker rm` — which is exactly the
 * moment someone upgrades. `--shm-size` is here for the same reason: the
 * default 64 MB is small enough that large queries fail mid-scan.
 */
export const DOCKER_RUN_LINES: readonly string[] = [
  "docker run -d --name classifyre \\",
  "  -p 3000:3000 \\",
  "  --shm-size=1g \\",
  "  -v classifyre-pgdata:/var/lib/postgresql/data \\",
  "  -v classifyre-data:/var/lib/classifyre \\",
  "  -v classifyre-uv-cache:/cache/uv \\",
  `  ${dockerImageRef}:latest`,
];

export function DockerRunBlock({
  lines = DOCKER_RUN_LINES,
  label,
  className,
  tone = "light",
}: {
  lines?: readonly string[];
  label?: string;
  className?: string;
  /** "dark" for the black cluster card, which inverts the palette. */
  tone?: "light" | "dark";
}) {
  const [copied, setCopied] = React.useState(false);
  const text = lines.join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text.replace(/ \\\n\s+/g, " "));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // A denied clipboard permission is not worth an error state: the command
      // is right there to select by hand.
    }
  };

  const dark = tone === "dark";

  return (
    <div className={cn("min-w-0", className)}>
      {label && (
        <span
          className={cn(
            "font-mono text-[10px] font-bold uppercase tracking-[0.2em]",
            dark ? "text-primary-foreground/55" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
      )}
      <div className="relative mt-2 min-w-0">
        {/* min-w-0 + the pre's own overflow-x-auto: the unbreakable image ref
            would otherwise size the whole grid track. */}
        <pre
          className={cn(
            "min-w-0 overflow-x-auto border-2 px-3 py-3 pr-12 font-mono text-[11px] leading-6 sm:text-xs",
            dark
              ? "border-primary-foreground/20 bg-primary-foreground/8 text-primary-foreground/85"
              : "border-border bg-muted/40 text-foreground/85",
          )}
        >
          <code>{text}</code>
        </pre>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void copy()}
          aria-label={copied ? "Copied" : "Copy command"}
          className={cn(
            "absolute right-1.5 top-1.5 h-7 px-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em]",
            dark && "text-primary-foreground/70 hover:text-primary-foreground",
          )}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

/** "Then open localhost:3000" — the step people forget to write down. */
export function DockerRunHint({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      Then open{" "}
      <a
        href="http://localhost:3000"
        className="font-mono underline-offset-4 hover:underline"
      >
        localhost:3000
      </a>
      . Needs Docker and 4 GB of memory. No account, no signup.
    </p>
  );
}
