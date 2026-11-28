"use client";

import "@workspace/case-board/board.css";

import * as React from "react";
import {
  Download,
  EyeOff,
  Grid3x3,
  Hand,
  KeyRound,
  LayoutGrid,
  Link2,
  Lock,
  Map as MapIcon,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  Shield,
  Sparkles,
  Trash2,
} from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";

function KeyGrid({ children }: { children: React.ReactNode }) {
  return (
    <ul className="my-6 grid list-none gap-x-6 gap-y-4 p-0 sm:grid-cols-2">
      {children}
    </ul>
  );
}

function KeyItem({
  visual,
  title,
  children,
}: {
  visual: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="m-0 flex items-center gap-4">
      <span className="flex h-14 w-24 shrink-0 items-center justify-center rounded-[4px] border border-border bg-background px-2">
        {visual}
      </span>
      <span className="min-w-0 text-sm leading-snug">
        <span className="block font-semibold text-foreground">{title}</span>
        <span className="text-muted-foreground">{children}</span>
      </span>
    </li>
  );
}

export function VisualSchemaBadgeKey() {
  return (
    <KeyGrid>
      <KeyItem
        visual={
          <span className="inline-flex items-center gap-1 font-mono text-xs">
            <KeyRound className="size-4 text-[var(--cb-amber)]" />
            <span>id</span>
          </span>
        }
        title="Primary key (PK)"
      >
        Amber key icon from the scanned table catalog. Used by Find Links when matching foreign keys.
      </KeyItem>
      <KeyItem
        visual={
          <span className="inline-flex items-center gap-1 font-mono text-xs">
            <Link2 className="size-4 text-[var(--cb-violet)]" />
            <span>order_id</span>
          </span>
        }
        title="Foreign key (FK)"
      >
        Violet link icon on columns with a scanned foreign-key relationship. Composite PK+FK columns show both.
      </KeyItem>
      <KeyItem
        visual={<Lock className="size-4 text-[var(--cb-amber)]" />}
        title="Locked table"
      >
        You can see the table&apos;s schema in the catalog but cannot query its rows yet. Use Request as dataset to ask a data team.
      </KeyItem>
      <KeyItem
        visual={
          <span className="rounded-xs border border-[var(--cb-amber)]/60 bg-[var(--cb-amber-soft)] px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-foreground">
            Redacted
          </span>
        }
        title="Masked column"
      >
        Governance mask applied when querying (redacted, partial, hashed, empty, or identifiers removed).
      </KeyItem>
      <KeyItem
        visual={
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
            <EyeOff className="size-3.5 text-[var(--cb-amber)]" />
            <span>2 hidden</span>
          </span>
        }
        title="Hidden / restricted columns"
      >
        Only the count is shown — hidden column names never appear on cards, in links, or in exports.
      </KeyItem>
      <KeyItem
        visual={<Shield className="size-4 text-[var(--cb-amber)]" />}
        title="Row filter active"
      >
        A row-level governance rule limits which rows you read. Estimated row counts are omitted on filtered tables.
      </KeyItem>
    </KeyGrid>
  );
}

function JoinLineSample({
  stroke,
  dash,
  label,
  card,
}: {
  stroke: string;
  dash?: string;
  label: string;
  card?: [string, string];
}) {
  return (
    <span className="relative flex w-full flex-col items-center">
      <svg width={80} height={24} viewBox="0 0 80 24" aria-hidden>
        <line
          x1={6}
          y1={14}
          x2={74}
          y2={14}
          stroke={stroke}
          strokeWidth={2}
          strokeDasharray={dash}
        />
        {card && (
          <>
            <text x={8} y={9} fontSize={9} fontWeight={700} fill="var(--foreground)" className="font-mono">
              {card[0]}
            </text>
            <text x={67} y={9} fontSize={9} fontWeight={700} fill="var(--foreground)" className="font-mono">
              {card[1]}
            </text>
          </>
        )}
      </svg>
      <span className="rounded-xs border border-border bg-card px-1 font-mono text-[9px] font-semibold uppercase">
        {label}
      </span>
    </span>
  );
}

export function VisualSchemaEdgeKey() {
  return (
    <KeyGrid>
      <KeyItem
        visual={<JoinLineSample stroke="var(--cb-edge)" label="INNER" card={["N", "1"]} />}
        title="INNER JOIN (declared FK or manual)"
      >
        Solid neutral line with optional cardinality markers (1-1, 1-N, N-1, N-N). Click the pill on any edge to toggle.
      </KeyItem>
      <KeyItem
        visual={<JoinLineSample stroke="var(--cb-edge)" dash="5 4" label="LEFT" card={["1", "N"]} />}
        title="Outer join (LEFT / RIGHT / FULL)"
      >
        Dashed line for outer joins. Switch between INNER, LEFT, RIGHT, and FULL OUTER in the Properties tab.
      </KeyItem>
      <KeyItem
        visual={<JoinLineSample stroke="var(--cb-edge)" dash="2 3" label="INFERRED" />}
        title="Heuristic / inferred link"
      >
        Dotted line when Find Links matched a naming/type pattern such as customer_id → customers.id without a database FK.
      </KeyItem>
      <KeyItem
        visual={<JoinLineSample stroke="var(--cb-select)" label="SELECTED" card={["N", "1"]} />}
        title="Selected or focused join"
      >
        Highlighted in selection lime; unrelated cards and edges dim so you can trace the selected table&apos;s neighbourhood.
      </KeyItem>
    </KeyGrid>
  );
}

export function VisualSchemaControlsKey() {
  return (
    <div className="my-6 flex flex-wrap items-center justify-center gap-6">
      <div className="flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-0.5 rounded-[6px] border-2 border-border bg-card p-1" role="img" aria-label="Floating top-right toolbar">
          {[
            { icon: Grid3x3, label: "Grid", active: true },
            { icon: LayoutGrid, label: "Arrange" },
            { icon: Sparkles, label: "Find links" },
            { icon: Trash2, label: "Clear" },
            { icon: Download, label: "Export / Import" },
          ].map((item) => (
            <span
              key={item.label}
              className={cn(
                "flex size-8 items-center justify-center rounded-[3px]",
                item.active ? "bg-foreground text-background" : "text-foreground",
              )}
              title={item.label}
            >
              <item.icon className="size-4" aria-hidden />
            </span>
          ))}
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">Top-right toolbar</span>
      </div>

      <div className="flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-0.5 rounded-[6px] border-2 border-border bg-card p-1" role="img" aria-label="Bottom-left navigation dock">
          {[
            { icon: Plus, label: "Zoom in" },
            { icon: Minus, label: "Zoom out" },
            { icon: Maximize2, label: "Fit view" },
            { icon: Hand, label: "Pan (P)", active: true },
            { icon: MousePointer2, label: "Select (S)" },
            { icon: MapIcon, label: "Minimap" },
          ].map((item) => (
            <span
              key={item.label}
              className={cn(
                "flex size-8 items-center justify-center rounded-[3px]",
                item.active ? "bg-foreground text-background" : "text-foreground",
              )}
              title={item.label}
            >
              <item.icon className="size-4" aria-hidden />
            </span>
          ))}
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">Zoom, Pan/Select &amp; Minimap dock</span>
      </div>
    </div>
  );
}
