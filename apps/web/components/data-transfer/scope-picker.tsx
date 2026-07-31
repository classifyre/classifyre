"use client";

import * as React from "react";
import { Checkbox } from "@workspace/ui/components";
import { Lock, TriangleAlert } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";

import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import {
  formatRows,
  type TransferScope,
  type TransferScopeId,
} from "@/lib/data-transfer-api";

export interface ScopeRow {
  id: TransferScopeId;
  label: string;
  description: string;
  dependsOn: TransferScopeId[];
  heavy: boolean;
  redactsSecrets: boolean;
  /** Rows available for this scope; null when the count is unknown. */
  rows: number | null;
  /** Present in the source (namespace or archive) at all. */
  available: boolean;
}

export function scopeRowsFromCatalogue(
  catalogue: TransferScope[],
): ScopeRow[] {
  return catalogue.map((scope) => ({
    ...scope,
    rows: scope.rows,
    available: true,
  }));
}

/**
 * The selection list shared by export and import.
 *
 * Deliberately a ruled ledger rather than a grid of cards: the operator is
 * deciding what goes on a manifest, and a right-aligned column of row counts
 * makes the weight of each choice — 12 sources against 4.3 million findings —
 * legible at a glance in a way that cards never manage.
 */
export function ScopePicker({
  scopes,
  selected,
  onChange,
  disabled,
  emptyLabel,
}: {
  scopes: ScopeRow[];
  selected: Set<TransferScopeId>;
  onChange: (next: Set<TransferScopeId>) => void;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  const { t } = useTranslation();

  // `translate` echoes an unknown key back, so a scope the API grew before the
  // locale files caught up falls back to the English label the API supplies.
  const tOr = (key: TranslationKey, fallback: string) => {
    const value = t(key);
    return value === (key as string) ? fallback : value;
  };

  const selectable = scopes.filter((scope) => scope.available);
  const allSelected =
    selectable.length > 0 && selectable.every((s) => selected.has(s.id));

  const toggle = (id: TransferScopeId) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const toggleAll = () => {
    onChange(allSelected ? new Set() : new Set(selectable.map((s) => s.id)));
  };

  const totalRows = scopes
    .filter((scope) => selected.has(scope.id))
    .reduce((sum, scope) => sum + (scope.rows ?? 0), 0);

  if (selectable.length === 0) {
    return (
      <p className="rounded-[4px] border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
        {emptyLabel ?? t("dataTransfer.noScopes")}
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-[4px] border-2 border-border">
      <div className="flex items-center justify-between gap-3 border-b-2 border-border bg-muted/40 px-3 py-2">
        <button
          type="button"
          onClick={toggleAll}
          disabled={disabled}
          className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          {allSelected
            ? t("dataTransfer.selectNone")
            : t("dataTransfer.selectAll")}
        </button>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {t("dataTransfer.rowsSelected", {
            count: formatRows(totalRows),
            scopes: selected.size,
          })}
        </span>
      </div>

      <ul className="divide-y divide-border">
        {scopes.map((scope) => {
          const isSelected = selected.has(scope.id);
          const missing = scope.dependsOn.filter(
            (dep) =>
              !selected.has(dep) &&
              scopes.some((s) => s.id === dep && s.available),
          );

          return (
            <li
              key={scope.id}
              className={cn(
                "relative transition-colors",
                scope.available
                  ? "hover:bg-muted/30"
                  : "cursor-not-allowed opacity-40",
                // A marked line in the ledger, rather than a filled row.
                isSelected &&
                  "bg-muted/20 shadow-[inset_3px_0_0_var(--color-primary)]",
              )}
            >
              <label
                className={cn(
                  "flex items-start gap-3 px-3 py-2.5",
                  scope.available && !disabled
                    ? "cursor-pointer"
                    : "cursor-not-allowed",
                )}
              >
                <Checkbox
                  checked={isSelected}
                  disabled={disabled || !scope.available}
                  onCheckedChange={() => toggle(scope.id)}
                  className="mt-0.5 rounded-[2px]"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">
                      {tOr(scopeLabelKey(scope.id), scope.label)}
                    </span>

                    {scope.redactsSecrets ? (
                      <span
                        title={t("dataTransfer.secretsStrippedHint")}
                        className="inline-flex items-center gap-1 rounded-[2px] border border-border px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground"
                      >
                        <Lock className="h-2.5 w-2.5" />
                        {t("dataTransfer.noSecretsChip")}
                      </span>
                    ) : null}

                    {scope.heavy ? (
                      <span className="rounded-[2px] border border-amber-500/40 px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.1em] text-amber-600 dark:text-amber-500">
                        {t("dataTransfer.heavyChip")}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {tOr(scopeDescriptionKey(scope.id), scope.description)}
                  </p>

                  {isSelected && missing.length > 0 ? (
                    <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-500">
                      <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
                      {t("dataTransfer.dependencyWarning", {
                        scopes: missing
                          .map((dep) =>
                            tOr(
                              scopeLabelKey(dep),
                              scopes.find((s) => s.id === dep)?.label ?? dep,
                            ),
                          )
                          .join(", "),
                      })}
                    </p>
                  ) : null}
                </div>

                <span className="shrink-0 pt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
                  {scope.rows === null ? "—" : formatRows(scope.rows)}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function scopeLabelKey(id: TransferScopeId): TranslationKey {
  return `dataTransfer.scopes.${id}.label` as TranslationKey;
}

function scopeDescriptionKey(id: TransferScopeId): TranslationKey {
  return `dataTransfer.scopes.${id}.description` as TranslationKey;
}
