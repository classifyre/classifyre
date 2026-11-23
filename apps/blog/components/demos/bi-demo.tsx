"use client";

import { maskValue, sampleRows } from "@/content/sample-data";
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
 * Power BI and Excel, played out: a personal SQL connection is filled in
 * and created, its connection string appears, the report loads through it
 * with the personal columns still masked, and the read lands in the log
 * with the tool's name.
 */

const L = {
  en: {
    title: "SQL connections · New connection",
    fields: [
      ["Name", "Power BI"],
      ["Tables", "crm.customers, sales.orders"],
      ["Expires", "in 90 days"],
    ],
    create: "Create connection",
    created: "Created",
    string: "Server=sql.example.com:5432;Database=finance;User=lena_power_bi;SSL=verify-full",
    report: "Customers report · Lena (EU BI · masked) · via SQL connection Power BI",
    log: "09:14 · Lena read crm.customers via SQL connection Power BI",
  },
  de: {
    title: "SQL-Verbindungen · Neue Verbindung",
    fields: [
      ["Name", "Power BI"],
      ["Tabellen", "crm.customers, sales.orders"],
      ["Läuft ab", "in 90 Tagen"],
    ],
    create: "Verbindung anlegen",
    created: "Angelegt",
    string: "Server=sql.example.at:5432;Database=finance;User=lena_power_bi;SSL=verify-full",
    report: "Kundenbericht · Lena (EU-BI · maskiert) · über SQL-Verbindung Power BI",
    log: "09:14 · Lena las crm.customers über SQL-Verbindung Power BI",
  },
} as const;

/** Bar heights, one per sample row's city. */
const BAR_VALUES = [0.82, 0.46, 0.95, 0.58];

export function BiDemo({ locale, caption }: { locale: Locale; caption?: string }) {
  const l = L[locale];
  let at = 300;
  const fields = l.fields.map(([label, value]) => {
    const start = at;
    at = typedEnd(value, start, 30) + 150;
    return { label, value, start };
  });
  const createAt = at + 250;
  const stringAt = createAt + 300;
  const reportAt = typedEnd(l.string, stringAt, 90) + 400;
  const logAt = reportAt + 2000;
  const timeline = useTimeline(logAt + 600);
  const { t } = timeline;

  return (
    <DemoFrame timeline={timeline} title={l.title} caption={caption} locale={locale}>
      <div className="grid gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        {/* The connection */}
        <div className="min-w-0">
          <dl className="space-y-1.5">
            {fields.map((f) => (
              <div key={f.label} className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
                <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/55">{f.label}</dt>
                <dd className="min-h-[28px] border border-[#0a0a0a]/30 px-2 py-1 font-mono text-[12px]">
                  {typed(f.value, t, f.start, 30)}
                  <Caret on={t >= f.start && t < typedEnd(f.value, f.start, 30) + 150} />
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-3">
            <PressButton t={t} at={createAt} label={l.create} done={l.created} />
          </div>
          <div
            className="mt-3 break-all border-2 border-dashed border-[#0a0a0a]/40 bg-[#f6f6f6] p-2 font-mono text-[11px] leading-5"
            style={{ opacity: step(t, stringAt - 100, 200) }}
          >
            {typed(l.string, t, stringAt, 90) || " "}
          </div>
        </div>

        {/* The report, through that connection */}
        <div className="min-w-0 border-2 border-[#0a0a0a] p-3" style={{ opacity: 0.25 + 0.75 * step(t, reportAt, 300) }}>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/60">{l.report}</div>
          <div className="mt-3 flex h-[92px] items-end gap-3">
            {sampleRows(locale).map((row, i) => ({ city: row.city, value: BAR_VALUES[i] ?? 0.5 })).map((bar, i) => (
              <div key={bar.city} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full bg-[#0a0a0a]"
                  style={{ height: `${bar.value * 72 * step(t, reportAt + 200 + i * 120, 500)}px` }}
                />
                <span className="font-mono text-[10px]">{bar.city}</span>
              </div>
            ))}
          </div>
          <table className="mt-3 w-full border-collapse font-mono text-[11.5px]">
            <tbody>
              {sampleRows(locale).slice(0, 3).map((row, i) => (
                <tr
                  key={row.email}
                  className="border-t border-[#0a0a0a]/10"
                  style={{ opacity: step(t, reportAt + 900 + i * 150, 250) }}
                >
                  <td className="py-1 pr-2">
                    <span aria-hidden="true" className="inline-block h-[0.9em] w-[7ch] bg-[#0a0a0a] align-middle" />
                    <span className="sr-only">redacted</span>
                  </td>
                  <td className="py-1 pr-2">{maskValue("partial", row.iban)}</td>
                  <td className="py-1 text-right">{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p
        className="mt-4 border-l-4 border-accent pl-3 font-mono text-[11px] leading-5"
        style={{ opacity: step(t, logAt, 400) }}
      >
        {l.log}
      </p>
    </DemoFrame>
  );
}
