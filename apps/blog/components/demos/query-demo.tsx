"use client";

import { SourceIcon } from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";

import { sampleHash, sampleRows } from "@/content/sample-data";
import type { Locale } from "@/lib/locale";
import {
  Caret,
  DemoFrame,
  PressButton,
  step,
  typed,
  typedEnd,
  useTimeline,
} from "@/components/demos/timeline";

/**
 * Query across sources, played out: the SQL is typed into the editor, Run
 * is pressed, the query runs next to the data in two systems, and the
 * joined rows come back with the personal column still hashed.
 */

const SQL = [
  "SELECT c.email, c.city, sum(o.amount) AS revenue",
  "FROM crm.customers c",
  "JOIN lake.orders o ON o.customer_id = c.id",
  "GROUP BY 1, 2;",
];

const REVENUE = ["4,812.40", "1,130.00", "2,977.15"];
const TYPE_AT = 400;
const CPS = 42;

const L = {
  en: { title: "Query data", run: "Run", running: "Running on 2 sources", rows: "3 rows · 2 sources joined · email hashed" },
  de: { title: "Daten abfragen", run: "Ausführen", running: "Läuft auf 2 Quellen", rows: "3 Zeilen · 2 Quellen verknüpft · E-Mail gehasht" },
} as const;

/** Keywords drawn bold, the rest as typed. */
function Line({ text }: { text: string }) {
  const parts = text.split(/(\b(?:SELECT|FROM|JOIN|ON|GROUP BY|AS|sum)\b)/);
  return (
    <>
      {parts.map((part, i) =>
        /^(SELECT|FROM|JOIN|ON|GROUP BY|AS|sum)$/.test(part) ? (
          <span key={i} className="font-semibold">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function QueryDemo({ locale, caption }: { locale: Locale; caption?: string }) {
  const l = L[locale];
  let at = TYPE_AT;
  const lines = SQL.map((line) => {
    const start = at;
    at = typedEnd(line, start, CPS) + 120;
    return { line, start };
  });
  const typedDone = at;
  const runAt = typedDone + 400;
  const resultAt = runAt + 1300;
  const timeline = useTimeline(resultAt + 1200);
  const { t } = timeline;
  const crm = t >= lines[1]!.start + 300;
  const lake = t >= lines[2]!.start + 300;

  return (
    <DemoFrame timeline={timeline} title={l.title} caption={caption} locale={locale}>
      <div className="flex flex-wrap items-center gap-2">
        {[
          { source: "postgresql", label: "crm · PostgreSQL", on: crm },
          { source: "s3_compatible_storage", label: "lake · Parquet in S3", on: lake },
        ].map((s) => (
          <span
            key={s.label}
            className={cn(
              "inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[11px] transition-colors duration-300",
              s.on ? "border-[#0a0a0a] bg-accent/50" : "border-[#0a0a0a]/20 text-[#0a0a0a]/50",
            )}
          >
            <SourceIcon source={s.source} size="sm" className="[&_svg]:text-[#0a0a0a]" />
            {s.label}
          </span>
        ))}
        <span className="ml-auto">
          <PressButton t={t} at={runAt} label={`▶ ${l.run}`} />
        </span>
      </div>

      <pre className="mt-3 min-h-[118px] overflow-x-auto border-2 border-[#0a0a0a] bg-[#f6f6f6] p-3 font-mono text-[12.5px] leading-6">
        {lines.map(({ line, start }, i) => {
          const text = typed(line, t, start, CPS);
          const typing = t >= start && t < typedEnd(line, start, CPS) + 120;
          const last = i === lines.length - 1 && t >= typedEnd(line, start, CPS);
          return (
            <div key={line}>
              {text ? <Line text={text} /> : " "}
              <Caret on={typing || (last && t < runAt)} />
            </div>
          );
        })}
      </pre>

      <div className="mt-3 min-h-[24px] font-mono text-[11px] text-[#0a0a0a]/60">
        {t >= runAt && t < resultAt ? (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="cl-spin inline-block size-3 border-2 border-[#0a0a0a] border-t-transparent" />
            {l.running}
          </span>
        ) : null}
        {t >= resultAt ? l.rows : null}
      </div>

      <table className="mt-1 w-full border-collapse text-left font-mono text-[12.5px]">
        <thead>
          <tr className="border-b-2 border-[#0a0a0a]" style={{ opacity: step(t, resultAt, 200) }}>
            {["email", "city", "revenue"].map((c) => (
              <th key={c} className="py-1.5 pr-4 font-semibold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sampleRows(locale).slice(0, 3).map((row, i) => {
            const show = step(t, resultAt + 120 + i * 160, 260);
            return (
              <tr key={row.email} className="border-b border-[#0a0a0a]/10" style={{ opacity: show }}>
                <td className="py-1.5 pr-4 text-[#0a0a0a]/60">{sampleHash(row.email)}</td>
                <td className="py-1.5 pr-4">{row.city}</td>
                <td className="py-1.5">{REVENUE[i]}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </DemoFrame>
  );
}
