"use client";

import * as React from "react";
import type { NodeProps } from "@xyflow/react";
import { TERM_CARD_SIZE } from "@workspace/schemas/case-board";
import { Ports } from "@workspace/case-board/components/ports";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard } from "../store/board-context";
import type { BoardNode } from "../store/projection";

/**
 * A glossary term pinned to the board (SL5 A3): the concept, its scheme
 * colour and how many pieces of the board's evidence are about it. A link
 * drawn from evidence to it promotes to a meaning link (an ABOUT reference).
 */
export const TermNode = React.memo(function TermNode({ id, selected }: NodeProps<BoardNode>) {
  const { t } = useTranslation();
  const item = useBoard((s) => s.items.get(id));
  const readOnly = useBoard((s) => s.readOnly);
  const term = useBoard((s) =>
    s.semantic?.terms.find(
      (entry) => entry.placedItemId === id || (item?.refId && entry.termId === item.refId),
    ),
  );
  if (!item) return null;
  const color = term?.scheme?.color ?? "var(--muted-foreground)";
  const gone = term?.deleted || term?.status === "DEPRECATED";

  return (
    <div
      className={cn(
        "relative flex items-center gap-2 rounded-full border-2 bg-background px-3 shadow-sm",
        selected ? "border-accent" : "border-border",
        gone && "opacity-60",
      )}
      style={{ width: TERM_CARD_SIZE.width, height: TERM_CARD_SIZE.height }}
      data-testid="board-term-node"
    >
      <span
        aria-hidden
        className="size-3 shrink-0 rounded-full border border-border"
        style={{ backgroundColor: color }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold" title={term?.definition ?? undefined}>
          {term?.name ?? t("caseBoard.term.unknown")}
        </span>
        <span className="block truncate font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          {term
            ? t("caseBoard.term.linked", { count: String(term.linkedItems.length) })
            : t("caseBoard.term.concept")}
          {term?.scheme ? ` · ${term.scheme.name}` : ""}
        </span>
      </span>
      <Ports connectable={!readOnly} />
    </div>
  );
});
