"use client";

import { SourceIcon } from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";

import type { Locale } from "@/lib/locale";
import { DemoFrame, step, useTimeline } from "@/components/demos/timeline";

/**
 * Connect & detect, played out: three sources scan, findings arrive ranked
 * with a score and a reason, and the top one classifies its column, which
 * is what the masks follow.
 */

const SOURCES = [
  { source: "postgresql", name: "crm", meta: "PostgreSQL" },
  { source: "confluence", name: "wiki", meta: "Confluence" },
  { source: "s3_compatible_storage", name: "exports", meta: "Parquet in S3" },
] as const;

const FINDINGS = [
  { what: "IBAN", where: "crm.customers.iban", score: 0.99, why: { en: "Valid checksum in 4,211 of 4,215 rows", de: "Gültige Prüfsumme in 4.211 von 4.215 Zeilen" } },
  { what: "AWS access key", where: "wiki / Deploy notes", score: 0.96, why: { en: "Key and secret on the same page", de: "Schlüssel und Secret auf derselben Seite" } },
  { what: { en: "National ID", de: "AT SVNR" }, where: "exports/2026-10.parquet", score: 0.93, why: { en: "Check digit valid, column named national_id", de: "Prüfziffer gültig, Spalte heißt svnr" } },
  { what: "Email", where: "crm.tickets.body", score: 0.81, why: { en: "Addresses in free text, 312 tickets", de: "Adressen im Freitext, 312 Tickets" } },
] as const;

const L = {
  en: {
    title: "Scan · 3 sources",
    scanning: "Scanning",
    done: "Scanned",
    findings: "Findings, ranked",
    classified: "crm.customers.iban classified as Personal · masked from the next query",
  },
  de: {
    title: "Scan · 3 Quellen",
    scanning: "Scannt",
    done: "Gescannt",
    findings: "Funde, gewichtet",
    classified: "crm.customers.iban als personenbezogen klassifiziert · ab der nächsten Abfrage maskiert",
  },
} as const;

const SCAN_AT = 300;
const SCAN_MS = 1700;
const FINDINGS_AT = 2300;
const CLASSIFY_AT = 5600;

export function DiscoverDemo({ locale, caption }: { locale: Locale; caption?: string }) {
  const timeline = useTimeline(7000);
  const { t } = timeline;
  const l = L[locale];

  return (
    <DemoFrame timeline={timeline} title={l.title} caption={caption} locale={locale}>
      <ul className="grid gap-2 sm:grid-cols-3">
        {SOURCES.map((s, i) => {
          const progress = step(t, SCAN_AT + i * 260, SCAN_MS);
          return (
            <li key={s.name} className="border border-[#0a0a0a]/20 px-3 py-2">
              <div className="flex items-center gap-2 font-mono text-[12px] font-semibold">
                <SourceIcon source={s.source} size="sm" className="[&_svg]:text-[#0a0a0a]" />
                {s.name}
                <span className="ml-auto font-normal text-[#0a0a0a]/50">{s.meta}</span>
              </div>
              <div className="mt-2 h-1.5 bg-[#0a0a0a]/10">
                <div className="h-full bg-[#0a0a0a]" style={{ width: `${progress * 100}%` }} />
              </div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/55">
                {progress >= 1 ? l.done : l.scanning}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 border-t-2 border-[#0a0a0a] pt-2">
        <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#0a0a0a]/60">
          {l.findings}
        </div>
        <ul className="mt-1">
          {FINDINGS.map((f, i) => {
            const show = step(t, FINDINGS_AT + i * 650, 300);
            const top = i === 0 && t >= CLASSIFY_AT;
            const what = typeof f.what === "string" ? f.what : f.what[locale];
            return (
              <li
                key={typeof f.what === "string" ? f.what : `${f.what.en}/${f.what.de}`}
                className={cn(
                  "grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 border-b border-[#0a0a0a]/10 py-2 sm:grid-cols-[7rem_1fr_6.5rem]",
                  top && "bg-accent/40",
                )}
                style={{ opacity: show, transform: `translateY(${(1 - show) * 8}px)` }}
              >
                <span className="text-[13px] font-semibold">{what}</span>
                <span className="order-3 col-span-2 font-mono text-[11px] text-[#0a0a0a]/60 sm:order-none sm:col-span-1">
                  {f.where} · {f.why[locale]}
                </span>
                <span className="flex items-center gap-2 justify-self-end">
                  <span className="h-1.5 w-12 bg-[#0a0a0a]/10">
                    <span
                      className="block h-full bg-[#0a0a0a]"
                      style={{ width: `${f.score * 100 * step(t, FINDINGS_AT + i * 650 + 150, 500)}%` }}
                    />
                  </span>
                  <span className="font-mono text-[12px]">{f.score.toFixed(2)}</span>
                </span>
              </li>
            );
          })}
        </ul>
        <p
          className="mt-3 border-l-4 border-accent pl-3 font-mono text-[11px] leading-5"
          style={{ opacity: step(t, CLASSIFY_AT, 400) }}
        >
          {l.classified}
        </p>
      </div>
    </DemoFrame>
  );
}
