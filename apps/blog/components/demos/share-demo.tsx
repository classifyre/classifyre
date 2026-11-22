"use client";

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
 * Dataset request & governed data product flow:
 * 1. A business user submits a plain-language dataset request joining CRM,
 *    lakehouse orders, and finance invoices.
 * 2. The data owner reviews and publishes it as a governed shared dataset
 *    (live or Delta-backed) for the requesting group.
 * 3. Downstream consumers query the published data product with all source
 *    column masks automatically inherited as a strict floor.
 */

const NAME = "shared.sales.customer_revenue";
const CPS = 58;

const L = {
  en: {
    title: "Data requests · Governed data product",
    requestTag: "Business request · Regional Sales",
    requestPrompt:
      "Join active CRM customers with Delta lakehouse orders and finance invoices by city, without customer names.",
    routed: "Routed to Finance owner · 3 sources verified",
    publish: "Approve & publish",
    published: "Published",
    name: "Asset",
    format: "Delta & Live SQL",
    group: "Regional sales",
    access: "Masked · 90 days",
    masks: "Inherited mask floor: customer email hashed (crm.customers.email), names excluded",
    sources: "3 sources",
    preview: "Regional sales queries it",
  },
  de: {
    title: "Datenanfragen · Verwaltetes Datenprodukt",
    requestTag: "Fachliche Anfrage · Vertrieb Regionen",
    requestPrompt:
      "Verknüpfe aktive CRM-Kunden mit Delta-Lakehouse-Bestellungen und Rechnungen nach Stadt, ohne Kundennamen.",
    routed: "An Finance Owner weitergeleitet · 3 Quellen geprüft",
    publish: "Prüfen & veröffentlichen",
    published: "Veröffentlicht",
    name: "Asset",
    format: "Delta & Live-SQL",
    group: "Vertrieb Regionen",
    access: "Maskiert · 90 Tage",
    masks: "Vererbte Masken-Untergrenze: E-Mail gehasht (crm.customers.email), Namen ausgeschlossen",
    sources: "3 Quellen",
    preview: "Vertrieb Regionen fragt es ab",
  },
} as const;

export function ShareDemo({ locale, caption }: { locale: Locale; caption?: string }) {
  const l = L[locale];
  const reqStart = 250;
  const reqEnd = typedEnd(l.requestPrompt, reqStart, CPS);
  const routeAt = reqEnd + 250;
  const publishAt = routeAt + 850;
  const previewAt = publishAt + 750;
  const timeline = useTimeline(previewAt + 1600);
  const { t } = timeline;

  return (
    <DemoFrame timeline={timeline} title={l.title} caption={caption} locale={locale}>
      {/* Step 1: Plain-language request from a business user */}
      <div className="border-2 border-[#0a0a0a] bg-[#f6f6f6] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#0a0a0a]/65">
            {l.requestTag}
          </span>
          <span
            className="font-mono text-[10px] text-[#0a0a0a]/60"
            style={{ opacity: step(t, routeAt, 250) }}
          >
            {l.routed}
          </span>
        </div>
        <p className="mt-2 min-h-[42px] font-sans text-[13px] leading-5 text-[#0a0a0a]">
          “{typed(l.requestPrompt, t, reqStart, CPS)}
          <Caret on={t >= reqStart && t < reqEnd + 60} />”
        </p>
      </div>

      {/* Step 2: Owner review & governed data product publication */}
      <div
        className="mt-3 grid gap-3 sm:grid-cols-2"
        style={{ opacity: step(t, routeAt, 300) }}
      >
        <div className="space-y-2 border border-[#0a0a0a]/25 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/55">
              {l.name}
            </span>
            <span className="border border-[#0a0a0a]/30 px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.1em]">
              {l.format}
            </span>
          </div>
          <p className="font-mono text-[11.5px] font-semibold">{NAME}</p>
        </div>

        <div className="flex flex-col justify-between gap-2 border-2 border-[#0a0a0a] p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "border px-2 py-0.5 text-[12px] font-semibold transition-colors",
                t >= publishAt - 400 ? "border-[#0a0a0a] bg-accent/50" : "border-[#0a0a0a]/30",
              )}
            >
              {l.group}
            </span>
            <span className="font-mono text-[11px] text-[#0a0a0a]/65">{l.access}</span>
          </div>
          <div>
            <PressButton t={t} at={publishAt} label={l.publish} done={`✓ ${l.published}`} />
          </div>
        </div>
      </div>

      {/* Step 3: Consumer preview with inherited masks */}
      <div className="mt-4" style={{ opacity: step(t, previewAt, 400) }}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-mono text-[11px] font-semibold">{NAME}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/55">
            {l.preview} · {l.sources}
          </span>
        </div>
        <table className="mt-1 w-full border-collapse font-mono text-[11.5px]">
          <tbody>
            {sampleRows(locale).slice(0, 2).map((row, i) => (
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
