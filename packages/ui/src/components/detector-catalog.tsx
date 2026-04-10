"use client";

import * as React from "react";
import { Search } from "lucide-react";

import { cn } from "@workspace/ui/lib/utils";

import { Badge } from "./badge";
import { Button } from "./button";
import { Card, CardContent } from "./card";
import { Input } from "./input";
import {
  detectorCatalogGroups,
  type DetectorCatalogGroup,
  type DetectorCatalogItem,
} from "./detector-catalog-utils";

export type { DetectorCatalogItem, DetectorCatalogGroup };

function matchesSearch(item: DetectorCatalogItem, term: string): boolean {
  if (!term) return true;
  const haystack = [
    item.type,
    item.title,
    item.description,
    item.categories.join(" "),
    item.lifecycleStatus,
    item.priority,
  ]
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    )
    .join(" ")
    .toLowerCase();

  return haystack.includes(term);
}

function DetectorCatalogCard({
  item,
  external,
}: {
  item: DetectorCatalogItem;
  external?: boolean;
}) {
  const sharedClassName =
    "group rounded-[6px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2";

  const card = (
    <Card clickable className="h-full p-3">
      <div className="flex h-full flex-col gap-4">
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {item.type.replace(/_/g, " ")}
              </div>
              <div className="text-sm font-semibold uppercase tracking-[0.04em]">
                {item.title}
              </div>
            </div>
            {item.priority ? (
              <Badge>
                {item.priority}
              </Badge>
            ) : null}
          </div>

          {item.description ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {item.description}
            </p>
          ) : null}
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-2">
          {item.categories.map((category) => (
            <Badge
              key={`${item.type}-${category}`}
              variant="outline"
              className="rounded-[4px] border border-border text-[10px] uppercase tracking-[0.12em]"
            >
              {category}
            </Badge>
          ))}
        </div>
      </div>
    </Card>
  );

  if (!item.href) {
    return <div className={sharedClassName}>{card}</div>;
  }

  return (
    <a
      href={item.href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className={sharedClassName}
    >
      {card}
    </a>
  );
}

export function DetectorCatalog({
  items,
  groups = detectorCatalogGroups,
  external,
}: {
  items: readonly DetectorCatalogItem[];
  groups?: readonly DetectorCatalogGroup[];
  external?: boolean;
}) {
  const [searchQuery, setSearchQuery] = React.useState("");
  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredItems = React.useMemo(() => {
    if (!normalizedSearch) {
      return items;
    }

    return items.filter((item) => matchesSearch(item, normalizedSearch));
  }, [items, normalizedSearch]);

  const groupedEntries = React.useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          items: filteredItems.filter((item) => item.groupId === group.id),
        }))
        .filter((group) => group.items.length > 0),
    [filteredItems, groups],
  );

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              Detector Catalog
            </div>
            <div className="text-sm font-semibold uppercase tracking-[0.06em]">
              Pick detectors by category
            </div>
          </div>
          <Badge className="rounded-[4px] border border-black bg-[#b7ff00] text-black">
            {filteredItems.length} Matches
          </Badge>
        </div>

        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search detectors, categories, or finding types"
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
      </Card>

      {groupedEntries.length === 0 ? (
        <Card className="border-dashed border-black bg-muted/30 px-6 py-8 text-center shadow-[4px_4px_0_#000]">
          <p className="text-sm font-semibold uppercase tracking-[0.08em]">
            No detectors found
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try a different keyword like privacy, secrets, tagging, or prompt.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {groupedEntries.map((group) => (
            <Card key={group.id} className="bg-background p-0">
              <section>
                <div className="flex flex-col gap-2 border-b-2 border-border bg-foreground px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-xs font-mono font-bold uppercase tracking-[0.12em] text-primary-foreground">
                      {group.label}
                    </h3>
                    {group.description ? (
                      <p className="text-[10px] font-mono text-primary-foreground/60">
                        {group.description}
                      </p>
                    ) : null}
                  </div>
                  <Badge>
                    {group.items.length} Detectors
                  </Badge>
                </div>

                <CardContent
                  className={cn(
                    "grid gap-3 p-4 md:grid-cols-2",
                    group.items.length > 2
                      ? "xl:grid-cols-3"
                      : "xl:grid-cols-2",
                  )}
                >
                  {group.items.map((item) => (
                    <DetectorCatalogCard
                      key={item.id}
                      item={item}
                      external={external}
                    />
                  ))}
                </CardContent>
              </section>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
