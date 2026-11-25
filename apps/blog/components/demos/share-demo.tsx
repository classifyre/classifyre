"use client";

import { cn } from "@workspace/ui/lib/utils";

import type { Locale } from "@/lib/locale";
import {
  Caret,
  DemoFrame,
  step,
  typed,
  typedEnd,
  useTimeline,
} from "@/components/demos/timeline";

/**
 * Visual data-request canvas flow:
 * 1. Two catalog table cards (`crm.public.customers` and `lake.sales.orders`)
 *    appear with column lists (no rows exposed) and ticked output fields.
 * 2. A string connector links `customers.id` ↔ `orders.customer_id` (INNER JOIN).
 * 3. Deterministic SQL writes itself live on the SQL tape below the canvas.
 * 4. The request routes to the Finance data team and lands as a case-file
 *    stamp ("Delivered v1") pointing to the governed shared dataset.
 */

const SQL_LINES = [
  "SELECT c.email, c.region, o.order_total",
  "FROM crm.public.customers c",
  "INNER JOIN lake.sales.orders o",
  "  ON c.id = o.customer_id",
  "WHERE o.status = 'paid'",
] as const;

const DATASET_NAME = "shared.sales.customer_orders";
const CPS = 54;

const L = {
  en: {
    title: "Cases · Data request · Customer revenue",
    columnsOnly: "locked · columns only",
    joinBadge: "INNER",
    joinAria: "Inner join from crm.public.customers.id to lake.sales.orders.customer_id",
    maskedTag: "hashed",
    filterTag: "= 'paid'",
    sqlTape: "Live SQL · generated from canvas",
    routed: "Routed to Finance data team",
    audience: "Audience · Regional sales",
    floor: "Inherited floor: c.email hashed · full_name excluded",
    delivered: "Delivered v1",
  },
  de: {
    title: "Fälle · Datenanfrage · Kundenumsatz",
    columnsOnly: "gesperrt · nur Spalten",
    joinBadge: "INNER",
    joinAria: "Inner Join von crm.public.customers.id auf lake.sales.orders.customer_id",
    maskedTag: "gehasht",
    filterTag: "= 'paid'",
    sqlTape: "Live-SQL · vom Canvas erzeugt",
    routed: "An Finance-Datenteam geroutet",
    audience: "Zielgruppe · Vertrieb Regionen",
    floor: "Vererbte Untergrenze: c.email gehasht · full_name ausgeschlossen",
    delivered: "Ausgeliefert v1",
  },
} as const;

interface ColumnSpec {
  name: string;
  key?: boolean;
  tickAt?: number;
  tag?: "masked" | "filter";
}

const LEFT_COLUMNS: readonly ColumnSpec[] = [
  { name: "id", key: true },
  { name: "email", tickAt: 980, tag: "masked" },
  { name: "region", tickAt: 1180 },
  { name: "full_name" },
];

const RIGHT_COLUMNS: readonly ColumnSpec[] = [
  { name: "customer_id", key: true },
  { name: "order_total", tickAt: 1380 },
  { name: "status", tickAt: 1520, tag: "filter" },
  { name: "internal_note" },
];

