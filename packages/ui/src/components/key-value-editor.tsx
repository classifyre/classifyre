"use client";

import * as React from "react";
import { Eye, EyeOff, Plus, X } from "lucide-react";
import { Button } from "./button";
import { Input } from "./input";
import { cn } from "../lib/utils";

export interface KeyValuePair {
  key: string;
  value: string;
}

export interface KeyValueEditorLabels {
  add: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  invalidKey: string;
  duplicateKey: string;
  empty: string;
}

export interface KeyValueEditorProps {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  labels: KeyValueEditorLabels;
  /** Keys must match this to be committed. */
  keyPattern?: RegExp;
  /** Render values as password inputs with a per-row reveal toggle. */
  masked?: boolean;
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
}

const DEFAULT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * Editor for a flat string map.
 *
 * Rows are held in local state rather than derived from `value` on each render,
 * for two reasons that both surface immediately otherwise: a row whose key is
 * still being typed has no place in the map yet, and two rows may transiently
 * share a key while one is being renamed. The rows are the editing surface; the
 * map is what gets committed once a row is valid.
 */
export function KeyValueEditor({
  value,
  onChange,
  labels,
  keyPattern = DEFAULT_KEY_PATTERN,
  masked = false,
  disabled = false,
  className,
  "data-testid": testId,
}: KeyValueEditorProps) {
  const toRows = (map: Record<string, string>): KeyValuePair[] =>
    Object.entries(map ?? {}).map(([key, entryValue]) => ({
      key,
      value: String(entryValue ?? ""),
    }));

  const [rows, setRows] = React.useState<KeyValuePair[]>(() => toRows(value));
  const [revealed, setRevealed] = React.useState<Set<number>>(new Set());

  // Re-seed only when the incoming map is a genuinely different set of keys
  // from what we committed. Without this guard every commit echoes back and
  // clobbers the row the user is still typing in.
  const committedKeys = React.useRef(
    Object.keys(value ?? {})
      .sort()
      .join(" "),
  );
  React.useEffect(() => {
    const incoming = Object.keys(value ?? {})
      .sort()
      .join(" ");
    if (incoming !== committedKeys.current) {
      committedKeys.current = incoming;
      setRows(toRows(value));
    }
  }, [value]);

  const errorFor = (row: KeyValuePair, index: number): string | null => {
    if (!row.key) return null;
    if (!keyPattern.test(row.key)) return labels.invalidKey;
    if (rows.findIndex((other) => other.key === row.key) !== index) {
      return labels.duplicateKey;
    }
    return null;
  };

  const commit = (next: KeyValuePair[]) => {
    setRows(next);
    const map: Record<string, string> = {};
    next.forEach((row, index) => {
      if (!row.key || !keyPattern.test(row.key)) return;
      if (next.findIndex((other) => other.key === row.key) !== index) return;
      map[row.key] = row.value;
    });
    committedKeys.current = Object.keys(map).sort().join(" ");
    onChange(map);
  };

  const update = (index: number, patch: Partial<KeyValuePair>) => {
    commit(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const remove = (index: number) => {
    setRevealed((current) => {
      const next = new Set<number>();
      current.forEach((i) => {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      });
      return next;
    });
    commit(rows.filter((_, i) => i !== index));
  };

  const toggleReveal = (index: number) => {
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div className={cn("space-y-2", className)} data-testid={testId}>
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">{labels.empty}</p>
      )}

      {rows.map((row, index) => {
        const error = errorFor(row, index);
        const isRevealed = revealed.has(index);
        return (
          <div key={index} className="space-y-1">
            <div className="flex gap-2">
              <Input
                value={row.key}
                onChange={(event) => update(index, { key: event.target.value })}
                placeholder={labels.keyPlaceholder}
                disabled={disabled}
                autoComplete="off"
                spellCheck={false}
                className={cn("font-mono", error && "border-destructive")}
                aria-invalid={error ? true : undefined}
                data-testid={testId ? `${testId}-key-${index}` : undefined}
              />
              <Input
                value={row.value}
                onChange={(event) =>
                  update(index, { value: event.target.value })
                }
                placeholder={labels.valuePlaceholder}
                disabled={disabled}
                autoComplete="off"
                spellCheck={false}
                type={masked && !isRevealed ? "password" : "text"}
                data-testid={testId ? `${testId}-value-${index}` : undefined}
              />
              {masked && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  onClick={() => toggleReveal(index)}
                  aria-label={isRevealed ? "Hide value" : "Show value"}
                >
                  {isRevealed ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(index)}
                disabled={disabled}
                aria-label="Remove"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {error && (
              <p className="text-xs font-medium text-destructive">{error}</p>
            )}
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setRows([...rows, { key: "", value: "" }])}
        data-testid={testId ? `${testId}-add` : undefined}
      >
        <Plus className="mr-2 h-4 w-4" />
        {labels.add}
      </Button>
    </div>
  );
}
