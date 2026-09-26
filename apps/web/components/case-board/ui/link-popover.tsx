"use client";

import * as React from "react";
import { Check, Circle, X } from "lucide-react";
import { toast } from "sonner";
import { BOARD_LINK_KINDS, type BoardEndpoint, type BoardStance } from "@workspace/schemas/case-board";
import { Popover, PopoverAnchor, PopoverContent } from "@workspace/ui/components/popover";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { useBoardStore, useUi, useUiStore } from "../store/board-context";
import type { BoardState } from "../store/board-store";
import { attachFinding, combine, createLink, setStance, type Command } from "../store/commands";
import { humanizeKind } from "../edges/link-edge";

const RECENT_KEY = "classifyre.caseBoard.recentKinds.v1";

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string").slice(0, 10) : [];
  } catch {
    return [];
  }
}

function rememberKind(kind: string): void {
  try {
    const next = [kind, ...readRecent().filter((k) => k !== kind)].slice(0, 10);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: recency is a convenience, not a requirement.
  }
}

/** Recently used kinds first, then the default vocabulary. */
export function orderedKinds(recent: string[]): string[] {
  return [...new Set([...recent, ...BOARD_LINK_KINDS])];
}

function isUnattachedRow(s: BoardState, end: BoardEndpoint): boolean {
  if (!end.findingId) return false;
  const bubble = s.bubbles.get(end.itemId);
  return !!bubble?.unattached.some((r) => r.findingId === end.findingId);
}

/**
 * Opens where a link was dropped (PRD §5.4). Either end a hypothesis and the
 * other evidence: three stance buttons, one click. Otherwise a list of kinds,
 * recent first, with Confirmed/Suspected and an optional label; Enter takes
 * the top kind, Escape cancels. Nothing is saved until a choice is made.
 */
