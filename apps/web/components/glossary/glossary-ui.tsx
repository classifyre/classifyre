"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, Search } from "lucide-react";
import { Badge, Input, ToneBadge } from "@workspace/ui/components";
import type { StatusTone } from "@workspace/ui/lib/status-tone";
import { cn } from "@workspace/ui/lib/utils";
import { useNsPath } from "@/lib/ns-path";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import {
  lookupTerms,
  type LinkMethod,
  type LookupHit,
  type SchemeRef,
  type TermKind,
  type TermStatus,
} from "@/lib/semantic-api";

/** Small uppercase label used above fields and table headers. */
export const MICRO_LABEL =
  "font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground";

const STATUS_TONES: Record<TermStatus, StatusTone> = {
  APPROVED: "active",
  DRAFT: "changed",
  DEPRECATED: "archived",
};

export function TermStatusBadge({ status }: { status: TermStatus }) {
  const { t } = useTranslation();
  return (
    <ToneBadge tone={STATUS_TONES[status] ?? "idle"}>
      {t(`glossary.statuses.${status}` as TranslationKey)}
    </ToneBadge>
  );
}

export function TermKindBadge({ kind }: { kind: TermKind }) {
  const { t } = useTranslation();
  return (
    <Badge
      variant="outline"
      className="rounded-[4px] font-mono text-[10px] uppercase tracking-[0.08em]"
    >
      {t(`glossary.kinds.${kind}` as TranslationKey)}
    </Badge>
  );
}

export function SchemeChip({
  scheme,
  className,
}: {
  scheme: Pick<SchemeRef, "name" | "color"> | null | undefined;
  className?: string;
}) {
  if (!scheme) return null;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 truncate text-xs text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full border border-border"
        style={{ backgroundColor: scheme.color ?? "transparent" }}
      />
      <span className="truncate">{scheme.name}</span>
    </span>
  );
}

const METHOD_TONES: Record<LinkMethod | "BROADER", StatusTone> = {
  BINDING: "active",
  DECLARED: "fresh",
  MANUAL: "neutral",
  SUGGESTED: "changed",
  MENTION: "idle",
  BROADER: "archived",
};

export function MethodBadge({ method }: { method: LinkMethod | "BROADER" }) {
  const { t } = useTranslation();
  return (
    <ToneBadge tone={METHOD_TONES[method] ?? "idle"}>
      {t(`glossary.methods.${method}` as TranslationKey)}
    </ToneBadge>
  );
}

/** `/glossary/terms/<key>`, namespace- and locale-prefixed. */
export function useTermHref(): (key: string) => string {
  const nsPath = useNsPath();
  return React.useCallback(
    (key: string) => nsPath(`/glossary/terms/${encodeURIComponent(key)}`),
    [nsPath],
  );
}

export function TermLink({
  termKey,
  children,
  className,
}: {
  termKey: string;
  children: React.ReactNode;
  className?: string;
}) {
  const href = useTermHref();
  return (
    <Link
      href={href(termKey)}
      className={cn(
        "font-semibold underline-offset-2 hover:underline",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/**
 * Pick a term by typing: the glossary lookup (exact, code, alias, prefix,
 * semantic), ranked by the API. Renders its results inline so it works inside
 * dialogs without a nested popover.
 */
export function TermPicker({
  value,
  onChange,
  kind,
  placeholder,
  autoFocus,
}: {
  value: LookupHit | null;
  onChange: (term: LookupHit | null) => void;
  kind?: TermKind;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<LookupHit[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    const text = query.trim();
    if (!text) {
      setHits([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      lookupTerms(text, { kind, limit: 8 })
        .then((result) => {
          if (active) setHits(result);
        })
        .catch(() => {
          if (active) setHits([]);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, kind]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-[4px] border-2 border-border px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{value.term}</div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <span>{value.key}</span>
            <SchemeChip scheme={value.scheme} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <TermStatusBadge status={value.status} />
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => onChange(null)}
          >
            {t("glossary.picker.change")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          autoFocus={autoFocus}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder ?? t("glossary.picker.placeholder")}
          className="h-9 rounded-[4px] border-2 border-border pl-9"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
      {hits.length > 0 && (
        <ul
          role="listbox"
          className="max-h-56 overflow-auto rounded-[4px] border-2 border-border bg-background"
        >
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onChange(hit);
                  setQuery("");
                  setHits([]);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-accent/10 focus:bg-accent/10 focus:outline-none"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">{hit.term}</span>
                  <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                    {hit.key}
                    <SchemeChip scheme={hit.scheme} />
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <TermKindBadge kind={hit.kind} />
                  <TermStatusBadge status={hit.status} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim() && !loading && hits.length === 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          {t("glossary.picker.noMatch")}
        </p>
      )}
    </div>
  );
}

/** "a, b, c" → unique trimmed values. */
export function splitList(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}
