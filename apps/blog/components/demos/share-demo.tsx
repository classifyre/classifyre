"use client";

import { cn } from "@workspace/ui/lib/utils";

import { SAMPLE_ROWS, sampleHash } from "@/content/sample-data";
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
 * Sharing a dataset, played out: a query that joins three systems is
 * typed, saved as a shared dataset with a name, shared with one group as
 * Data reader for 90 days, and the group's first read shows the masks from
 * the input tables came along.
 */

const SQL = [
  "SELECT c.email AS customer, c.city,",
  "  count(o.id) AS orders, sum(i.amount) AS revenue",
  "FROM crm.customers c",
  "JOIN lake.orders o ON o.customer_id = c.id",
  "JOIN finance.invoices i ON i.order_id = o.id",
  "GROUP BY 1, 2;",
];

const NAME = "shared.sales.customer_revenue";
const CPS = 70;

const L = {
  en: {
    title: "Query data · New shared dataset",
    save: "Save as shared dataset",
    saved: "Saved",
    name: "Name",
    share: "Share",
    shared: "Shared",
    group: "Regional sales",
    access: "Data reader · 90 days",
    masks: "Masks kept from the inputs: customer hashed (crm.customers.email)",
    sources: "3 sources",
    preview: "Regional sales reads it",
  },
  de: {
    title: "Daten abfragen · Neues geteiltes Dataset",
    save: "Als geteiltes Dataset speichern",
    saved: "Gespeichert",
    name: "Name",
    share: "Teilen",
    shared: "Geteilt",
    group: "Vertrieb Regionen",
    access: "Data reader · 90 Tage",
    masks: "Masken aus den Eingängen behalten: customer gehasht (crm.customers.email)",
    sources: "3 Quellen",
    preview: "Vertrieb Regionen liest es",
  },
} as const;

export function ShareDemo({ locale, caption }: { locale: Locale; caption?: string }) {
  const l = L[locale];
  let at = 300;
  const lines = SQL.map((line) => {
    const start = at;
    at = typedEnd(line, start, CPS) + 60;
    return { line, start };
  });
  const saveAt = at + 300;
  const nameAt = saveAt + 250;
  const shareAt = typedEnd(NAME, nameAt, 40) + 900;
  const previewAt = shareAt + 700;
  const timeline = useTimeline(previewAt + 1400);
  const { t } = timeline;

  return (
    <DemoFrame timeline={timeline} title={l.title} caption={caption} locale={locale}>
      <pre className="overflow-x-auto border-2 border-[#0a0a0a] bg-[#f6f6f6] p-3 font-mono text-[11.5px] leading-5">
        {lines.map(({ line, start }) => (
          <div key={line}>
            {typed(line, t, start, CPS) || " "}
            <Caret on={t >= start && t < typedEnd(line, start, CPS) + 60} />
          </div>
        ))}
      </pre>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <PressButton t={t} at={saveAt} label={l.save} done={l.saved} />
          <div className="grid grid-cols-[3.5rem_1fr] items-center gap-2" style={{ opacity: step(t, saveAt, 250) }}>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/55">{l.name}</span>
            <span className="min-h-[26px] border border-[#0a0a0a]/30 px-2 py-1 font-mono text-[11.5px]">
              {typed(NAME, t, nameAt, 40)}
              <Caret on={t >= nameAt && t < typedEnd(NAME, nameAt, 40)} />
            </span>
          </div>
        </div>

        <div className="border-2 border-[#0a0a0a] p-2.5" style={{ opacity: step(t, typedEnd(NAME, nameAt, 40), 300) }}>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "border px-2 py-0.5 text-[12px] font-semibold transition-colors",
                t >= shareAt - 500 ? "border-[#0a0a0a] bg-accent/50" : "border-[#0a0a0a]/30",
              )}
            >
              {l.group}
            </span>
            <span className="font-mono text-[11px] text-[#0a0a0a]/65">{l.access}</span>
          </div>
          <div className="mt-2.5">
            <PressButton t={t} at={shareAt} label={l.share} done={`✓ ${l.shared}`} />
          </div>
        </div>
      </div>

      <div className="mt-4" style={{ opacity: step(t, previewAt, 400) }}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-mono text-[11px] font-semibold">{NAME}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/55">
            {l.preview} · {l.sources}
          </span>
        </div>
        <table className="mt-1 w-full border-collapse font-mono text-[11.5px]">
          <tbody>
            {SAMPLE_ROWS.slice(0, 2).map((row, i) => (
              <tr key={row.email} className="border-t border-[#0a0a0a]/10">
                <td className="py-1 pr-3 text-[#0a0a0a]/60">{sampleHash(row.email)}</td>
                <td className="py-1 pr-3">{row.city}</td>
                <td className="py-1 pr-3">{[12, 4][i]}</td>
                <td className="py-1 text-right">{["4,812.40", "1,130.00"][i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 border-l-4 border-accent pl-3 font-mono text-[11px] leading-5">{l.masks}</p>
      </div>
    </DemoFrame>
  );
}
