"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Filter } from "lucide-react";
import { type InquiryMatchDto } from "@workspace/api-client";
import {
  Badge,
  Checkbox,
  EmptyState,
  SeverityBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components";
import { getSourceIcon } from "../lib/source-type-icon";
import { formatRelative, formatDate } from "@/lib/date";

const CHECKBOX_CLASS =
  "border-2 border-foreground/25 rounded-[2px] data-[state=checked]:bg-accent data-[state=checked]:border-accent data-[state=checked]:text-accent-foreground data-[state=indeterminate]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:text-accent-foreground";

function detectorLabel(dt: string | undefined | null): string {
  if (!dt) return "";
  return dt
    .replace(/^UNSTRUCTURED_API_/, "")
    .replace(/_/g, " ")
    .toLowerCase();
}

export type InquiryMatchesTableProps = {
  matches: InquiryMatchDto[];
  /** Finding IDs already attached to the linked case — shown as "in case", not selectable. */
  inCaseFindingIds?: Set<string>;
  /** Omit to render a read-only table without checkboxes. */
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
};

/**
 * The single way inquiry matches are rendered: on the inquiry detail page and
 * on the case-creation page. Matches are live query results — selecting rows
 * is how an analyst chooses what becomes case evidence.
 */
export function InquiryMatchesTable({
  matches,
  inCaseFindingIds,
  selected,
  onSelectedChange,
}: InquiryMatchesTableProps) {
  const router = useRouter();
  const selectable = selected !== undefined && onSelectedChange !== undefined;

  const selectableMatches = React.useMemo(
    () => matches.filter((m) => !inCaseFindingIds?.has(m.findingId)),
    [matches, inCaseFindingIds],
  );

  const allSelected =
    selectable &&
    selectableMatches.length > 0 &&
    selectableMatches.every((m) => selected!.has(m.findingId));
  const someSelected =
    selectable && !allSelected && selectableMatches.some((m) => selected!.has(m.findingId));

  const toggleAll = () => {
    if (!selectable) return;
    if (allSelected) {
      onSelectedChange!(new Set());
    } else {
      onSelectedChange!(new Set(selectableMatches.map((m) => m.findingId)));
    }
  };

  const toggleOne = (findingId: string) => {
    if (!selectable) return;
    const next = new Set(selected);
    if (next.has(findingId)) next.delete(findingId);
    else next.add(findingId);
    onSelectedChange!(next);
  };

  if (matches.length === 0) {
    return (
      <EmptyState
        icon={Filter}
        title="No matches yet"
        description="As sources are ingested, findings matching this inquiry will appear here."
      />
    );
  }

  return (
    <div className="max-h-[60vh] overflow-auto rounded-[4px] bg-white dark:bg-card">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-white/95 dark:bg-card/95 backdrop-blur">
          <TableRow>
            {selectable && (
              <TableHead className="w-10 bg-white/95 dark:bg-card/95">
                <span className="flex items-center justify-center">
                  <Checkbox
                    checked={someSelected ? "indeterminate" : allSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all matches"
                    className={CHECKBOX_CLASS}
                  />
                </span>
              </TableHead>
            )}
            {["Finding", "Severity", "Asset", "Source", "Matched content", "Matched"].map(
              (h) => (
                <TableHead key={h} className="bg-white/95 dark:bg-card/95">
                  <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {h}
                  </span>
                </TableHead>
              ),
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {matches.map((m) => {
            const inCase = inCaseFindingIds?.has(m.findingId) ?? false;
            const isSelected = selectable && selected!.has(m.findingId);
            const SourceTypeIcon = getSourceIcon(m.sourceType);
            return (
              <TableRow
                key={m.findingId}
                className={
                  inCase
                    ? "opacity-55"
                    : isSelected
                      ? "bg-accent/5"
                      : m.isNew
                        ? "bg-[color:var(--color-amber-600,#d97706)]/5"
                        : undefined
                }
              >
                {selectable && (
                  <TableCell className="py-2">
                    <div className="flex items-center justify-center">
                      <Checkbox
                        checked={isSelected}
                        disabled={inCase}
                        onCheckedChange={() => toggleOne(m.findingId)}
                        aria-label={`Select ${m.label}`}
                        className={CHECKBOX_CLASS}
                      />
                    </div>
                  </TableCell>
                )}
                <TableCell className="max-w-[300px]">
                  <div className="flex items-center gap-2">
                    <button
                      className="truncate text-left text-sm font-medium hover:underline"
                      onClick={() => router.push(`/findings/${m.findingId}`)}
                    >
                      {m.label}
                    </button>
                    {m.isNew && !inCase && (
                      <Badge
                        variant="outline"
                        className="shrink-0 border-[color:var(--color-amber-600,#d97706)]/50 text-[10px] uppercase tracking-wide text-[color:var(--color-amber-600,#d97706)]"
                      >
                        new
                      </Badge>
                    )}
                    {inCase && (
                      <Badge variant="outline" className="shrink-0 text-[10px] uppercase tracking-wide">
                        in case
                      </Badge>
                    )}
                  </div>
                  {m.detectorType && (
                    <p className="text-muted-foreground mt-0.5 text-[11px]">
                      {detectorLabel(m.detectorType)}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  {m.severity ? (
                    <SeverityBadge
                      severity={m.severity.toLowerCase() as "critical" | "high" | "medium" | "low" | "info"}
                    >
                      {m.severity}
                    </SeverityBadge>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="max-w-[220px]">
                  <button
                    className="block max-w-[200px] truncate text-left text-sm hover:underline"
                    onClick={() => router.push(`/assets/${m.assetId}`)}
                  >
                    {m.assetName ?? m.assetId}
                  </button>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <SourceTypeIcon className="h-3.5 w-3.5 shrink-0" />
                    {m.sourceType ? detectorLabel(m.sourceType) : "—"}
                  </span>
                </TableCell>
                <TableCell className="max-w-[220px]">
                  {m.matchedContent ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="block max-w-[200px] cursor-default truncate font-mono text-[11px] text-muted-foreground">
                          {m.matchedContent}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[360px] break-all font-mono">
                        {m.matchedContent}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-default text-xs text-muted-foreground">
                        {formatRelative(new Date(m.matchedAt))}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="left">{formatDate(new Date(m.matchedAt))}</TooltipContent>
                  </Tooltip>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
