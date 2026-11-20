"use client";

import * as React from "react";

import { cn } from "@workspace/ui/lib/utils";

import { getLandingCopy } from "@/content/landing";
import {
  SAMPLE_COLUMNS,
  sampleRowFilterCity,
  sampleRows,
  maskValue,
  type MaskKind,
} from "@/content/sample-data";
import type { Locale } from "@/lib/locale";
import { Micro } from "@/components/landing/motifs";

/**
 * The hero's exhibit: a customer table on paper, redacted as you watch.
 *
 * The rows print in clear, detector tags drop onto the classified column
 * headers, then a marker sweeps each classified column into its mask
 * (redacted, last four, hashed) and the secret column folds away. That
 * sequence is CSS only (`.cl-sheet[data-intro]` in landing.css), so it runs
 * without JavaScript and is skipped under `prefers-reduced-motion`: the base
 * styles are the final, masked state.
 *
 * Then the sheet keeps going on its own, through three people reading the
 * same query: the regional analyst (her group's row filter greys out every
 * row outside her city, the masks stay), the finance steward (bars lift, lime
 * goes under every cleared value) and the workspace admin (every row, still
 * masked: admins don't read in clear by default). It cycles until someone
 * takes the switch themselves. The badge hangs over the sheet's corner, the
 * way the case file used to carry it.
 */

type Persona = "analyst" | "steward" | "admin";

const PERSONAS: readonly Persona[] = ["analyst", "steward", "admin"];

function nextPersona(p: Persona): Persona {
  return PERSONAS[(PERSONAS.indexOf(p) + 1) % PERSONAS.length] ?? "analyst";
}

const SWEEP_START_MS = 1500;
const SWEEP_STEP_MS = 320;
/** First automatic switch after the intro, then the rhythm of the cycle. */
const AUTO_FIRST_MS = 4600;
const AUTO_EVERY_MS = 3800;

function sweepDelay(index: number): number {
  return SWEEP_START_MS + index * SWEEP_STEP_MS;
}

