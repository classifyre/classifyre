"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "../lib/utils";
import { Badge } from "./badge";
import { Button } from "./button";

/**
 * Renders an arbitrary JSON value for reading, not for editing.
 *
 * Metadata coming off a connector is whatever the upstream system had: a
 * string here, a list of addresses there, a nested object of parser
 * diagnostics somewhere else. `String(value)` turns half of that into
 * `[object Object]`, and `JSON.stringify` turns the other half into an
 * unreadable one-liner. This walks the value instead:
 *
 * - primitives render as themselves,
 * - a flat array renders as chips (the long tail folded behind "+N"),
 * - objects and arrays of objects render as an indented key/value tree.
 *
 * Everything is expanded: metadata is read, not navigated, so a disclosure
 * triangle only adds a click between the user and the value. Nesting is shown
 * with an indent rule rather than with braces.
 *
 * Colours come from the theme tokens only — `border`, `muted`,
 * `muted-foreground` — so the tree flips with the rest of the page.
 */

type JsonValueProps = {
  value: unknown;
  /** Primitive array entries shown before folding the rest behind "+N". */
  maxInlineItems?: number;
  /** Show a copy-JSON button on the root when it is an object or array. */
  copyable?: boolean;
  className?: string;
};

/** The indent rule that stands in for nesting braces. */
const NEST = "border-l border-border/20 pl-3";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

/** True when an array holds only primitives, so it can render as chips. */
function isFlatArray(value: unknown[]): boolean {
  return value.every((entry) => entry === null || typeof entry !== "object");
}

function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function JsonValue({
  value,
  maxInlineItems = 12,
  copyable = false,
  className,
}: JsonValueProps) {
  const complex =
    isPlainObject(value) || (Array.isArray(value) && value.length > 0);

  return (
    <div className={cn("min-w-0 text-sm", className)}>
      {copyable && complex && (
        <div className="mb-1 flex justify-end">
          <CopyJsonButton value={value} />
        </div>
      )}
      <JsonNode value={value} maxInlineItems={maxInlineItems} />
    </div>
  );
}

function JsonNode({
  value,
  maxInlineItems,
}: {
  value: unknown;
  maxInlineItems: number;
}) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground">—</span>;
    }
    if (isFlatArray(value)) {
      return <ChipList items={value} maxInlineItems={maxInlineItems} />;
    }
    return (
      <div className={cn("min-w-0 space-y-2", NEST)}>
        {value.map((entry, index) => (
          <div key={index} className="min-w-0 space-y-0.5">
            <div className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              {index + 1} / {value.length}
            </div>
            <JsonNode value={entry} maxInlineItems={maxInlineItems} />
          </div>
        ))}
      </div>
    );
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return <span className="text-muted-foreground">—</span>;
    }
    return (
      <dl className={cn("min-w-0 space-y-1", NEST)}>
        {entries.map(([key, entry]) => (
          <div
            key={key}
            className="grid min-w-0 gap-x-3 gap-y-0.5 sm:grid-cols-[minmax(0,160px)_minmax(0,1fr)]"
          >
            <dt
              className="truncate pt-0.5 text-xs font-medium text-muted-foreground"
              title={key}
            >
              {humanizeKey(key)}
            </dt>
            <dd className="min-w-0 break-words">
              <JsonNode value={entry} maxInlineItems={maxInlineItems} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return <Primitive value={value} />;
}

function Primitive({ value }: { value: unknown }) {
  if (typeof value === "boolean") {
    return (
      <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
        {value ? "yes" : "no"}
      </span>
    );
  }
  if (typeof value === "number") {
    return <span className="tabular-nums">{value.toLocaleString()}</span>;
  }
  if (value instanceof Date) {
    return <span className="tabular-nums">{value.toISOString()}</span>;
  }

  const text = String(value);
  if (/^https?:\/\//i.test(text)) {
    return (
      <a
        href={text}
        target="_blank"
        rel="noreferrer noopener"
        className="break-all font-mono text-xs underline-offset-4 hover:underline"
      >
        {text}
      </a>
    );
  }
  return <span className="break-words">{text}</span>;
}

function ChipList({
  items,
  maxInlineItems,
}: {
  items: unknown[];
  maxInlineItems: number;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const overflow = items.length - maxInlineItems;
  const visible = expanded ? items : items.slice(0, maxInlineItems);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((item, index) => (
        <Badge
          key={index}
          variant="outline"
          className="border border-border/30 bg-muted/50 px-1.5 font-mono break-all whitespace-normal"
        >
          {item === null ? "null" : String(item)}
        </Badge>
      ))}
      {overflow > 0 && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs text-muted-foreground"
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? "show less" : `+${overflow} more`}
        </Button>
      )}
    </div>
  );
}

function CopyJsonButton({ value }: { value: unknown }) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-auto px-1.5 py-0.5 text-xs text-muted-foreground"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(JSON.stringify(value, null, 2))
          .then(() => setCopied(true))
          .catch(() => undefined);
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? "copied" : "copy JSON"}
    </Button>
  );
}
