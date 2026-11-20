"use client";

import * as React from "react";

import { cn } from "@workspace/ui/lib/utils";

import { getLandingCopy } from "@/content/landing";
import { maskValue, sampleHash, sampleRows } from "@/content/sample-data";
import type { Locale } from "@/lib/locale";
import { Micro } from "@/components/landing/motifs";
import { typed, typedEnd, useTimeline } from "@/components/demos/timeline";

/**
 * The differentiator: the same query, run by two people, in the case-file
 * look of the rest of the page (file tabs, paper results on the black band).
 *
 * Four tabs (SELECT, WHERE, JOIN, GROUP BY) show the one property that
 * makes the masks trustworthy: they apply inside the query. A filter on
 * the clear IBAN finds nothing for the masked reader; the hashed e-mail
 * still joins; a count is the same for both. Results are computed from the
 * same invented rows as the hero, with the same mask functions.
 */

type Cell = { text: string; cleared?: boolean; masked?: boolean };
type Result = { columns: string[]; rows: Cell[][] };
type Variant = {
  sql: string;
  masked: Result;
  clear: Result;
};

/** Support tickets per customer, by row position. */
const TICKETS = [3, 1, 2];

function buildVariants(locale: Locale): Record<string, Variant> {
  const all = sampleRows(locale);
  const rows = all.slice(0, 3);
  const ibanPrefix = (rows[0]?.iban ?? "").slice(0, 4);
  const clear = (text: string): Cell => ({ text, cleared: true });
  const plain = (text: string): Cell => ({ text });
  const masked = (text: string): Cell => ({ text, masked: true });

  return {
    select: {
      sql: "SELECT name, iban, city\nFROM crm.customers\nLIMIT 3;",
      masked: {
        columns: ["name", "iban", "city"],
        rows: rows.map((r) => [
          masked(maskValue("redact", r.name)),
          masked(maskValue("partial", r.iban)),
          plain(r.city),
        ]),
      },
      clear: {
        columns: ["name", "iban", "city"],
        rows: rows.map((r) => [clear(r.name), clear(r.iban), plain(r.city)]),
      },
    },
    where: {
      sql: `SELECT name, city\nFROM crm.customers\nWHERE iban LIKE '${ibanPrefix}%';`,
      masked: { columns: ["name", "city"], rows: [] },
      clear: {
        columns: ["name", "city"],
        rows: rows
          .filter((r) => r.iban.startsWith(ibanPrefix))
          .map((r) => [clear(r.name), plain(r.city)]),
      },
    },
    join: {
      sql: "SELECT c.email, count(*) AS tickets\nFROM crm.customers c\nJOIN support.tickets t ON t.email = c.email\nGROUP BY c.email;",
      masked: {
        columns: ["email", "tickets"],
        rows: rows.map((r) => [
          masked(sampleHash(r.email)),
          plain(String(TICKETS[rows.indexOf(r)] ?? 0)),
        ]),
      },
      clear: {
        columns: ["email", "tickets"],
        rows: rows.map((r, i) => [clear(r.email), plain(String(TICKETS[i] ?? 0))]),
      },
    },
    group: {
      sql: "SELECT city, count(DISTINCT email) AS customers\nFROM crm.customers\nGROUP BY city;",
      masked: {
        columns: ["city", "customers"],
        rows: all.map((r) => [plain(r.city), plain("1")]),
      },
      clear: {
        columns: ["city", "customers"],
        rows: all.map((r) => [plain(r.city), plain("1")]),
      },
    },
  };
}

const VARIANTS: Record<Locale, Record<string, Variant>> = {
  en: buildVariants("en"),
  de: buildVariants("de"),
};

const CPS = 55;

/**
 * The panel plays itself: each query is typed, run, and answered for both
 * readers, then the next one starts. The tabs are its chapters: clicking
 * one jumps there and the tour carries on from it.
 */
