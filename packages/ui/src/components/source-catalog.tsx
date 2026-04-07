"use client";

import * as React from "react";
import { Search, Sparkles } from "lucide-react";
import { Badge } from "./badge";
import { Button } from "./button";
import { Input } from "./input";
import { SourceIcon } from "./source-icon";
import { cn } from "@workspace/ui/lib/utils";
import {
  SOURCE_CATEGORY_META,
  SOURCE_CATEGORY_ORDER,
  type SourceCatalogEntry,
} from "@workspace/ui/lib/source-catalog";

type SourceCatalogProps = {
  entries: SourceCatalogEntry[];
  onSelect?: (type: string) => void;
  actionLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
};

function toGroupedEntries(entries: SourceCatalogEntry[]) {
  const grouped = SOURCE_CATEGORY_ORDER.map((category) => {
    const items = entries.filter((entry) => entry.category === category);
    return [category, items] as const;
  });

  return grouped.filter(([, items]) => items.length > 0);
}

export function SourceCatalog({
  entries,
  onSelect,
  actionLabel = "Open",
  emptyTitle = "No sources found",
  emptyDescription = "Try a different keyword like SQL, BI, web, or chat.",
}: SourceCatalogProps) {
  const [searchQuery, setSearchQuery] = React.useState("");
  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredEntries = React.useMemo(() => {
    if (!normalizedSearch) {
      return entries;
    }

    return entries.filter((entry) => {
      const categoryMeta = SOURCE_CATEGORY_META[entry.category];
      const searchable = [
        entry.label,
        entry.description,
        entry.type,
        categoryMeta.label,
        categoryMeta.description,
        ...entry.keywords,
      ].join(" ");

      return searchable.toLowerCase().includes(normalizedSearch);
    });
  }, [entries, normalizedSearch]);

  const groupedEntries = React.useMemo(
    () => toGroupedEntries(filteredEntries),
    [filteredEntries],
  );

  return (
    <div className="space-y-4">
      <div className="border-2 border-black rounded-[6px] bg-background p-4 shadow-[4px_4px_0_#000]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              Source Catalog
            </div>
            <div className="text-sm font-semibold uppercase tracking-[0.06em]">
              Pick connector by category
            </div>
          </div>
          <Badge className="rounded-[4px] border border-black bg-[#b7ff00] text-black">
            {filteredEntries.length} Matches
          </Badge>
        </div>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search sources, categories, or capabilities"
            className="h-10 rounded-[4px] border-2 border-black pl-9 text-sm shadow-[3px_3px_0_#000] focus-visible:ring-0"
          />
          {searchQuery ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSearchQuery("")}
              className="absolute right-1 top-1/2 h-7 -translate-y-1/2 rounded-[4px] px-2 text-xs"
            >
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      {groupedEntries.length === 0 ? (
        <div className="border-2 border-dashed border-black rounded-[6px] bg-muted/30 px-6 py-8 text-center shadow-[4px_4px_0_#000]">
          <p className="text-sm font-semibold uppercase tracking-[0.08em]">
            {emptyTitle}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {emptyDescription}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedEntries.map(([category, categoryEntries]) => {
            const categoryMeta = SOURCE_CATEGORY_META[category];

            return (
              <section
                key={category}
                className="border-2 border-border rounded-[6px] bg-card overflow-hidden shadow-[6px_6px_0_var(--color-border)]"
              >
                <div className="flex flex-col gap-2 border-b-2 border-border bg-foreground px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-xs font-mono font-bold uppercase tracking-[0.12em] text-primary-foreground">
                      {categoryMeta.label}
                    </h3>
                    <p className="text-[10px] font-mono text-primary-foreground/60">
                      {categoryMeta.description}
                    </p>
                  </div>
                  <Badge className="w-fit rounded-[4px] border-2 border-black bg-[#b7ff00] text-[10px] uppercase tracking-[0.16em] text-black shadow-[3px_3px_0_#000]">
                    {categoryEntries.length} Sources
                  </Badge>
                </div>

                <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                  {categoryEntries.map((entry) => {
                    const sharedClassName = cn(
                      "group cursor-pointer text-left border-2 border-black rounded-[6px] bg-background p-3 shadow-[4px_4px_0_#000] transition-all",
                      "hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-[5px_5px_0_#000]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2",
                    );

                    const innerContent = (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <div className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] border-2 border-black bg-card">
                            <SourceIcon source={entry.icon} size="sm" />
                          </div>
                          <Badge
                            variant="outline"
                            className="rounded-[4px] border-black text-[10px]"
                          >
                            {actionLabel}
                          </Badge>
                        </div>
                        <div className="mt-3">
                          <div className="text-sm font-semibold">
                            {entry.label}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground leading-relaxed">
                            {entry.description}
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between border-t border-black/15 pt-2">
                          <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                            {entry.type}
                          </span>
                          <Sparkles className="h-3.5 w-3.5 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
                        </div>
                      </>
                    );

                    if (entry.href) {
                      return (
                        <a
                          key={entry.type}
                          href={entry.href}
                          className={sharedClassName}
                          data-testid={`source-type-${entry.type}`}
                        >
                          {innerContent}
                        </a>
                      );
                    }

                    return (
                      <button
                        key={entry.type}
                        type="button"
                        onClick={() => onSelect?.(entry.type)}
                        className={sharedClassName}
                        data-testid={`source-type-${entry.type}`}
                      >
                        {innerContent}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
