"use client";

import * as React from "react";
import { Eye, EyeOff, KeyRound, Plus, X } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { validateKey, type KeyValueEntry } from "@/lib/key-value";

// Re-exported so call sites can keep importing the editor and its helpers
// from one place; the logic itself lives in lib so it is testable alone.
export {
  CONFIG_KEY_PATTERN,
  entriesToRecord,
  keyValueEntriesAreValid,
  recordToEntries,
  secretEntriesToPatch,
  secretKeysToEntries,
} from "@/lib/key-value";
export type { KeyValueEntry } from "@/lib/key-value";

export interface KeyValueFieldProps {
  entries: KeyValueEntry[];
  onChange: (entries: KeyValueEntry[]) => void;
  /** Masks values and shows a reveal toggle. */
  secret?: boolean;
  disabled?: boolean;
  label: string;
  description?: string;
  /** Shown when there are no entries yet. */
  emptyHint?: string;
  addLabel: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  testId?: string;
}

export function KeyValueField({
  entries,
  onChange,
  secret = false,
  disabled = false,
  label,
  description,
  emptyHint,
  addLabel,
  keyPlaceholder = "api_base",
  valuePlaceholder,
  testId = "key-value",
}: KeyValueFieldProps) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = React.useState<Set<number>>(new Set());

  const keys = entries.map((entry) => entry.key);

  const update = (index: number, patch: Partial<KeyValueEntry>) => {
    const next = entries.map((entry, position) =>
      position === index ? { ...entry, ...patch } : entry,
    );
    onChange(next);
  };

  const remove = (index: number) => {
    onChange(entries.filter((_, position) => position !== index));
    setRevealed((current) => {
      const next = new Set(current);
      next.delete(index);
      return next;
    });
  };

  const toggleReveal = (index: number) => {
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const keyError = (index: number): string | null => {
    const problem = validateKey(entries[index]!.key, keys);
    if (!problem) return null;
    if (problem === "duplicate") return t("notebook.config.duplicateKey");
    if (problem === "empty") return t("notebook.config.emptyKey");
    return t("notebook.config.invalidKey");
  };

  return (
    <div className="space-y-3" data-testid={testId}>
      <div>
        <h4 className="flex items-center gap-2 text-sm font-semibold capitalize">
          {secret && <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />}
          {label}
        </h4>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        )}
      </div>

      {entries.length === 0 && emptyHint && (
        <p className="text-sm text-muted-foreground">{emptyHint}</p>
      )}

      <div className="space-y-2">
        {entries.map((entry, index) => {
          const error = keyError(index);
          const isRevealed = revealed.has(index);
          return (
            <div key={index} className="space-y-1">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <Input
                    value={entry.key}
                    onChange={(event) =>
                      update(index, { key: event.target.value })
                    }
                    placeholder={keyPlaceholder}
                    disabled={disabled}
                    autoComplete="off"
                    spellCheck={false}
                    className={cn(
                      "font-mono text-sm",
                      error && "border-destructive",
                    )}
                    aria-invalid={error ? true : undefined}
                    data-testid={`${testId}-key-${index}`}
                  />
                </div>
                <div className="flex flex-[2] items-center gap-1">
                  <Input
                    value={entry.value}
                    onChange={(event) =>
                      update(index, {
                        value: event.target.value,
                        existing: false,
                      })
                    }
                    // A stored secret is never sent to the browser, so the field
                    // shows that one is set rather than pretending to hold it.
                    placeholder={
                      entry.existing
                        ? t("notebook.config.secretUnchanged")
                        : (valuePlaceholder ?? "")
                    }
                    type={secret && !isRevealed ? "password" : "text"}
                    disabled={disabled}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono text-sm"
                    data-testid={`${testId}-value-${index}`}
                  />
                  {secret && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleReveal(index)}
                      disabled={disabled || entry.existing}
                      aria-label={
                        isRevealed
                          ? t("notebook.config.hideValue")
                          : t("notebook.config.showValue")
                      }
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
                    aria-label={t("common.remove")}
                    data-testid={`${testId}-remove-${index}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {error && (
                <p className="text-xs font-medium text-destructive">{error}</p>
              )}
            </div>
          );
        })}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...entries, { key: "", value: "" }])}
        disabled={disabled}
        data-testid={`${testId}-add`}
      >
        <Plus className="mr-2 h-4 w-4" />
        {addLabel}
      </Button>
    </div>
  );
}