export function LinkPopover() {
  const { t } = useTranslation();
  const pending = useUi((s) => s.pendingLink);
  const ui = useUiStore();
  const store = useBoardStore();
  const [certainty, setCertainty] = React.useState<"CONFIRMED" | "SUSPECTED">("CONFIRMED");
  const [label, setLabel] = React.useState("");
  const [custom, setCustom] = React.useState("");
  const [customOpen, setCustomOpen] = React.useState(false);
  const [recent, setRecent] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (pending) {
      setRecent(readRecent());
      setCertainty("CONFIRMED");
      setLabel("");
      setCustom("");
      setCustomOpen(false);
    }
  }, [pending]);

  if (!pending) return null;
  const close = () => ui.getState().set({ pendingLink: null });

  const s = store.getState();
  const kindOf = (id: string) => s.items.get(id)?.kind;
  const hypothesisEnd =
    kindOf(pending.source.itemId) === "HYPOTHESIS"
      ? pending.source
      : kindOf(pending.target.itemId) === "HYPOTHESIS"
        ? pending.target
        : null;
  const evidenceEnd = hypothesisEnd
    ? hypothesisEnd === pending.source
      ? pending.target
      : pending.source
    : null;
  const stanceMode = !!hypothesisEnd && !!evidenceEnd && kindOf(evidenceEnd.itemId) === "EVIDENCE";

  const chooseStance = (stance: BoardStance) => {
    if (!hypothesisEnd || !evidenceEnd) return;
    const hyp = s.items.get(hypothesisEnd.itemId);
    const previous =
      [...s.supports.values()].find(
        (sp) =>
          sp.threadId === hyp?.refId &&
          sp.endpoint?.itemId === evidenceEnd.itemId &&
          (sp.endpoint?.findingId ?? null) === (evidenceEnd.findingId ?? null),
      ) ?? null;
    store.getState().run(setStance(hypothesisEnd.itemId, evidenceEnd, stance, previous));
    close();
  };

  const chooseKind = (kind: string) => {
    const trimmed = kind.trim();
    if (!trimmed) return;
    // Links end on attached rows only; a "+n more" row is attached first.
    const prelude: Command[] = [];
    for (const end of [pending.source, pending.target]) {
      if (isUnattachedRow(s, end)) prelude.push(attachFinding(end.itemId, end.findingId!));
    }
    const link = createLink({
      source: pending.source,
      target: pending.target,
      kind: trimmed,
      certainty,
      ...(label.trim() ? { label: label.trim() } : {}),
    });
    store.getState().run(prelude.length > 0 ? combine(link.label, ...prelude, link) : link);
    rememberKind(trimmed);
    toast.success(t("caseBoard.toasts.linkCreated"), { duration: 1500 });
    close();
  };

  const kinds = orderedKinds(recent);

  return (
    <Popover open onOpenChange={(open) => !open && close()}>
      <PopoverAnchor asChild>
        <span
          aria-hidden
          style={{ position: "fixed", left: pending.screen.x, top: pending.screen.y, width: 1, height: 1 }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-64 p-2"
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
          e.stopPropagation();
        }}
        data-testid="link-popover"
      >
        {stanceMode ? (
          <div className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {t("caseBoard.link.stanceTitle")}
            </p>
            <div className="grid grid-cols-3 gap-1">
              {(
                [
                  ["SUPPORTS", Check, "var(--cb-supports)", t("caseBoard.link.supports")],
                  ["CONTRADICTS", X, "var(--cb-contradicts)", t("caseBoard.link.contradicts")],
                  ["NEUTRAL", Circle, "var(--cb-neutral)", t("caseBoard.link.neutral")],
                ] as const
              ).map(([stance, Icon, color, text], index) => (
                <button
                  key={stance}
                  type="button"
                  autoFocus={index === 0}
                  className="flex flex-col items-center gap-1 rounded-[4px] border-2 border-border px-1 py-2 text-[11px] font-medium hover:border-foreground focus-visible:border-foreground focus-visible:outline-none"
                  onClick={() => chooseStance(stance)}
                >
                  <Icon className="size-4" style={{ color }} strokeWidth={3} aria-hidden />
                  {text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {t("caseBoard.link.title")}
            </p>
            <div className="grid grid-cols-2 gap-1 rounded-[4px] border border-border p-0.5">
              {(["CONFIRMED", "SUSPECTED"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  className={cn(
                    "rounded-[3px] px-2 py-1 text-[11px]",
                    certainty === c ? "bg-foreground text-background" : "hover:bg-muted",
                  )}
                  onClick={() => setCertainty(c)}
                  aria-pressed={certainty === c}
                >
                  {c === "CONFIRMED" ? t("caseBoard.link.confirmed") : t("caseBoard.link.suspected")}
                </button>
              ))}
            </div>
            <ul className="max-h-56 space-y-0.5 overflow-y-auto" role="listbox">
              {kinds.map((kind, index) => (
                <li key={kind}>
                  <button
                    type="button"
                    autoFocus={index === 0}
                    className="flex w-full items-center justify-between rounded-[3px] px-2 py-1 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    onClick={() => chooseKind(kind)}
                  >
                    <span className={kind === "contradicts" ? "text-[var(--cb-contradicts)]" : undefined}>
                      {humanizeKind(kind, t)}
                    </span>
                    {index === 0 && <kbd className="font-mono text-[10px] text-muted-foreground">↵</kbd>}
                  </button>
                </li>
              ))}
            </ul>
            {customOpen ? (
              <Input
                autoFocus
                value={custom}
                placeholder={t("caseBoard.link.customPlaceholder")}
                className="h-8 text-sm"
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") chooseKind(custom);
                }}
              />
            ) : (
              <button
                type="button"
                className="w-full rounded-[3px] px-2 py-1 text-left text-sm text-muted-foreground hover:bg-muted"
                onClick={() => setCustomOpen(true)}
              >
                {t("caseBoard.link.custom")}
              </button>
            )}
            <Input
              value={label}
              placeholder={t("caseBoard.link.labelPlaceholder")}
              className="h-8 text-sm"
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") chooseKind(customOpen && custom.trim() ? custom : kinds[0]!);
              }}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
