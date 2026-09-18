"use client";

import * as React from "react";

import { Button } from "./button";
import { cn } from "../lib/utils";
import {
  dockerImageTag,
  dockerRunLines,
  type RunLine,
} from "./docker-run-data";

/**
 * The `docker run` line that starts Classifyre, with a copy button.
 *
 * This replaced a platform-detecting download grid, and the difference is the
 * point: there is one artifact now, identical on every operating system, so
 * there is nothing to detect and nothing to choose. Shared by the marketing
 * site's landing page and /get, and by the docs site's install pages, so all
 * three quote the same command.
 *
 * Pinned to `softwareVersion` — the same value the Helm install command uses,
 * read from the workspace package.json, which the release workflow stamps
 * before it builds these sites. So the tag a visitor copies is the release
 * that was current when the page was published, not a moving `latest` that may
 * have shifted under them.
 *
 * Each line carries a short note rendered beside it rather than inline: a `#`
 * comment would be copied along with the command, and the volumes are the part
 * people delete without knowing what they cost. Without them the database, the
 * credential key and the cached Python dependencies live in the container's
 * writable layer and die with the next `docker rm` — which is exactly what an
 * upgrade does. `--shm-size` is the same kind of trap: Postgres puts
 * parallel-query buffers in /dev/shm, and Docker's 64 MB default is small
 * enough that a large query fails mid-scan.
 */
export interface DockerRunCopy {
  copy: string;
  copied: string;
  copyCommand: string;
}

const DEFAULT_COPY: DockerRunCopy = {
  copy: "Copy",
  copied: "Copied",
  copyCommand: "Copy command",
};

export function DockerRunBlock({
  tag = dockerImageTag,
  label,
  className,
  tone = "light",
  showNotes = true,
  lines: linesOverride,
  copy: copyOverride,
}: {
  /** Image tag to quote. Defaults to the version this site was built from. */
  tag?: string;
  label?: string;
  className?: string;
  /** "dark" for the black cluster card, which inverts the palette. */
  tone?: "light" | "dark";
  /** Notes need horizontal room; drop them in a narrow column. */
  showNotes?: boolean;
  /** Translated command notes; defaults to the English `dockerRunLines`. */
  lines?: RunLine[];
  /** Copy-button labels; defaults to English. */
  copy?: Partial<DockerRunCopy>;
}) {
  const [copied, setCopied] = React.useState(false);
  const lines = linesOverride ?? dockerRunLines(tag);
  const command = lines.map((line) => line.code).join("\n");
  const text = { ...DEFAULT_COPY, ...copyOverride };
  const dark = tone === "dark";

  const copy = async () => {
    try {
      // Flattened to one line: a pasted continuation backslash is the most
      // common way this command arrives broken in someone's terminal.
      await navigator.clipboard.writeText(command.replace(/ \\\n\s+/g, " "));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // A denied clipboard permission is not worth an error state: the command
      // is right there to select by hand.
    }
  };

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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void copy()}
          aria-label={copied ? text.copied : text.copyCommand}
          className={cn(
            "absolute right-1.5 top-1.5 z-10 h-7 px-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em]",
            dark
              ? "text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {copied ? text.copied : text.copy}
        </Button>

        {/* A <pre> wrapper keeps this selectable and copyable as one command
            even though each line is its own row: the notes live in a sibling
            column that selection skips, and every code cell is preformatted. */}
        <pre
          className={cn(
            "min-w-0 overflow-x-auto border-2 py-3 pl-3 pr-12 font-mono text-[11px] leading-6 sm:text-xs",
            dark
              ? "border-primary-foreground/20 bg-primary-foreground/8 text-primary-foreground/85"
              : "border-border bg-muted/40 text-foreground/85",
          )}
        >
          <code className="block">
            {lines.map((line) => (
              <span key={line.code} className="flex items-baseline gap-4">
                <span className="whitespace-pre">{line.code}</span>
                {showNotes && line.note && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "ml-auto hidden shrink-0 select-none whitespace-nowrap text-[10px] italic md:inline",
                      dark
                        ? "text-primary-foreground/40"
                        : "text-muted-foreground/70",
                    )}
                  >
                    {line.note}
                  </span>
                )}
              </span>
            ))}
          </code>
        </pre>
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