export function ReadersPanel({ locale }: { locale: Locale }) {
  const r = getLandingCopy(locale).readers;
  const labels = locale === "de" ? { run: "Ausführen" } : { run: "Run" };

  // The script: one segment per query.
  const variants = VARIANTS[locale];
  const segments = r.variants.map((v) => variants[v.id] ?? variants.select!);
  const starts: number[] = [];
  let cursor = 0;
  const plan = segments.map((variant) => {
    const start = cursor;
    starts.push(start);
    const typeAt = start + 250;
    const runAt = typedEnd(variant.sql, typeAt, CPS) + 350;
    const resultAt = runAt + 450;
    cursor = resultAt + 2900;
    return { variant, typeAt, runAt, resultAt };
  });
  const timeline = useTimeline(cursor - 1, 0);
  const { t } = timeline;
  let index = 0;
  starts.forEach((start, i) => {
    if (t >= start) index = i;
  });
  const step = plan[index]!;
  const meta = r.variants[index] ?? r.variants[0]!;
  const tabRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const go = (next: number) => {
    timeline.seek(starts[next] ?? 0);
  };

  const onKey = (event: React.KeyboardEvent, i: number) => {
    const count = r.variants.length;
    let next = -1;
    if (event.key === "ArrowRight") next = (i + 1) % count;
    if (event.key === "ArrowLeft") next = (i - 1 + count) % count;
    if (next < 0) return;
    event.preventDefault();
    go(next);
    tabRefs.current[next]?.focus();
  };

  const shown = t >= step.resultAt;
  const sql = typed(step.variant.sql, t, step.typeAt, CPS);
  const typing = t >= step.typeAt && t < step.runAt;

  return (
    <div ref={timeline.ref}>
      <div className="border-2 border-white/20 bg-white/[0.03]">
        <div role="tablist" aria-label="SQL" className="flex flex-wrap">
          {r.variants.map((v, i) => (
            <button
              key={v.id}
              ref={(node) => {
                tabRefs.current[i] = node;
              }}
              id={`readers-tab-${v.id}`}
              role="tab"
              type="button"
              aria-selected={index === i}
              aria-controls="readers-panel"
              tabIndex={index === i ? 0 : -1}
              onClick={() => go(i)}
              onKeyDown={(event) => onKey(event, i)}
              className={cn(
                "relative overflow-hidden border-2 border-b-0 border-white/20 px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] transition-colors duration-300",
                index === i ? "border-accent bg-accent text-black" : "bg-white/5 text-white/60 hover:text-white",
              )}
            >
              {v.label}
              {/* How far this chapter has played. */}
              {index === i && !timeline.reduced ? (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-0 h-0.5 bg-black/60"
                  style={{
                    width: `${Math.min(100, ((t - (starts[i] ?? 0)) / ((starts[i + 1] ?? cursor) - (starts[i] ?? 0))) * 100)}%`,
                  }}
                />
              ) : null}
            </button>
          ))}
        </div>

        <div
          id="readers-panel"
          role="tabpanel"
          aria-labelledby={`readers-tab-${meta.id}`}
          className="grid gap-px border-t-2 border-white/20 bg-white/20 sm:grid-cols-2"
        >
          <div className="flex min-w-0 items-start justify-between gap-3 bg-[#0a0a0a] p-4 sm:col-span-2">
            <pre className="min-h-[72px] min-w-0 overflow-x-auto font-mono text-[12.5px] leading-6 text-white/85">
              <code>
                {sql || "\u00a0"}
                {typing ? (
                  <span aria-hidden="true" className="cl-caret ml-px inline-block w-[0.55em] bg-white">
                    &nbsp;
                  </span>
                ) : null}
              </code>
            </pre>
            <span
              className={cn(
                "shrink-0 border-2 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] transition-colors duration-200",
                t >= step.runAt ? "border-accent bg-accent text-black" : "border-white/40 text-white/70",
              )}
            >
              ▶ {labels.run}
            </span>
          </div>
          <ReaderResult
            name={r.readers.masked.name}
            role={r.readers.masked.role}
            result={step.variant.masked}
            rowsLabel={r.rowsLabel}
            shown={shown}
          />
          <ReaderResult
            name={r.readers.clear.name}
            role={r.readers.clear.role}
            result={step.variant.clear}
            rowsLabel={r.rowsLabel}
            shown={shown}
            cleared
          />
        </div>
      </div>

      <p
        key={`${meta.id}-${shown}`}
        aria-live="polite"
        className="cl-tag-swap mt-4 min-h-[56px] text-sm leading-7 text-white/85"
      >
        {shown ? meta.note : "\u00a0"}
      </p>
      <Micro className="mt-2 block text-white/50">{r.caption}</Micro>
    </div>
  );
}

function ReaderResult({
  name,
  role,
  result,
  rowsLabel,
  cleared = false,
  shown = true,
}: {
  name: string;
  role: string;
  result: Result;
  rowsLabel: (n: number) => string;
  cleared?: boolean;
  /** False while the query is still being typed or run. */
  shown?: boolean;
}) {
  return (
    <div className="min-w-0 bg-white p-4 text-[#0a0a0a]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b-2 border-[#0a0a0a] pb-2">
        <p className="font-serif text-sm font-black uppercase tracking-[0.04em]">{name}</p>
        <p
          className={cn(
            "whitespace-nowrap px-1.5 font-mono text-[11px]",
            cleared ? "bg-accent text-black" : "border border-[#0a0a0a]/40",
          )}
        >
          {role}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="mt-2 w-full border-collapse text-left font-mono text-[13px]">
          <thead>
            <tr>
              {result.columns.map((col) => (
                <th key={col} scope="col" className="py-1.5 pr-4 font-semibold">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="border-t border-[#0a0a0a]/10 transition-opacity duration-300"
                style={{ opacity: shown ? 1 : 0, transitionDelay: shown ? `${rowIndex * 120}ms` : "0ms" }}
              >
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="whitespace-nowrap py-1.5 pr-4">
                    {cell.text === "****" ? (
                      <>
                        <span aria-hidden="true" className="cl-redacted w-[8ch]" />
                        <span className="sr-only">redacted</span>
                      </>
                    ) : (
                      <span
                        className={cn(
                          cell.cleared && "cl-cleared",
                          cell.masked && "text-[#0a0a0a]/65",
                        )}
                      >
                        {cell.text}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Micro className="mt-3 block text-[#0a0a0a]/55">{shown ? rowsLabel(result.rows.length) : "\u00a0"}</Micro>
    </div>
  );
}
