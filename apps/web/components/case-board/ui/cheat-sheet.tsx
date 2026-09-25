"use client";

import * as React from "react";
import { Globe, Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import type { TranslationKey } from "@/i18n";
import { useTranslation } from "@/hooks/use-translation";
import { useUi, useUiStore } from "../store/board-context";
import { AssetCircle, FindingCircle, type FindingLook } from "../nodes/relation-glyphs";
import type { SeverityKey } from "../store/types";

const SHORTCUTS: Array<[string, TranslationKey]> = [
  ["V", "caseBoard.cheatSheet.items.select"],
  ["H / Space", "caseBoard.cheatSheet.items.pan"],
  ["N", "caseBoard.cheatSheet.items.note"],
  ["F", "caseBoard.cheatSheet.items.frame"],
  ["T", "caseBoard.cheatSheet.items.hypothesis"],
  ["C", "caseBoard.cheatSheet.items.comment"],
  ["L", "caseBoard.cheatSheet.items.link"],
  ["E", "caseBoard.cheatSheet.items.expand"],
  ["⌘K", "caseBoard.cheatSheet.items.palette"],
  ["?", "caseBoard.cheatSheet.items.help"],
  ["⌘Z", "caseBoard.cheatSheet.items.undo"],
  ["⇧⌘Z", "caseBoard.cheatSheet.items.redo"],
  ["⌫ / Del", "caseBoard.cheatSheet.items.delete"],
  ["⇧1", "caseBoard.cheatSheet.items.fit"],
  ["⇧2", "caseBoard.cheatSheet.items.zoomSelection"],
  [".", "caseBoard.cheatSheet.items.focusLock"],
  ["Esc", "caseBoard.cheatSheet.items.escape"],
  ["⌘A", "caseBoard.cheatSheet.items.selectAll"],
  ["⌘D", "caseBoard.cheatSheet.items.duplicate"],
  ["⇧ + click", "caseBoard.cheatSheet.items.path"],
];

/** A small copy of what the board draws, from the same components. */
function Glyph({ children, width = 44 }: { children: React.ReactNode; width?: number }) {
  return (
    <svg width={width} height={32} viewBox={`${-width / 2} -16 ${width} 32`} aria-hidden className="shrink-0 overflow-visible">
      {children}
    </svg>
  );
}

const Asset = (props: { inCase: boolean; donut?: Array<{ severity: SeverityKey; count: number }> }) => (
  <g transform="scale(0.6)">
    <AssetCircle cx={0} cy={0} inCase={props.inCase} donut={props.donut ?? null} />
  </g>
);

const Finding = ({ x, severity, look = "open" }: { x: number; severity: SeverityKey; look?: FindingLook }) => (
  <g transform={`translate(${x} 0) scale(0.75)`}>
    <FindingCircle cx={0} cy={0} severity={severity} look={look} />
  </g>
);

function Line({ dash, double, color = "var(--foreground)", arrow }: { dash?: string; double?: boolean; color?: string; arrow?: boolean }) {
  return (
    <svg width="44" height="12" aria-hidden className="shrink-0">
      {double ? (
        <>
          <line x1="2" y1="6" x2="42" y2="6" stroke={color} strokeWidth="4.5" />
          <line x1="2" y1="6" x2="42" y2="6" stroke="var(--background)" strokeWidth="1.5" />
        </>
      ) : (
        <line x1="2" y1="6" x2={arrow ? 36 : 42} y2="6" stroke={color} strokeWidth="2" strokeDasharray={dash} />
      )}
      {arrow && <path d="M36,2 L42,6 L36,10 z" style={{ fill: color }} />}
    </svg>
  );
}

/**
 * `?` — shortcuts and the visual key (PRD §5.9). A dialog for learning, not
 * permanent chrome: the board itself stays legend-free.
 */
export function CheatSheet() {
  const { t } = useTranslation();
  const open = useUi((s) => s.cheatSheetOpen);
  const ui = useUiStore();
  return (
    <Dialog open={open} onOpenChange={(next) => ui.getState().set({ cheatSheetOpen: next })}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("caseBoard.cheatSheet.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("caseBoard.cheatSheet.title")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 md:grid-cols-2">
          <section>
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {t("caseBoard.cheatSheet.shortcuts")}
            </p>
            <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1 text-sm">
              {SHORTCUTS.map(([key, label]) => (
                <React.Fragment key={key}>
                  <dt>
                    <kbd className="rounded-[3px] border border-border px-1 font-mono text-[11px]">{key}</kbd>
                  </dt>
                  <dd>{t(label)}</dd>
                </React.Fragment>
              ))}
            </dl>
          </section>
          <section>
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {t("caseBoard.cheatSheet.key")}
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-3"><Line arrow color="var(--cb-edge)" /> {t("caseBoard.cheatSheet.visual.lineage")}</li>
              <li className="flex items-center gap-3"><Line dash="5 4" color="var(--cb-edge)" /> {t("caseBoard.cheatSheet.visual.double")}</li>
              <li className="flex items-center gap-3"><Line color="var(--cb-manual)" /> {t("caseBoard.cheatSheet.visual.solid")}</li>
              <li className="flex items-center gap-3"><Line dash="6 4" color="var(--cb-manual)" /> {t("caseBoard.cheatSheet.visual.dashed")}</li>
              <li className="flex items-center gap-3"><Line color="var(--cb-supports)" /> {t("caseBoard.cheatSheet.visual.dotted")}</li>
              <li className="flex items-center gap-3"><Globe className="ml-3 size-4 shrink-0" style={{ marginRight: 16 }} aria-hidden /> {t("caseBoard.cheatSheet.visual.global")}</li>
              <li className="flex items-center gap-3"><Lock className="ml-3 size-4 shrink-0" style={{ marginRight: 16 }} aria-hidden /> {t("caseBoard.cheatSheet.visual.lock")}</li>
            </ul>
            <ul className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
              <li className="flex items-center gap-3">
                <Glyph><Asset inCase /></Glyph> {t("caseBoard.cheatSheet.visual.inCase")}
              </li>
              <li className="flex items-center gap-3">
                <Glyph><Asset inCase={false} /></Glyph> {t("caseBoard.cheatSheet.visual.neighbour")}
              </li>
              <li className="flex items-center gap-3">
                <Glyph>
                  <Finding x={-14} severity="critical" />
                  <Finding x={0} severity="medium" />
                  <Finding x={14} severity="low" />
                </Glyph>
                {t("caseBoard.cheatSheet.visual.finding")}
              </li>
              <li className="flex items-center gap-3">
                <Glyph>
                  <Finding x={-14} severity="high" look="resolved" />
                  <Finding x={0} severity="high" look="dismissed" />
                  <Finding x={14} severity="high" look="gone" />
                </Glyph>
                {t("caseBoard.cheatSheet.visual.settled")}
              </li>
              <li className="flex items-center gap-3">
                <Glyph>
                  <Asset inCase donut={[{ severity: "critical", count: 1 }, { severity: "high", count: 2 }, { severity: "low", count: 2 }]} />
                </Glyph>
                {t("caseBoard.cheatSheet.visual.donut")}
              </li>
              <li className="flex items-center gap-3">
                <span className="flex w-11 shrink-0 justify-center" aria-hidden>
                  <span className="rounded-[3px] border-[1.5px] border-[#0a0a0a] bg-accent px-1 font-mono text-[10px] font-bold leading-[14px] text-accent-foreground">
                    +3
                  </span>
                </span>
                {t("caseBoard.cheatSheet.visual.more")}
              </li>
              <li className="flex items-center gap-3">
                <span className="w-11 shrink-0 text-center font-mono text-[8px] uppercase tracking-[0.06em] text-muted-foreground" aria-hidden>
                  contains
                </span>
                {t("caseBoard.cheatSheet.visual.relation")}
              </li>
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
