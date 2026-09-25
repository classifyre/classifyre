"use client";

import * as React from "react";
import { Eye } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useBoardStore, useUi, useUiStore } from "../store/board-context";
import { combine, setCollapsed } from "../store/commands";
import { hypothesisMeta } from "../store/selectors";
import { SUGGESTED_AUTO_LIMIT, type SuggestedMode, type ViewPrefs } from "../store/ui-store";

const ANY = "__any__";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{title}</p>
      {children}
    </section>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = React.useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      {label}
    </label>
  );
}

/**
 * The View popover (PRD §5.10) replaces the old sidebar filters. Per viewer,
 * kept in localStorage, never on the board. Finding-state toggles fade rows
 * instead of hiding them: the board never removes evidence from view.
 */
export function ViewPopover() {
  const { t } = useTranslation();
  const view = useUi((s) => s.view);
  const ui = useUiStore();
  const store = useBoardStore();
  const suggestedCount = useBoard((s) => s.suggested.size);
  const bubbles = useBoard((s) => s.bubbles);
  const threads = useBoard((s) => s.threads);
  const readOnly = useBoard((s) => s.readOnly);
  const set = (patch: Partial<ViewPrefs>) => ui.getState().setView(patch);

  const sources = React.useMemo(
    () => [...new Set([...bubbles.values()].map((b) => b.sourceType).filter((v): v is string => !!v))].sort(),
    [bubbles],
  );
  const detectors = React.useMemo(
    () =>
      [...new Set([...bubbles.values()].flatMap((b) => b.rows.map((r) => r.detector)).filter((v): v is string => !!v))].sort(),
    [bubbles],
  );
  const hypotheses = React.useMemo(() => {
    const meta = hypothesisMeta(threads);
    return [...threads.values()]
      .filter((th) => th.kind === "HYPOTHESIS")
      .map((th) => ({ id: th.id, label: `${meta.get(th.id)?.label ?? "H"} · ${th.title}` }));
  }, [threads]);
  const filtering =
    view.onlyHighlighted || !!view.highlightSource || !!view.highlightDetector || !!view.highlightHypothesis;

  const setAllCollapsed = (collapsed: boolean) => {
    const s = store.getState();
    const cmds = [...s.items.values()]
      .filter((i) => i.kind === "EVIDENCE" && i.collapsed !== collapsed)
      .map((i) => setCollapsed(i, collapsed));
    if (cmds.length > 0) s.run(combine(collapsed ? "Collapse all" : "Expand all", ...cmds));
  };

  const pick = (value: string | null, onPick: (v: string | null) => void, options: Array<{ id: string; label: string }>) => (
    <Select value={value ?? ANY} onValueChange={(v) => onPick(v === ANY ? null : v)}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{t("caseBoard.view.anything")}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            <span className="max-w-56 truncate">{o.label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-11 items-center gap-2 rounded-[6px] border-2 bg-card px-3 text-sm font-medium",
            "max-w-full",
            filtering ? "border-foreground" : "border-border",
          )}
          data-testid="view-popover-trigger"
          aria-label={t("caseBoard.view.title")}
        >
          <Eye className="size-4" aria-hidden />
          <span className="hidden @3xl/board:inline">{t("caseBoard.view.title")}</span>
          {filtering && <span className="size-2 rounded-full bg-foreground" aria-hidden />}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 max-h-[70vh] space-y-4 overflow-y-auto p-4">
        <Section title={t("caseBoard.view.suggested")}>
          <div className="grid grid-cols-3 gap-1 rounded-[4px] border border-border p-0.5">
            {(["auto", "show", "hide"] as SuggestedMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={cn(
                  "rounded-[3px] px-2 py-1 text-xs",
                  view.suggested === mode ? "bg-foreground text-background" : "hover:bg-muted",
                )}
                onClick={() => set({ suggested: mode })}
                aria-pressed={view.suggested === mode}
              >
                {mode === "auto"
                  ? t("caseBoard.view.suggestedAuto")
                  : mode === "show"
                    ? t("caseBoard.view.suggestedShow")
                    : t("caseBoard.view.suggestedHide")}
              </button>
            ))}
          </div>
          {view.suggested === "auto" && suggestedCount > SUGGESTED_AUTO_LIMIT && (
            <p className="text-xs text-muted-foreground">
              {t("caseBoard.view.suggestedAutoHidden", { count: suggestedCount })}
            </p>
          )}
        </Section>

        <Section title={t("caseBoard.view.findings")}>
          <Toggle label={t("caseBoard.view.showResolved")} checked={view.showResolved} onChange={(v) => set({ showResolved: v })} />
          <Toggle label={t("caseBoard.view.showDismissed")} checked={view.showDismissed} onChange={(v) => set({ showDismissed: v })} />
          <Toggle label={t("caseBoard.view.showGone")} checked={view.showGone} onChange={(v) => set({ showGone: v })} />
          <p className="text-[11px] text-muted-foreground">{t("caseBoard.view.dimNote")}</p>
        </Section>

        <Section title={t("caseBoard.view.systemLinks")}>
          <Toggle label={t("caseBoard.view.lineage")} checked={view.lineage} onChange={(v) => set({ lineage: v })} />
          <Toggle label={t("caseBoard.view.duplicates")} checked={view.duplicates} onChange={(v) => set({ duplicates: v })} />
          <Toggle label={t("caseBoard.view.references")} checked={view.references} onChange={(v) => set({ references: v })} />
        </Section>

        <Section title={t("caseBoard.view.highlightBy")}>
          <div className="grid grid-cols-[80px_1fr] items-center gap-2 text-xs">
            <span>{t("caseBoard.view.source")}</span>
            {pick(view.highlightSource, (v) => set({ highlightSource: v }), sources.map((s) => ({ id: s, label: s })))}
            <span>{t("caseBoard.view.detector")}</span>
            {pick(view.highlightDetector, (v) => set({ highlightDetector: v }), detectors.map((d) => ({ id: d, label: d })))}
            <span>{t("caseBoard.view.hypothesis")}</span>
            {pick(view.highlightHypothesis, (v) => set({ highlightHypothesis: v }), hypotheses)}
          </div>
          <Toggle
            label={t("caseBoard.view.onlyHighlighted")}
            checked={view.onlyHighlighted}
            onChange={(v) => set({ onlyHighlighted: v })}
          />
        </Section>

        <Section title={t("caseBoard.view.comments")}>
          <Toggle
            label={t("caseBoard.view.showResolvedComments")}
            checked={view.showResolvedComments}
            onChange={(v) => set({ showResolvedComments: v })}
          />
        </Section>

        <Section title={t("caseBoard.view.findings")}>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={readOnly}
              className="flex-1 rounded-[4px] border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
              onClick={() => setAllCollapsed(false)}
            >
              {t("caseBoard.view.expandAll")}
            </button>
            <button
              type="button"
              disabled={readOnly}
              className="flex-1 rounded-[4px] border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
              onClick={() => setAllCollapsed(true)}
            >
              {t("caseBoard.view.collapseAll")}
            </button>
          </div>
        </Section>
      </PopoverContent>
    </Popover>
  );
}
