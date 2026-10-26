"use client";

import * as React from "react";
import {
  BookOpen,
  Briefcase,
  Crosshair,
  ExternalLink,
  Info,
  LogIn,
  Maximize2,
  Plus,
  RotateCcw,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import type { ExploreNeighbourhoodResponseDto } from "@workspace/api-client";
import type { ExploreGraph, ExploreKind, ExploreMenuTarget, ExploreWords } from "@workspace/case-board/explore";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from "@workspace/ui/components/context-menu";
import { useTermHref } from "@/components/glossary/glossary-ui";
import { encodePairId } from "@/components/review/review-format";
import { useTranslation } from "@/hooks/use-translation";
import { useNsPath } from "@/lib/ns-path";

export interface ExploreMenuActions {
  /** Show it in Details. */
  onDetails: (target: Exclude<ExploreMenuTarget, { type: "pane" }>) => void;
  /** Re-centre on it (asset, source and term pages). */
  onDiveIn?: (assetId: string) => void;
  /** Explore's own page: add it to the starting points, or start over from it. */
  onAddSeed?: (assetId: string) => void;
  onStartFrom?: (assetId: string) => void;
  onToCase: (assetId: string) => void;
  onRemoveLink: (edgeId: string) => void;
  /** Go to a page (an href already in the workspace). */
  onOpen: (href: string) => void;
  onFit: () => void;
  /** Explore's own page: forget where things were dragged. */
  onResetLayout?: () => void;
}

const LABEL = "max-w-72 truncate font-mono text-[10px] font-normal tracking-[0.12em] text-muted-foreground uppercase";

/**
 * The canvas's right-click menu, the case board's way: React Flow records
 * what was clicked, then the same event opens this. Everything an asset, a
 * term, a line or the empty canvas offers, in one place.
 */
export function ExploreContextMenuContent({
  target,
  data,
  graph,
  words,
  here,
  actions,
}: {
  target: ExploreMenuTarget | null;
  data: ExploreNeighbourhoodResponseDto | null;
  graph: ExploreGraph | null;
  words: ExploreWords;
  /** The asset whose page this is: it is not opened again. */
  here?: string;
  actions: ExploreMenuActions;
}) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const termHref = useTermHref();
  if (!target) return <ContextMenuContent className="hidden" />;

  if (target.type === "asset") {
    const a = graph?.assets.find((x) => x.id === target.id);
    if (!a || a.external) return <ContextMenuContent className="hidden" />;
    const onlySeed = a.side === "seed" && (data?.seeds.length ?? 0) === 1;
    return (
      <ContextMenuContent className="w-60" data-testid="explore-menu">
        <ContextMenuLabel className={LABEL}>{a.label}</ContextMenuLabel>
        <ContextMenuItem onSelect={() => actions.onDetails(target)}>
          <Info className="size-4" /> {t("explore.menu.details")}
        </ContextMenuItem>
        {actions.onDiveIn && !onlySeed && (
          <ContextMenuItem onSelect={() => actions.onDiveIn!(a.id)}>
            <LogIn className="size-4" /> {t("explore.diveIn")}
          </ContextMenuItem>
        )}
        {actions.onAddSeed && a.side !== "seed" && (
          <ContextMenuItem onSelect={() => actions.onAddSeed!(a.id)}>
            <Plus className="size-4" /> {t("explore.addSeed")}
          </ContextMenuItem>
        )}
        {actions.onStartFrom && (
          <ContextMenuItem onSelect={() => actions.onStartFrom!(a.id)}>
            <Crosshair className="size-4" /> {t("explore.startOver")}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        {a.id !== here && (
          <ContextMenuItem onSelect={() => actions.onOpen(nsPath(`/assets/${a.id}`))}>
            <ExternalLink className="size-4" /> {t("explore.openAsset")}
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => window.open(nsPath(`/assets/${a.id}`), "_blank", "noopener")}>
          <SquareArrowOutUpRight className="size-4" /> {t("explore.menu.newTab")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.onToCase(a.id)}>
          <Briefcase className="size-4" /> {t("explore.toCase")}
        </ContextMenuItem>
      </ContextMenuContent>
    );
  }

  if (target.type === "term") {
    const term = data?.terms.find((x) => x.id === target.id);
    if (!term) return <ContextMenuContent className="hidden" />;
    return (
      <ContextMenuContent className="w-60" data-testid="explore-menu">
        <ContextMenuLabel className={LABEL}>{term.name}</ContextMenuLabel>
        <ContextMenuItem onSelect={() => actions.onDetails(target)}>
          <Info className="size-4" /> {t("explore.menu.carriers")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.onOpen(termHref(term.key))}>
          <BookOpen className="size-4" /> {t("explore.openTerm")}
        </ContextMenuItem>
      </ContextMenuContent>
    );
  }

  if (target.type === "link") {
    const e = data?.edges.find((x) => x.id === target.id);
    if (!e) return <ContextMenuContent className="hidden" />;
    const kind = e.kind as ExploreKind;
    const paired = (kind === "duplicates" || kind === "similar") && e.fromType === "asset" && e.toType === "asset";
    return (
      <ContextMenuContent className="w-60" data-testid="explore-menu">
        <ContextMenuLabel className={LABEL}>{words.kinds[kind]}</ContextMenuLabel>
        <ContextMenuItem onSelect={() => actions.onDetails(target)}>
          <Info className="size-4" /> {t("explore.menu.why")}
        </ContextMenuItem>
        {paired && (
          <ContextMenuItem onSelect={() => actions.onOpen(nsPath(`/duplicates/pairs/${encodePairId(e.fromId, e.toId)}`))}>
            <ExternalLink className="size-4" /> {t("explore.reviewPair")}
          </ContextMenuItem>
        )}
        {e.origin === "MANUAL" && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => actions.onRemoveLink(e.id)}>
              <Trash2 className="size-4" /> {t("explore.removeLink")}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    );
  }

  return (
    <ContextMenuContent className="w-60" data-testid="explore-menu">
      <ContextMenuItem onSelect={actions.onFit}>
        <Maximize2 className="size-4" /> {words.fit}
      </ContextMenuItem>
      {actions.onResetLayout && (
        <ContextMenuItem onSelect={actions.onResetLayout}>
          <RotateCcw className="size-4" /> {t("explore.saved.resetLayout")}
        </ContextMenuItem>
      )}
    </ContextMenuContent>
  );
}
