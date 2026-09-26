"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Copy, Link2, Orbit, Workflow } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import type { TranslationKey } from "@/i18n";
import { useTranslation } from "@/hooks/use-translation";
import { TRACE_KIND_STROKE, TRACE_KINDS, type TraceDirection, type TraceKind } from "../store/trace";

/**
 * How far to reach, as a ladder of stops rather than a select: the track
 * fills up to the chosen stop, so "further" reads as "more line".
 */
export function HopLadder<V extends string | number>({
  value,
  options,
  onChange,
  label,
  disabled = false,
}: {
  value: V;
  options: Array<{ value: V; label: string }>;
  onChange: (value: V) => void;
  label: string;
  disabled?: boolean;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const fill = options.length > 1 ? (index / (options.length - 1)) * 100 : 0;
  return (
    <div role="radiogroup" aria-label={label} className={cn("relative px-2 pt-1", disabled && "opacity-50")}>
      {/* The track, behind the stops, filled up to the chosen one. */}
      <div className="absolute top-[11px] right-4 left-4 h-0.5 bg-border" aria-hidden>
        <div className="h-full bg-foreground transition-[width] duration-200" style={{ width: `${fill}%` }} />
      </div>
      <div className="relative flex justify-between">
        {options.map((o, i) => {
          const active = i === index;
          const passed = i < index;
          return (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(o.value)}
              className="group flex w-9 flex-col items-center gap-1.5 disabled:cursor-default"
              data-testid={`hop-${o.value}`}
            >
              <span
                className={cn(
                  "size-3.5 rounded-full border-2 transition-colors",
                  active
                    ? "border-foreground bg-foreground ring-2 ring-[var(--cb-evidence)] ring-offset-2 ring-offset-popover"
                    : passed
                      ? "border-foreground bg-foreground"
                      : "border-border bg-popover group-enabled:group-hover:border-foreground/60",
                )}
                aria-hidden
              />
              <span
                className={cn(
                  "font-mono text-[10px] leading-none tracking-[0.06em] uppercase",
                  active ? "font-bold text-foreground" : "text-muted-foreground",
                )}
              >
                {o.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const KIND_META: Record<TraceKind, { icon: React.ElementType; label: TranslationKey; hint: TranslationKey }> = {
  lineage: { icon: Workflow, label: "caseBoard.connections.kinds.lineage", hint: "caseBoard.connections.kindHints.lineage" },
  links: { icon: Link2, label: "caseBoard.connections.kinds.links", hint: "caseBoard.connections.kindHints.links" },
  duplicates: { icon: Copy, label: "caseBoard.connections.kinds.duplicates", hint: "caseBoard.connections.kindHints.duplicates" },
  similar: { icon: Orbit, label: "caseBoard.connections.kinds.similar", hint: "caseBoard.connections.kindHints.similar" },
};

/** The kinds of relation to follow, as toggles that carry the line each kind is drawn with. */
export function KindChips({
  value,
  onToggle,
}: {
  value: ReadonlySet<TraceKind>;
  onToggle: (kind: TraceKind) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {TRACE_KINDS.map((kind) => {
        const on = value.has(kind);
        const meta = KIND_META[kind];
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(kind)}
            title={t(meta.hint)}
            data-testid={`kind-${kind}`}
            className={cn(
              "flex items-center gap-2 rounded-[4px] border-2 px-2 py-1.5 text-left text-xs transition-colors",
              on ? "border-foreground bg-card text-foreground" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <meta.icon className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t(meta.label)}</span>
            <svg width="18" height="6" className="shrink-0" aria-hidden>
              <line
                x1="1"
                y1="3"
                x2="17"
                y2="3"
                stroke={on ? TRACE_KIND_STROKE[kind] : "var(--border)"}
                strokeWidth="2"
                strokeDasharray={kind === "duplicates" ? "4 3" : kind === "similar" ? "1 3" : undefined}
                strokeLinecap="round"
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
}

/** Upstream, both ways, or downstream. */
export function DirectionSwitch({ value, onChange }: { value: TraceDirection; onChange: (value: TraceDirection) => void }) {
  const { t } = useTranslation();
  const options: Array<{ value: TraceDirection; icon: React.ElementType; label: TranslationKey }> = [
    { value: "up", icon: ArrowUp, label: "caseBoard.connections.upstream" },
    { value: "both", icon: ArrowUpDown, label: "caseBoard.connections.both" },
    { value: "down", icon: ArrowDown, label: "caseBoard.connections.downstream" },
  ];
  return (
    <div className="grid grid-cols-3 gap-1 rounded-[4px] border-2 border-border p-1" role="radiogroup" aria-label={t("caseBoard.connections.direction")}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          data-testid={`direction-${o.value}`}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-[3px] px-2 py-1.5 text-xs font-medium transition-colors",
            value === o.value ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <o.icon className="size-3.5" aria-hidden />
          {t(o.label)}
        </button>
      ))}
    </div>
  );
}
