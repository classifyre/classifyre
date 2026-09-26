"use client";

import "@workspace/case-board/board.css";

import * as React from "react";
import {
  Check,
  Circle,
  Clock3,
  CloudCheck,
  Compass,
  File,
  FileText,
  FlaskConical,
  Frame,
  Globe,
  Hand,
  History,
  Info,
  Link2,
  Lock,
  MessageSquare,
  MousePointer2,
  PanelRightOpen,
  Paperclip,
  Plus,
  Redo2,
  Sparkles,
  SquarePlus,
  StickyNote,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { AssetCircle, codeInk, FindingCircle, SEVERITY_COLOR, type FindingLook } from "@workspace/case-board/components/glyphs";
import { findingCode, type SeverityKey } from "@workspace/case-board/lib/geometry";
import { STANCE_STROKE, TRACE_KIND_STROKE, type Stance, type TraceKind } from "@workspace/case-board/lib/kinds";
import { cn } from "@workspace/ui/lib/utils";

/**
 * The docs' visual key: every look the board uses, drawn by the board's own
 * glyphs, each with a line on what it means.
 */

function KeyGrid({ children }: { children: React.ReactNode }) {
  return <ul className="case-board my-6 grid list-none gap-x-6 gap-y-4 p-0 sm:grid-cols-2">{children}</ul>;
}

function KeyItem({ visual, title, children }: { visual: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="m-0 flex items-center gap-4">
      <span className="flex h-16 w-24 shrink-0 items-center justify-center rounded-[4px] border border-border bg-background">
        {visual}
      </span>
      <span className="min-w-0 text-sm leading-snug">
        <span className="block font-semibold text-foreground">{title}</span>
        <span className="text-muted-foreground">{children}</span>
      </span>
    </li>
  );
}

function Badge({ text, accent, style }: { text: string; accent?: boolean; style: React.CSSProperties }) {
  return (
    <span
      className={cn(
        "absolute rounded-[3px] border-[1.5px] px-1 font-mono text-[10px] font-bold leading-[14px] whitespace-nowrap",
        accent ? "border-[#0a0a0a] bg-accent text-accent-foreground" : "border-foreground bg-card text-foreground",
      )}
      style={style}
    >
      {text}
    </span>
  );
}

/** An asset as the board draws it, shrunk to fit the key. */
function AssetGlyph({
  icon: Icon = File,
  inCase = true,
  ghost = false,
  missing = false,
  selected = false,
  highlight,
  donut,
  dots,
  badge,
  add = false,
}: {
  icon?: LucideIcon;
  inCase?: boolean;
  ghost?: boolean;
  missing?: boolean;
  selected?: boolean;
  highlight?: "yellow" | "blue" | "pink";
  donut?: Array<{ severity: SeverityKey; count: number }>;
  dots?: string[];
  badge?: { text: string; accent?: boolean };
  add?: boolean;
}) {
  return (
    <span className={cn("relative block", ghost && "cb-ghost")} style={{ width: 72, height: 60 }}>
      <svg width={72} height={60} viewBox="-36 -32 72 60" className="absolute inset-0 overflow-visible" aria-hidden>
        <g transform="scale(0.82)">
          <AssetCircle cx={0} cy={0} inCase={inCase} ghost={ghost} missing={missing} selected={selected} highlight={highlight ?? null} donut={donut ?? null} />
        </g>
      </svg>
      <Icon className="absolute size-[15px] text-foreground" style={{ left: 36 - 7.5, top: 32 - 7.5 }} strokeWidth={1.75} aria-hidden />
      {dots && (
        <span className="absolute flex -translate-x-1/2 gap-[3px]" style={{ left: 36, top: 2 }}>
          {dots.map((color) => (
            <span key={color} className="size-2 rounded-full ring-[1.5px] ring-background" style={{ background: color }} />
          ))}
        </span>
      )}
      {badge && <Badge text={badge.text} accent={badge.accent} style={{ left: 48, top: 4 }} />}
      {add && (
        <span
          className="absolute flex size-[16px] items-center justify-center rounded-full border-[1.5px] border-[#0a0a0a] bg-accent text-accent-foreground"
          style={{ left: 46, top: 6 }}
        >
          <Plus className="size-2.5" strokeWidth={3} aria-hidden />
        </span>
      )}
    </span>
  );
}

/** A finding as the board draws it. */
function FindingGlyph({
  severity,
  look = "open",
  detector = "IBAN",
  badge,
}: {
  severity: SeverityKey;
  look?: FindingLook;
  detector?: string;
  badge?: "new" | "check";
}) {
  return (
    <span className="relative block" style={{ width: 40, height: 40 }}>
      <svg width={40} height={40} viewBox="-20 -20 40 40" className="absolute inset-0 overflow-visible" aria-hidden>
        <FindingCircle cx={0} cy={0} severity={severity} look={look} />
      </svg>
      <span
        className="absolute -translate-x-1/2 -translate-y-1/2 font-mono text-[9.5px] font-bold leading-none"
        style={{ left: 20, top: 20.5, color: codeInk(severity, look) }}
      >
        {findingCode(detector, detector)}
      </span>
      {badge === "new" && (
        <span
          className="absolute rounded-[2px] border border-[#0a0a0a] bg-accent px-[3px] font-mono text-[7.5px] font-bold leading-[10px] text-accent-foreground"
          style={{ left: 27, top: 0 }}
        >
          NEW
        </span>
      )}
      {badge === "check" && (
        <span
          className="absolute flex size-3 items-center justify-center rounded-full bg-[var(--cb-supports)] text-white"
          style={{ left: 26, top: 25 }}
        >
          <Check className="size-2" strokeWidth={3.5} aria-hidden />
        </span>
      )}
    </span>
  );
}

export function AssetKey() {
  return (
    <KeyGrid>
      <KeyItem visual={<AssetGlyph />} title="Evidence">
        An asset in the case: its kind icon inside, the lime ring around it, its name underneath.
      </KeyItem>
      <KeyItem visual={<AssetGlyph inCase={false} add />} title="Suggested neighbour">
        Connected to your evidence but not in the case. No ring; point at it and press + to add it.
      </KeyItem>
      <KeyItem visual={<AssetGlyph inCase={false} ghost badge={{ text: "↑2" }} add />} title="Found by Show connections">
        Dashed and faint, with how far away it is: ↑ upstream, ↓ downstream, ≈ alongside.
      </KeyItem>
      <KeyItem visual={<AssetGlyph missing />} title="Deleted at its source">
        Red dashed circle, name struck through. The case keeps what it knew.
      </KeyItem>
      <KeyItem
        visual={
          <AssetGlyph
            donut={[
              { severity: "critical", count: 2 },
              { severity: "high", count: 3 },
              { severity: "low", count: 4 },
            ]}
            badge={{ text: "▸9" }}
          />
        }
        title="Findings folded away"
      >
        A ring of severity colours shows the mix. ▸9 unfolds them.
      </KeyItem>
      <KeyItem visual={<AssetGlyph badge={{ text: "+3", accent: true }} />} title="More on this asset">
        +3: findings of this asset that are not in the case yet. Press it to see them as ghosts.
      </KeyItem>
      <KeyItem visual={<AssetGlyph badge={{ text: "NEW", accent: true }} />} title="New">
        Arrived since you last looked, usually from a watch feeding the case.
      </KeyItem>
      <KeyItem visual={<AssetGlyph dots={["#ef4444", "#3b82f6"]} />} title="Hypothesis dots">
        One dot per hypothesis that cites this evidence, in the hypothesis colour. Click one to focus it.
      </KeyItem>
      <KeyItem visual={<AssetGlyph highlight="yellow" />} title="Highlighted">
        A marker colour you gave it, to group things by eye or filter by later.
      </KeyItem>
      <KeyItem visual={<AssetGlyph selected />} title="Selected">
        A glowing ring. Everything not connected to it fades.
      </KeyItem>
    </KeyGrid>
  );
}

const SEVERITIES: Array<{ key: SeverityKey; label: string }> = [
  { key: "critical", label: "Critical" },
  { key: "high", label: "High" },
  { key: "medium", label: "Medium" },
  { key: "low", label: "Low" },
  { key: "info", label: "Info" },
];

export function SeverityScale() {
  return (
    <div className="case-board my-6 flex flex-wrap gap-x-6 gap-y-3">
      {SEVERITIES.map((s) => (
        <span key={s.key} className="flex items-center gap-2 text-sm">
          <svg width={20} height={20} viewBox="-10 -10 20 20" aria-hidden>
            <circle r={8} fill={SEVERITY_COLOR[s.key]} stroke="var(--foreground)" strokeWidth={1.5} />
          </svg>
          {s.label}
        </span>
      ))}
    </div>
  );
}

export function FindingKey() {
  return (
    <KeyGrid>
      <KeyItem visual={<FindingGlyph severity="critical" />} title="Open">
        Filled with its severity colour. The letters name the detector (IBAN, SSN, ACI…).
      </KeyItem>
      <KeyItem visual={<FindingGlyph severity="high" look="new" badge="new" detector="Person name" />} title="New">
        Brought in by the latest scan of a watch that feeds this case.
      </KeyItem>
      <KeyItem visual={<FindingGlyph severity="medium" look="resolved" badge="check" detector="Phone" />} title="Resolved">
        Hollow, ringed in its colour, with a green tick.
      </KeyItem>
      <KeyItem visual={<FindingGlyph severity="low" look="dismissed" detector="Email" />} title="Dismissed">
        Hollow, grey and dashed: marked a false positive or ignored. Its label is struck through.
      </KeyItem>
      <KeyItem visual={<FindingGlyph severity="high" look="gone" detector="SSN" />} title="Gone from its source">
        A red dashed ring: the latest scan no longer finds it. The case keeps its copy.
      </KeyItem>
      <KeyItem visual={<FindingGlyph severity="critical" look="deleted" detector="Card" />} title="Deleted">
        Faint and dotted: the finding&apos;s record was deleted. The case keeps its snapshot.
      </KeyItem>
      <KeyItem visual={<FindingGlyph severity="medium" look="ghost" detector="Address" />} title="Not in the case">
        A dashed grey ghost with an italic label: on the asset, not attached to the case yet.
      </KeyItem>
    </KeyGrid>
  );
}

const STANCE_ICON = { SUPPORTS: Check, CONTRADICTS: X, NEUTRAL: Circle } as const;

/** A short stretch of one kind of line, with its words along it. */
function LineSample({
  color,
  width = 1.5,
  dash,
  arrow = false,
  text,
  textColor,
  stance,
  icon: Icon,
}: {
  color: string;
  width?: number;
  dash?: string;
  arrow?: boolean;
  text?: string;
  textColor?: string;
  stance?: Stance;
  icon?: LucideIcon;
}) {
  const Glyph = stance ? STANCE_ICON[stance] : null;
  return (
    <span className="relative block" style={{ width: 84, height: 40 }}>
      <svg width={84} height={40} className="absolute inset-0 overflow-visible" aria-hidden>
        <line x1={4} y1={24} x2={arrow ? 74 : 80} y2={24} stroke={color} strokeWidth={width} strokeDasharray={dash} />
        {arrow && <path d="M72,19.5 L81,24 L72,28.5 z" style={{ fill: color }} />}
      </svg>
      {text && (
        <span
          className="cb-edge-text absolute inset-x-0 top-[6px] flex items-center justify-center gap-1 truncate font-mono text-[8.5px] uppercase leading-none tracking-[0.06em]"
          style={{ color: textColor ?? "var(--muted-foreground)" }}
        >
          {text}
          {Icon && <Icon className="size-2.5 shrink-0" aria-hidden />}
        </span>
      )}
      {Glyph && (
        <span
          className="absolute flex size-4 items-center justify-center rounded-full text-white"
          style={{ left: 4, top: 16, background: STANCE_STROKE[stance!].color }}
        >
          <Glyph className="size-2.5" strokeWidth={3} aria-hidden />
        </span>
      )}
    </span>
  );
}

export function LineKey({ only }: { only?: "found" | "drawn" | "stances" | "trace" }) {
  const show = (group: "found" | "drawn" | "stances" | "trace") => !only || only === group;
  return (
    <KeyGrid>
      {show("found") && (
        <>
          <KeyItem visual={<LineSample color="var(--cb-edge)" arrow text="transform" />} title="Lineage">
            Grey, with an arrow the way the data flowed. Its type is written along it.
          </KeyItem>
          <KeyItem visual={<LineSample color="var(--cb-edge)" arrow text="references" />} title="Reference or use">
            One asset mentions, links to, attaches or uses another.
          </KeyItem>
          <KeyItem visual={<LineSample color="var(--cb-edge)" dash="5 4" text="identical_content" />} title="Duplicate">
            Grey dashed, no arrow: the same content found twice.
          </KeyItem>
          <KeyItem visual={<LineSample color="var(--cb-edge)" width={1.25} arrow text="contains" />} title="Contains">
            From an asset to each of its findings.
          </KeyItem>
        </>
      )}
      {show("drawn") && (
        <>
          <KeyItem visual={<LineSample color="var(--cb-manual)" width={2.6} text="related to" textColor="var(--cb-manual)" />} title="A link you drew">
            Amber, with its kind along it. The more confident, the thicker.
          </KeyItem>
          <KeyItem
            visual={<LineSample color="var(--cb-manual)" width={1.9} dash="6 4" text="related to · suspected" textColor="var(--cb-manual)" />}
            title="Suspected"
          >
            Amber dashed: a hunch, not yet confirmed.
          </KeyItem>
          <KeyItem
            visual={<LineSample color="var(--cb-contradicts)" width={2.4} dash="6 4" text="contradicts" textColor="var(--cb-contradicts)" />}
            title="Contradicts"
          >
            Red dashed: two things that cannot both be true.
          </KeyItem>
          <KeyItem visual={<LineSample color="var(--cb-manual)" width={2.6} arrow text="precedes" textColor="var(--cb-manual)" />} title="One-way kinds">
            Precedes, derived from and communicates with read one way, so they carry an arrow.
          </KeyItem>
          <KeyItem
            visual={<LineSample color="var(--cb-manual)" width={2.6} arrow text="precedes" textColor="var(--cb-manual)" icon={Globe} />}
            title="Global relationship"
          >
            A globe: the link is shared with every case and the lineage view.
          </KeyItem>
          <KeyItem visual={<LineSample color="var(--cb-edge)" arrow text="transform" icon={Lock} />} title="Locked">
            Relations the platform found carry a lock on hover: they cannot be deleted from a board.
          </KeyItem>
        </>
      )}
      {show("stances") && (
        <>
          <KeyItem visual={<LineSample color={STANCE_STROKE.SUPPORTS.color} width={2} stance="SUPPORTS" />} title="Supports">
            Green, with a tick at the hypothesis end.
          </KeyItem>
          <KeyItem
            visual={<LineSample color={STANCE_STROKE.CONTRADICTS.color} width={2} dash="6 4" stance="CONTRADICTS" />}
            title="Contradicts"
          >
            Red dashed, with a cross at the hypothesis end.
          </KeyItem>
          <KeyItem visual={<LineSample color={STANCE_STROKE.NEUTRAL.color} width={2} stance="NEUTRAL" />} title="Neutral">
            Grey, with a ring: it bears on the hypothesis without taking a side.
          </KeyItem>
        </>
      )}
      {show("trace") &&
        (
          [
            ["lineage", "Lineage", "Where the data came from and where it went."],
            ["links", "Links", "References, mentions, keys and use."],
            ["duplicates", "Duplicates", "The same content somewhere else."],
            ["similar", "Similar", "Content that overlaps: near neighbours."],
          ] as Array<[TraceKind, string, string]>
        ).map(([kind, title, text]) => (
          <KeyItem
            key={kind}
            visual={<LineSample color={TRACE_KIND_STROKE[kind]} dash="6 4" arrow={kind === "lineage" || kind === "links"} />}
            title={title}
          >
            {text}
          </KeyItem>
        ))}
    </KeyGrid>
  );
}

function DockIcon({ icon: Icon, active, keyHint }: { icon: LucideIcon; active?: boolean; keyHint?: string }) {
  return (
    <span className="flex flex-col items-center gap-1">
      <span
        className={cn(
          "flex size-9 items-center justify-center rounded-[4px] border-2",
          active ? "border-foreground bg-foreground text-background" : "border-transparent",
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      {keyHint && <kbd className="font-mono text-[10px] text-muted-foreground">{keyHint}</kbd>}
    </span>
  );
}

/** The tool dock at the bottom of the board, with each tool's key. */
export function ToolDock() {
  return (
    <div className="my-6 flex justify-center">
      <div className="flex items-start gap-0.5 rounded-[6px] border-2 border-border bg-card p-1" role="img" aria-label="The tool dock">
        <DockIcon icon={MousePointer2} active keyHint="V" />
        <DockIcon icon={Hand} keyHint="H" />
        <DockIcon icon={StickyNote} keyHint="N" />
        <DockIcon icon={Frame} keyHint="F" />
        <DockIcon icon={FlaskConical} keyHint="T" />
        <DockIcon icon={MessageSquare} keyHint="C" />
        <DockIcon icon={Link2} keyHint="L" />
        <span className="mx-1 mt-1.5 h-6 w-px bg-border" aria-hidden />
        <DockIcon icon={Undo2} keyHint="⌘Z" />
        <DockIcon icon={Redo2} keyHint="⇧⌘Z" />
      </div>
    </div>
  );
}

const PANELS: Array<{ icon: LucideIcon; label: string; badge?: number } | "gap"> = [
  { icon: Info, label: "Details" },
  { icon: FlaskConical, label: "Hypotheses" },
  { icon: SquarePlus, label: "Add evidence" },
  "gap",
  { icon: Paperclip, label: "Evidence" },
  { icon: Compass, label: "Leads", badge: 2 },
  { icon: Sparkles, label: "Watches", badge: 5 },
  { icon: Clock3, label: "Timeline" },
  { icon: FileText, label: "Case file" },
  { icon: History, label: "Board snapshots" },
];

/** The rail of side panels on the board's right edge. */
export function PanelRail() {
  return (
    <div className="my-6 flex justify-center">
      <div className="flex items-stretch gap-4 rounded-[4px] border border-border bg-background p-3" role="img" aria-label="The side panel rail">
        <div className="flex w-11 flex-col items-center gap-1 border-l-2 border-border py-1">
          {PANELS.map((entry, i) =>
            entry === "gap" ? (
              <span key={`gap-${i}`} className="my-1 h-0.5 w-5 bg-border" />
            ) : (
              <span key={entry.label} className="relative inline-flex size-8 items-center justify-center text-muted-foreground">
                <entry.icon className="size-4" aria-hidden />
                {entry.badge && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-4 rounded-full bg-accent px-1 text-center font-mono text-[9px] leading-4 text-accent-foreground">
                    {entry.badge}
                  </span>
                )}
              </span>
            ),
          )}
          <span className="mt-2 inline-flex size-8 items-center justify-center text-muted-foreground">
            <CloudCheck className="size-4" aria-hidden />
          </span>
          <span className="inline-flex size-8 items-center justify-center text-muted-foreground">
            <PanelRightOpen className="size-4" aria-hidden />
          </span>
        </div>
        <div className="flex flex-col gap-1 py-1 text-sm">
          {PANELS.map((entry, i) =>
            entry === "gap" ? (
              <span key={`gap-${i}`} className="my-1 h-0.5" />
            ) : (
              <span key={entry.label} className="flex h-8 items-center">
                {entry.label}
              </span>
            ),
          )}
          <span className="mt-2 flex h-8 items-center text-muted-foreground">Saved</span>
          <span className="flex h-8 items-center text-muted-foreground">Show or hide the panel</span>
        </div>
      </div>
    </div>
  );
}