export function RedactionSheet({ locale, badge = true }: { locale: Locale; badge?: boolean }) {
  const copy = getLandingCopy(locale).sheet;
  const rows = sampleRows(locale);
  const filterCity = sampleRowFilterCity(locale);
  const [persona, setPersona] = React.useState<Persona>("analyst");
  const [run, setRun] = React.useState(0);
  const [intro, setIntro] = React.useState(true);
  const [auto, setAuto] = React.useState(true);

  const classified = SAMPLE_COLUMNS.filter((col) => col.mask !== "clear");

  // The sheet demonstrates itself until someone takes over.
  React.useEffect(() => {
    if (!auto) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let interval = 0;
    const first = window.setTimeout(() => {
      setIntro(false);
      setPersona("steward");
      interval = window.setInterval(() => {
        setPersona(nextPersona);
      }, AUTO_EVERY_MS);
    }, AUTO_FIRST_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [auto, run]);

  const choose = (next: Persona) => {
    setAuto(false);
    setIntro(false);
    setPersona(next);
  };

  const replay = () => {
    setPersona("analyst");
    setIntro(true);
    setAuto(true);
    setRun((n) => n + 1);
  };

  return (
    <div className="relative">
      {/* The badge, pinned over the sheet's corner (hero only). */}
      {badge ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
        src="/clasifyre_icon.png"
        alt="Classifyre"
        width={288}
        height={288}
        className="cl-float pointer-events-none absolute -top-16 right-4 z-20 w-24 drop-shadow-[0_0_50px_rgba(183,255,0,0.35)] sm:-top-20 sm:w-32"
        />
      ) : null}

      <figure
        key={run}
        className="cl-sheet relative border-2 border-white/25 bg-white text-[#0a0a0a] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.9)]"
        data-persona={persona}
        data-intro={intro ? "" : undefined}
        aria-labelledby="sheet-caption"
      >
        <div className="flex items-center gap-3 border-b-2 border-[#0a0a0a] px-4 py-2.5 sm:px-5">
          <code className="block min-w-0 truncate font-mono text-[12px] text-[#0a0a0a]/80 sm:text-[13px]">
            <span className="font-semibold text-[#0a0a0a]">SELECT</span> *{" "}
            <span className="font-semibold text-[#0a0a0a]">FROM</span> crm.customers
          </code>
          <span className="cl-filter-tag shrink-0 whitespace-nowrap border border-[#0a0a0a] bg-accent px-1.5 py-px font-mono text-[10px] text-black">
            {copy.rowFilter}
          </span>
        </div>

        {/*
          The table is wider than a phone and grows again when the hidden
          column folds open, so this scrolls sideways by design. The
          scrollbar chrome is hidden so switching readers never flashes one
          under the hero query line; touch and keyboard scrolling still work.
        */}
        <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <table className="w-full min-w-[540px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[#0a0a0a]/20 align-bottom">
                {SAMPLE_COLUMNS.map((col) => {
                  const order = classified.indexOf(col);
                  const tag =
                    col.key === "name" ||
                    col.key === "iban" ||
                    col.key === "email" ||
                    col.key === "token"
                      ? copy.tags[col.key]
                      : null;
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      className={cn(
                        "px-3 pb-2 pt-3 align-bottom font-normal sm:px-4",
                        col.mask === "hidden" && "cl-col-hidden",
                      )}
                    >
                      <div className="cl-fold">
                        {tag ? (
                          <span
                            className="cl-tag mb-1.5 inline-block whitespace-nowrap border border-[#0a0a0a] px-1.5 py-px font-mono text-[10px] text-[#0a0a0a]"
                            style={
                              { "--cl-delay": `${600 + order * 140}ms` } as React.CSSProperties
                            }
                          >
                            {tag}
                          </span>
                        ) : (
                          <span className="mb-1.5 block h-[18px]" aria-hidden="true" />
                        )}
                        <span className="block font-mono text-[12px] font-semibold text-[#0a0a0a]">
                          {col.sql}
                        </span>
                        {col.mask !== "clear" ? (
                          <span className="cl-mask-kind block font-mono text-[10px] uppercase tracking-[0.12em] text-[#0a0a0a]/50">
                            {copy.masks[col.mask as Exclude<MaskKind, "clear">]}
                          </span>
                        ) : (
                          <span className="block h-[15px]" aria-hidden="true" />
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr
                  key={row.email}
                  className={cn(
                    "cl-row border-b border-[#0a0a0a]/10 last:border-b-0",
                    row.city !== filterCity && "cl-row-out",
                  )}
                  style={{ "--cl-delay": `${rowIndex * 90}ms` } as React.CSSProperties}
                >
                  {SAMPLE_COLUMNS.map((col) => {
                    const order = classified.indexOf(col);
                    const value = row[col.key];
                    return (
                      <td
                        key={col.key}
                        className={cn(
                          "whitespace-nowrap px-3 py-2.5 font-mono text-[12.5px] sm:px-4 sm:text-[13px]",
                          col.mask === "hidden" && "cl-col-hidden",
                        )}
                      >
                        {col.mask === "clear" ? (
                          value
                        ) : (
                          <Cell
                            kind={col.mask}
                            clear={value}
                            masked={maskValue(col.mask, value)}
                            delayMs={sweepDelay(order) + rowIndex * 60}
                            staggerMs={order * 110 + rowIndex * 45}
                            srMasked={copy.masks[col.mask as Exclude<MaskKind, "clear">]}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* The reader switch and what it means. */}
        <figcaption
          id="sheet-caption"
          className="flex flex-col gap-3 border-t-2 border-[#0a0a0a] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
        >
          <div role="radiogroup" aria-label={copy.readAs} className="flex flex-wrap items-center gap-2">
            <Micro className="mr-1 text-[#0a0a0a]/55">{copy.readAs}</Micro>
            {PERSONAS.map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={persona === key}
                onClick={() => choose(key)}
                className={cn(
                  "border-2 border-[#0a0a0a] px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] transition-colors duration-300",
                  persona === key
                    ? key === "steward"
                      ? "bg-accent text-black"
                      : "bg-[#0a0a0a] text-white"
                    : "bg-white text-[#0a0a0a] hover:bg-[#0a0a0a]/5",
                )}
              >
                {copy.personas[key]}
              </button>
            ))}
          </div>
          <p className="text-[13px] leading-5 text-[#0a0a0a]/70 sm:max-w-[48%] sm:text-right">
            <span className="cl-hidden-note font-mono text-[11px] text-[#0a0a0a]">
              {persona !== "steward" ? `${copy.hidden}. ` : null}
            </span>
            <span aria-live="polite">{copy.notes[persona]}</span>
          </p>
        </figcaption>
      </figure>

      <button
        type="button"
        onClick={replay}
        className="absolute -bottom-8 right-0 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-white/50 underline-offset-4 hover:text-accent hover:underline"
      >
        {copy.replay} ↺
      </button>
    </div>
  );
}

/**
 * One classified cell: the clear value and the masked value stacked in the
 * same grid area, plus the redaction bar. Which one shows is decided by the
 * sheet's `data-persona` in CSS, so a persona switch is one attribute.
 */
function Cell({
  kind,
  clear,
  masked,
  delayMs,
  staggerMs,
  srMasked,
}: {
  kind: MaskKind;
  clear: string;
  masked: string;
  delayMs: number;
  /** Where this cell sits in the sweep when the reader switches. */
  staggerMs: number;
  srMasked: string;
}) {
  return (
    <span
      className={cn("cl-cell", `cl-cell-${kind}`)}
      style={
        { "--cl-delay": `${delayMs}ms`, "--cl-stagger": `${staggerMs}ms` } as React.CSSProperties
      }
    >
      <span className="cl-v-clear">{clear}</span>
      <span className="cl-v-mask">
        {kind === "redact" ? <span className="sr-only">{srMasked}</span> : masked}
      </span>
      {kind === "redact" ? <span className="cl-bar" aria-hidden="true" /> : null}
    </span>
  );
}