/** Shared catalog table card used on both sides of the visual join canvas. */
function DemoTableCard({
  sqlName,
  alias,
  columnsOnlyLabel,
  columns,
  side,
  t,
  opacity,
  joinActive,
  maskedTag,
  filterTag,
}: {
  sqlName: string;
  alias: string;
  columnsOnlyLabel: string;
  columns: readonly ColumnSpec[];
  side: "left" | "right";
  t: number;
  opacity: number;
  joinActive: boolean;
  maskedTag: string;
  filterTag: string;
}) {
  return (
    <div
      className="min-w-0 border-2 border-[#0a0a0a] bg-white shadow-[3px_3px_0_#0a0a0a]"
      style={{ opacity }}
    >
      <div className="flex flex-wrap items-center justify-between gap-1 border-b-2 border-[#0a0a0a] bg-[#0a0a0a] px-2.5 py-1.5 text-white">
        <span className="truncate font-mono text-[11px] font-bold">
          {sqlName}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-accent">
          {alias}
        </span>
      </div>
      <div className="border-b border-[#0a0a0a]/15 bg-[#f6f6f6] px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-[#0a0a0a]/60">
        {columnsOnlyLabel}
      </div>
      <ul className="divide-y divide-[#0a0a0a]/10">
        {columns.map((col) => {
          const ticked = col.tickAt !== undefined && t >= col.tickAt;
          const joined = Boolean(col.key) && joinActive;
          const keyDot = (
            <span
              aria-hidden="true"
              className={cn(
                "size-2.5 shrink-0 rounded-full border-2 border-[#0a0a0a] transition-colors duration-200",
                joined ? "bg-accent" : "bg-white",
              )}
            />
          );
          const checkbox = (
            <span
              aria-hidden="true"
              className={cn(
                "flex size-3.5 shrink-0 items-center justify-center border text-[9px] font-bold transition-colors duration-200",
                col.tickAt === undefined
                  ? "border-[#0a0a0a]/20 bg-transparent text-transparent"
                  : ticked
                    ? "border-[#0a0a0a] bg-accent text-[#0a0a0a]"
                    : "border-[#0a0a0a]/40 bg-white text-transparent",
              )}
            >
              ✓
            </span>
          );
          return (
            <li
              key={col.name}
              className={cn(
                "flex items-center justify-between gap-2 px-2.5 py-1.5 font-mono text-[11px]",
                joined && "bg-accent/25",
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {side === "right" && col.key ? keyDot : checkbox}
                <span
                  className={cn(
                    "truncate",
                    col.tickAt === undefined && !col.key
                      ? "text-[#0a0a0a]/40 line-through"
                      : "font-medium text-[#0a0a0a]",
                  )}
                >
                  {col.name}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {col.tag === "masked" ? (
                  <span className="border border-[#0a0a0a]/35 bg-[#f6f6f6] px-1 py-px font-mono text-[9px] uppercase tracking-[0.08em] text-[#0a0a0a]/75">
                    {maskedTag}
                  </span>
                ) : null}
                {col.tag === "filter" ? (
                  <span
                    className="shrink-0 border border-[#0a0a0a] bg-accent/55 px-1 py-px font-mono text-[9px] font-semibold text-[#0a0a0a]"
                    style={{ opacity: ticked ? 1 : 0.25 }}
                  >
                    {filterTag}
                  </span>
                ) : null}
                {side === "left" && col.key ? keyDot : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Highlight SQL keywords cleanly on the live tape. */
function SqlLine({ text }: { text: string }) {
  const parts = text.split(/(\b(?:SELECT|FROM|INNER JOIN|ON|WHERE)\b)/);
  return (
    <>
      {parts.map((part, i) =>
        /^(SELECT|FROM|INNER JOIN|ON|WHERE)$/.test(part) ? (
          <span key={i} className="font-bold text-[#0a0a0a]">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function ShareDemo({ locale, caption }: { locale: Locale; caption?: string }) {
  const l = L[locale];

  const leftCardAt = 150;
  const rightCardAt = 320;
  const joinAt = 560;
  const sqlStart = 1660;

  let cursor = sqlStart;
  const sqlLines = SQL_LINES.map((line) => {
    const start = cursor;
    cursor = typedEnd(line, start, CPS) + 70;
    return { line, start, end: typedEnd(line, start, CPS) };
  });

  const routeAt = cursor + 220;
  const deliveredAt = routeAt + 760;
  const timeline = useTimeline(deliveredAt + 1500);
  const { t } = timeline;

  const leftOpacity = step(t, leftCardAt, 280);
  const rightOpacity = step(t, rightCardAt, 280);
  const joinProgress = step(t, joinAt, 460);
  const routedProgress = step(t, routeAt, 280);
  const deliveredProgress = step(t, deliveredAt, 260);

  // Path length of the curved connector `M 6 38 C 28 38, 36 38, 58 38` plus gentle arch.
  const connectorLength = 74;

  return (
    <DemoFrame timeline={timeline} title={l.title} caption={caption} locale={locale}>
      {/* Visual join canvas */}
      <div
        className="border-2 border-[#0a0a0a] bg-[#f7f7f5] p-3"
        style={{
          backgroundImage:
            "radial-gradient(rgba(10, 10, 10, 0.14) 1px, transparent 1px)",
          backgroundSize: "14px 14px",
        }}
      >
        <div className="grid items-stretch gap-3 sm:grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] sm:gap-0">
          {/* Left table card: crm.public.customers */}
          <DemoTableCard
            sqlName="crm.public.customers"
            alias="c"
            columnsOnlyLabel={l.columnsOnly}
            columns={LEFT_COLUMNS}
            side="left"
            t={t}
            opacity={leftOpacity}
            joinActive={joinProgress > 0.08}
            maskedTag={l.maskedTag}
            filterTag={l.filterTag}
          />

          {/* Animated SVG string connector between customers.id <-> orders.customer_id */}
          <div className="relative flex items-center justify-center sm:flex-col sm:justify-start sm:pt-[48px]">
            <svg
              viewBox="0 0 64 46"
              className="hidden h-[46px] w-[64px] overflow-visible sm:block"
              role="img"
              aria-label={l.joinAria}
            >
              <path
                d="M 2 22 C 20 8, 44 8, 62 22"
                fill="none"
                stroke="#0a0a0a"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeDasharray={connectorLength}
                strokeDashoffset={(1 - joinProgress) * connectorLength}
              />
              <circle
                cx="2"
                cy="22"
                r="3.5"
                fill={joinProgress > 0.05 ? "var(--accent, #c7ff2e)" : "#ffffff"}
                stroke="#0a0a0a"
                strokeWidth="2"
              />
              <circle
                cx="62"
                cy="22"
                r="3.5"
                fill={joinProgress > 0.9 ? "var(--accent, #c7ff2e)" : "#ffffff"}
                stroke="#0a0a0a"
                strokeWidth="2"
              />
            </svg>
            <span
              className="border border-[#0a0a0a] bg-accent px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#0a0a0a] sm:-mt-3"
              style={{ opacity: step(t, joinAt + 220, 220) }}
            >
              {l.joinBadge}
            </span>
          </div>

          {/* Right table card: lake.sales.orders */}
          <DemoTableCard
            sqlName="lake.sales.orders"
            alias="o"
            columnsOnlyLabel={l.columnsOnly}
            columns={RIGHT_COLUMNS}
            side="right"
            t={t}
            opacity={rightOpacity}
            joinActive={joinProgress > 0.85}
            maskedTag={l.maskedTag}
            filterTag={l.filterTag}
          />
        </div>
      </div>

      {/* Live SQL tape */}
      <div className="mt-3 border-2 border-[#0a0a0a] bg-[#f6f6f6]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#0a0a0a]/20 px-3 py-1.5">
          <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-[#0a0a0a]/60">
            {l.sqlTape}
          </span>
          <span
            className="font-mono text-[10.5px] font-semibold text-[#0a0a0a]"
            style={{ opacity: deliveredProgress }}
          >
            {DATASET_NAME}
          </span>
        </div>
        <pre className="min-h-[108px] overflow-x-auto px-3 py-2 font-mono text-[11.5px] leading-[1.65] text-[#0a0a0a]/85">
          {sqlLines.map(({ line, start, end }, i) => {
            const text = typed(line, t, start, CPS);
            const active = t >= start && t < end + 70;
            const tail = i === sqlLines.length - 1 && t >= end && t < routeAt;
            return (
              <div key={line}>
                {text ? <SqlLine text={text} /> : "\u00a0"}
                <Caret on={active || tail} />
              </div>
            );
          })}
        </pre>
      </div>

      {/* Routing status chip + case-file Delivered stamp */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1.5" style={{ opacity: routedProgress }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 border border-[#0a0a0a] bg-white px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#0a0a0a]">
              <span aria-hidden="true" className="size-2 rounded-full bg-accent ring-1 ring-[#0a0a0a]" />
              {l.routed}
            </span>
            <span className="font-mono text-[10.5px] text-[#0a0a0a]/65">
              {l.audience}
            </span>
          </div>
          <p className="border-l-4 border-accent pl-2.5 font-mono text-[10.5px] leading-4 text-[#0a0a0a]/75">
            {l.floor}
          </p>
        </div>

        <span
          className="inline-flex shrink-0 items-center border-2 border-[#0a0a0a] bg-accent px-3 py-1.5 font-mono text-[11px] font-black uppercase tracking-[0.2em] text-[#0a0a0a] shadow-[2px_2px_0_#0a0a0a]"
          style={{
            opacity: deliveredProgress,
            transform: `rotate(-2deg) scale(${1.12 - 0.12 * deliveredProgress})`,
          }}
        >
          {l.delivered}
        </span>
      </div>
    </DemoFrame>
  );
}
