"use client";

import * as React from "react";
import { ArrowLeft, Briefcase, Compass, Eye, Info, PanelRightClose, PanelRightOpen, Search, type LucideIcon } from "lucide-react";
import {
  EXPLORE_KINDS,
  KindLine,
  type ExploreKind,
  type ExploreSpotlight,
  type ExploreWords,
} from "@workspace/case-board/explore";
import { Button } from "@workspace/ui/components/button";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { DirectionSwitch, HopLadder } from "@/components/case-board/ui/trace-controls";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import {
  EXPLORE_SCOPES,
  EXPLORE_VIEWS,
  VIEW_KINDS,
  type ExploreScope,
  type ExploreViewName,
  type TraceDirection,
} from "@/lib/explore";

export type ExploreDrawer = "find" | "suggestions" | "details" | "marks";

const MICRO = "font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground";

/** One counter of the ledger: the case board's own, lighting what it counts. */
function Counter({
  glyph,
  value,
  label,
  hint,
  active,
  onToggle,
  testId,
}: {
  glyph: React.ReactNode;
  value: number;
  label: string;
  hint: string;
  active: boolean;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={active}
          disabled={value === 0 && !active}
          data-testid={testId}
          className={cn(
            "group relative flex h-full shrink-0 items-center gap-2 px-3 transition-colors disabled:cursor-default disabled:opacity-45",
            "[&:not(:first-child)]:border-l-2 [&:not(:first-child)]:border-border",
            active ? "bg-foreground text-background" : "enabled:hover:bg-muted",
          )}
        >
          {glyph}
          <span className="font-mono text-[15px] leading-none font-bold tabular-nums">{value}</span>
          <span
            className={cn(
              "hidden font-mono text-[10px] leading-none tracking-[0.12em] whitespace-nowrap uppercase @6xl/topbar:inline",
              active ? "text-background/75" : "text-muted-foreground",
            )}
          >
            {label}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{hint}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Explore's one-line top bar, the case board's: the title (on Explore's own
 * page), a ledger of what is on the canvas (each counter lights what it
 * counts), and on the right which connections are kept, where a dive has
 * led, and the page's own actions. Search is in the Find panel.
 */
export function ExploreTopBar({
  title,
  kinds,
  counts,
  cases,
  watches,
  spotlight,
  onSpotlight,
  words,
  actions,
  trail,
  scope,
  onScope,
}: {
  /** Left out where the page already names what this is (an asset's page). */
  title?: string;
  /** Where a dive has led: top right, next to the actions. */
  trail?: React.ReactNode;
  /** All connections, only those inside the source, or only those leaving it. */
  scope?: ExploreScope;
  onScope?: (scope: ExploreScope) => void;
  kinds: ExploreKind[];
  counts: Partial<Record<ExploreKind, number>> | null;
  cases: number;
  watches: number;
  spotlight: ExploreSpotlight | null;
  onSpotlight: (next: ExploreSpotlight | null) => void;
  words: ExploreWords;
  /** Save and the view's menu (the Explore page only): at the end of the bar. */
  actions?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const light = (what: ExploreSpotlight) => onSpotlight(spotlight === what ? null : what);
  const hint = (what: ExploreSpotlight, on: string) => (spotlight === what ? t("explore.spotlightClear") : on);
  return (
    <header className="@container/topbar shrink-0 border-b-2 border-border bg-background" data-testid="explore-top-bar">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 @4xl/topbar:h-14 @4xl/topbar:flex-nowrap @4xl/topbar:py-0 @4xl/topbar:pr-2 @4xl/topbar:pl-4">
        {title && (
          <div className="flex min-w-0 items-center gap-2.5 @4xl/topbar:max-w-[40%]">
            <Compass className="size-4 shrink-0" aria-hidden />
            <h1 className="min-w-0 truncate font-serif text-[17px] font-black tracking-[0.03em] uppercase">{title}</h1>
          </div>
        )}

        {counts && (
          <div
            role="group"
            aria-label={t("explore.ledger")}
            className="flex h-9 max-w-full shrink-0 items-stretch overflow-x-auto rounded-[4px] border-2 border-border bg-card"
            data-testid="explore-ledger"
          >
            {kinds.map((kind) => (
              <Counter
                key={kind}
                testId={`counter-${kind}`}
                glyph={<KindLine kind={kind} />}
                value={counts[kind] ?? 0}
                label={words.kinds[kind]}
                hint={hint(kind, t(`explore.kindHint.${kind}` as TranslationKey))}
                active={spotlight === kind}
                onToggle={() => light(kind)}
              />
            ))}
            {cases > 0 && (
              <Counter
                testId="counter-cases"
                glyph={<Briefcase className="size-3.5 shrink-0" aria-hidden />}
                value={cases}
                label={t("explore.inCases")}
                hint={hint("cases", t("explore.inCasesHint"))}
                active={spotlight === "cases"}
                onToggle={() => light("cases")}
              />
            )}
            {watches > 0 && (
              <Counter
                testId="counter-watches"
                glyph={<Eye className="size-3.5 shrink-0" aria-hidden />}
                value={watches}
                label={t("explore.watched")}
                hint={hint("watches", t("explore.watchedHint"))}
                active={spotlight === "watches"}
                onToggle={() => light("watches")}
              />
            )}
          </div>
        )}

        <div className="ml-auto flex min-w-0 items-center gap-2">
          {scope && onScope && <ScopeSelect scope={scope} onScope={onScope} />}
          {trail}
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </div>
      </div>
    </header>
  );
}

/** All connections, those that stay inside the source, or those that leave it. */
function ScopeSelect({ scope, onScope }: { scope: ExploreScope; onScope: (scope: ExploreScope) => void }) {
  const { t } = useTranslation();
  return (
    <Select value={scope} onValueChange={(next) => onScope(next as ExploreScope)}>
      <SelectTrigger
        className="h-9 w-[170px] shrink-0 rounded-[4px] border-2 border-border"
        aria-label={t("explore.scope.label")}
        data-testid="explore-scope"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {EXPLORE_SCOPES.map((value) => (
          <SelectItem key={value} value={value} data-testid={`explore-scope-${value}`}>
            <span className="flex flex-col">
              <span>{t(`explore.scope.${value}` as TranslationKey)}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Where diving in has led, top right: the level before this one and this
 * one; every level further back sits behind the ellipsis, which lists them
 * all. Dives can go deep, and a full trail would push everything else off
 * the bar.
 */
export function ExploreTrail({
  levels,
  current,
  onBack,
}: {
  levels: string[];
  current: string;
  onBack: (index: number) => void;
}) {
  const { t } = useTranslation();
  const last = levels.length - 1;
  const hidden = levels.slice(0, Math.max(0, last));
  const crumb = "max-w-[10rem] truncate font-mono text-[11px] tracking-[0.08em] uppercase hover:text-foreground";
  return (
    <Breadcrumb aria-label={t("explore.trail")} className="min-w-0" data-testid="explore-trail">
      <BreadcrumbList className="flex-nowrap text-sm">
        {hidden.length > 0 && (
          <>
            <BreadcrumbItem className="shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="inline-flex size-7 items-center justify-center rounded-[4px] hover:bg-muted"
                  aria-label={t("explore.trailEarlier")}
                  title={t("explore.trailEarlier")}
                  data-testid="explore-trail-more"
                >
                  <BreadcrumbEllipsis className="size-7" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-w-80">
                  {hidden.map((label, i) => (
                    <DropdownMenuItem key={i} onSelect={() => onBack(i)}>
                      <span className="truncate">{label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </>
        )}
        <BreadcrumbItem className="shrink-0">
          <button type="button" onClick={() => onBack(last)} className={crumb} title={t("explore.diveOut", { name: levels[last] ?? "" })}>
            {levels[last]}
          </button>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbPage className="block max-w-[16rem] truncate font-mono text-[11px] font-bold tracking-[0.08em] uppercase" title={current}>
            {current}
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/** The strip on the right edge: one button per panel, and the fold, as on the case board. */
export function ExploreRail({
  drawer,
  onDrawer,
  suggestions,
  marks,
  hide = [],
}: {
  /** Panels this place has no use for. */
  hide?: ExploreDrawer[];
  drawer: ExploreDrawer | null;
  onDrawer: (next: ExploreDrawer | null) => void;
  suggestions: number;
  marks: number;
}) {
  const { t } = useTranslation();
  const last = React.useRef<ExploreDrawer>("find");
  React.useEffect(() => {
    if (drawer) last.current = drawer;
  }, [drawer]);
  const entries: Array<{ kind: ExploreDrawer; icon: LucideIcon; label: string; badge?: number }> = [
    { kind: "find", icon: Search, label: t("explore.drawer.find") },
    { kind: "suggestions", icon: Compass, label: t("explore.drawer.suggestions"), badge: suggestions },
    { kind: "details", icon: Info, label: t("explore.drawer.details") },
    { kind: "marks", icon: Briefcase, label: t("explore.drawer.marks"), badge: marks },
  ];
  const button = (entry: (typeof entries)[number]) => {
    const active = drawer === entry.kind;
    return (
      <Tooltip key={entry.kind}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onDrawer(active ? null : entry.kind)}
            aria-pressed={active}
            aria-label={entry.label}
            data-testid={`explore-rail-${entry.kind}`}
            className={cn(
              "relative inline-flex size-8 items-center justify-center rounded-[4px] border-2 transition-colors",
              active
                ? "border-foreground bg-foreground text-background"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            <entry.icon className="size-4" aria-hidden />
            {entry.badge !== undefined && entry.badge > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-4 rounded-[3px] bg-accent px-1 font-mono text-[9px] leading-4 text-accent-foreground">
                {entry.badge > 99 ? "99+" : entry.badge}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">{entry.label}</TooltipContent>
      </Tooltip>
    );
  };
  return (
    <nav
      className="flex w-11 shrink-0 flex-col items-center gap-1 border-l-2 border-border bg-background py-2"
      aria-label={t("explore.rail")}
      data-testid="explore-rail"
    >
      {entries.filter((e) => !hide.includes(e.kind)).map(button)}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onDrawer(drawer ? null : last.current)}
            aria-label={drawer ? t("explore.railCollapse") : t("explore.railExpand")}
            aria-expanded={!!drawer}
            className="mt-auto inline-flex size-8 items-center justify-center rounded-[4px] border-2 border-transparent text-muted-foreground hover:border-border hover:text-foreground"
          >
            {drawer ? <PanelRightClose className="size-4" aria-hidden /> : <PanelRightOpen className="size-4" aria-hidden />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">{drawer ? t("explore.railCollapse") : t("explore.railExpand")}</TooltipContent>
      </Tooltip>
    </nav>
  );
}

/** A side panel's frame: title and close, the case board's. */
export function DrawerFrame({
  title,
  onClose,
  onBack,
  backLabel,
  children,
}: {
  title: string;
  onClose: () => void;
  /** Back to the list a detail was opened from, in the same panel. */
  onBack?: () => void;
  backLabel?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <aside className="flex h-full w-[360px] max-w-[85vw] shrink-0 flex-col border-l-2 border-border bg-background max-lg:absolute max-lg:inset-y-0 max-lg:right-11 max-lg:z-20" aria-label={title} data-testid="explore-drawer">
      <header className="flex h-11 shrink-0 items-center gap-1 border-b-2 border-border pr-1.5 pl-4">
        {onBack && (
          <button
            type="button"
            className="-ml-2 inline-flex size-8 items-center justify-center rounded-[4px] hover:bg-muted"
            onClick={onBack}
            aria-label={backLabel}
            title={backLabel}
            data-testid="explore-drawer-back"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </button>
        )}
        <h2 className="min-w-0 flex-1 truncate font-serif text-sm font-black tracking-[0.03em] uppercase">{title}</h2>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-[4px] hover:bg-muted"
          onClick={onClose}
          aria-label={t("explore.railCollapse")}
          title={t("explore.railCollapse")}
        >
          <PanelRightClose className="size-4" aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className={MICRO}>{title}</p>
        {aside && <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * The View popover, bottom left as on the case board: which view, how far
 * and which way to trace, and the kinds drawn when chosen by hand.
 */
export function ExploreViewPopover({
  view,
  kinds,
  custom,
  counts,
  depth,
  direction,
  words,
  onView,
  onKinds,
  onDepth,
  onDirection,
}: {
  view: ExploreViewName | null;
  kinds: ReadonlySet<ExploreKind>;
  /** Kinds were chosen by hand. */
  custom: boolean;
  counts: Record<ExploreViewName, number> | null;
  depth: number;
  direction: TraceDirection;
  words: ExploreWords;
  onView: (view: ExploreViewName) => void;
  onKinds: (kinds: ExploreKind[]) => void;
  onDepth: (depth: number) => void;
  onDirection: (direction: TraceDirection) => void;
}) {
  const { t } = useTranslation();
  const toggle = (kind: ExploreKind) => {
    const next = kinds.has(kind) ? [...kinds].filter((k) => k !== kind) : [...kinds, kind];
    onKinds(next.length ? next : [kind]);
  };
  const traced = kinds.has("lineage") || kinds.has("links");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-11 max-w-full items-center gap-2 rounded-[6px] border-2 border-border bg-card px-3 text-sm font-medium"
          data-testid="explore-view-trigger"
          aria-label={t("explore.view.title")}
        >
          <Eye className="size-4" aria-hidden />
          <span>{custom ? t("explore.view.custom") : view ? t(`explore.views.${view}` as TranslationKey) : t("explore.view.title")}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="max-h-[70vh] w-80 space-y-4 overflow-y-auto p-4">
        <Section title={t("explore.view.show")}>
          <div className="grid gap-1.5" role="radiogroup" aria-label={t("explore.view.show")}>
            {EXPLORE_VIEWS.map((v) => {
              const on = !custom && view === v;
              return (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onView(v)}
                  data-testid={`view-${v}`}
                  className={cn(
                    "flex items-center gap-2 rounded-[4px] border-2 px-2 py-1.5 text-left text-xs transition-colors",
                    on ? "border-foreground bg-card text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="flex shrink-0 flex-col gap-0.5">
                    {VIEW_KINDS[v].map((k) => (
                      <KindLine key={k} kind={k} muted={!on} />
                    ))}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{t(`explore.views.${v}` as TranslationKey)}</span>
                    <span className="block text-[11px] leading-snug text-muted-foreground">
                      {t(`explore.viewHints.${v}` as TranslationKey)}
                    </span>
                  </span>
                  {counts && <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{counts[v]}</span>}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title={t("explore.view.trace")}>
          <DirectionSwitch value={direction} onChange={onDirection} />
          <HopLadder<number>
            value={depth}
            label={t("explore.view.trace")}
            disabled={!traced}
            options={[
              { value: 1, label: "1" },
              { value: 2, label: "2" },
              { value: 3, label: "3" },
              { value: 4, label: "4" },
              { value: 6, label: "∞" },
            ]}
            onChange={onDepth}
          />
          <p className="text-[11px] text-muted-foreground">{t("explore.view.traceHint")}</p>
        </Section>

        <Section title={t("explore.view.kinds")}>
          <div className="grid grid-cols-2 gap-1.5">
            {EXPLORE_KINDS.map((kind) => {
              const on = kinds.has(kind);
              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(kind)}
                  title={t(`explore.kindHint.${kind}` as TranslationKey)}
                  data-testid={`kind-${kind}`}
                  className={cn(
                    "flex items-center gap-2 rounded-[4px] border-2 px-2 py-1.5 text-left text-xs transition-colors",
                    on ? "border-foreground bg-card text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{words.kinds[kind]}</span>
                  <KindLine kind={kind} muted={!on} />
                </button>
              );
            })}
          </div>
        </Section>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The guide, top centre of the canvas: what this view shows, and the other
 * views that have something for these starting points.
 */
export function ExploreGuide({
  text,
  offers,
  onView,
}: {
  text: string;
  offers: Array<{ view: ExploreViewName; count: number }>;
  onView: (view: ExploreViewName) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="pointer-events-auto flex max-w-[720px] flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[6px] border-2 border-foreground bg-card px-3 py-1.5 text-xs"
      role="status"
      data-testid="explore-guide"
    >
      <span className="min-w-0">{text}</span>
      {offers.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">{t("explore.guide.also")}</span>
          {offers.map((o) => (
            <Button
              key={o.view}
              size="sm"
              variant="outline"
              className="h-6 rounded-[4px] border-2 px-2 font-mono text-[10px] tracking-[0.06em] uppercase"
              onClick={() => onView(o.view)}
              data-testid={`guide-${o.view}`}
            >
              {t(`explore.views.${o.view}` as TranslationKey)} {o.count}
            </Button>
          ))}
        </span>
      )}
    </div>
  );
}
