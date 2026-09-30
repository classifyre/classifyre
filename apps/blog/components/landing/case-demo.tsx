"use client";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components";

import { getLandingCopy } from "@/content/landing";
import type { Locale } from "@/lib/locale";
import { showcaseUrlFor } from "@/lib/site";
import { CaseGraph } from "@/components/case-graph";
import { Mascot } from "@/components/mascot";
import {
  LandingHead,
  Micro,
  Pin,
} from "@/components/landing/motifs";

/**
 * Product demonstration: the file, opened.
 *
 * Three panes, one case. The tabs are file tabs; every pane holds example
 * content written the way the product writes it (ranked findings with
 * reasons, the assembling case graph, and the autopilot's log) so the demo
 * shows the language of the software instead of lorem-ipsum dashboard
 * chrome. The showcase link under it walks the real, read-only product.
 */

const SEVERITY_CHIP: Record<string, string> = {
  critical: "border-red-500/70 text-red-400",
  high: "border-orange-400/70 text-orange-300",
  medium: "border-yellow-400/70 text-yellow-300",
  low: "border-sky-400/70 text-sky-300",
};

/** Exhibit severity, in order, for the case-tab evidence list. */
const EXHIBIT_SEVERITIES = ["critical", "high", "medium", "low"] as const;

export function CaseDemo({ locale }: { locale: Locale }) {
  const copy = getLandingCopy(locale);
  const showcase = showcaseUrlFor(locale);

  return (
    <section
      aria-labelledby="demo-title"
      className="cl-bleed relative overflow-hidden bg-black text-white"
    >
      <div className="landing-grid absolute inset-0 opacity-[0.08]" />
      <div className="relative mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-10 lg:py-28">
        <LandingHead
          id="demo-title"
          mark={copy.demo.marker}
          title={copy.demo.title}
          tone="dark"
          aside={
            <Mascot
              name="hidden-gem"
              alt={copy.mascots.hiddenGem}
              surface="dark"
              tilt="right"
              className="hidden h-40 w-auto lg:block"
            />
          }
        />

        <div className="mt-12 border-2 border-white/20 bg-white/[0.03]">
          <Tabs defaultValue="case">
            <TabsList
              className="h-auto w-full flex-wrap justify-start gap-0 rounded-none bg-transparent p-0"
            >
              {(
                [
                  ["case", copy.demo.tabs.caseBoard],
                  ["queue", copy.demo.tabs.queue],
                  ["autopilot", copy.demo.tabs.autopilot],
                ] as const
              ).map(([value, label]) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="rounded-none border-2 border-b-0 border-white/20 bg-white/5 px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/60 data-[state=active]:border-accent data-[state=active]:bg-accent data-[state=active]:text-black"
                >
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* ── Pane 1 · the case graph ─────────────────────────────── */}
            <TabsContent
              value="case"
              className="border-t-2 border-white/20 p-5 sm:p-7"
            >
              <div className="grid gap-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
                <figure className="min-w-0">
                  <Micro className="text-white/45">
                    {copy.demo.caseBoard.label}
                  </Micro>
                  {/* The graph draws in `currentColor` and theme backgrounds.
                      Inside the black band that would invert it into
                      light-on-light, so the drawing is mounted as a paper
                      print, the exhibit photo pinned to the desk. */}
                  <div className="mt-3 border-2 border-white/25 bg-card p-3 text-foreground sm:p-4">
                    {/* Wide landscape drawing: keeps a legible width and
                        scrolls sideways rather than shrinking its labels. */}
                    <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
                      <div className="min-w-142 lg:min-w-0">
                        <CaseGraph locale={locale} />
                      </div>
                    </div>
                  </div>
                  <figcaption className="border-t border-white/15 pt-3">
                    <Micro className="text-white/45">
                      {copy.demo.caseBoard.figcaption}
                    </Micro>
                  </figcaption>
                </figure>

                <ul className="space-y-4">
                  {copy.demo.caseBoard.exhibits.map((exhibit, index) => (
                    <li
                      key={exhibit.tag}
                      className="flex items-start gap-3 border-t border-white/15 pt-4 first:border-0 first:pt-0"
                    >
                      <span
                        className={`shrink-0 border-2 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] ${
                          SEVERITY_CHIP[
                            EXHIBIT_SEVERITIES[index] ?? "low"
                          ] ?? ""
                        }`}
                      >
                        {exhibit.tag}
                      </span>
                      <span className="text-sm leading-6 text-white/65">
                        {exhibit.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </TabsContent>

            {/* ── Pane 2 · the findings queue ─────────────────────────── */}
            <TabsContent
              value="queue"
              className="border-t-2 border-white/20 p-5 sm:p-7"
            >
              <Micro className="text-white/45">{copy.demo.queue.label}</Micro>

              <div className="mt-5">
                <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_5rem_minmax(0,1.7fr)] gap-6 border-b-2 border-white/20 pb-2 lg:grid">
                  <Micro className="text-white/40">
                    {copy.demo.queue.columns.finding}
                  </Micro>
                  <Micro className="text-white/40">
                    {copy.demo.queue.columns.where}
                  </Micro>
                  <Micro className="text-white/40">
                    {copy.demo.queue.columns.score}
                  </Micro>
                  <Micro className="text-white/40">
                    {copy.demo.queue.columns.reason}
                  </Micro>
                </div>

                <ul>
                  {copy.demo.queue.rows.map((row) => (
                    <li
                      key={row.finding}
                      className="grid gap-2 border-b border-white/12 py-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_5rem_minmax(0,1.7fr)] lg:items-baseline lg:gap-6"
                    >
                      <span className="font-serif text-sm font-black uppercase tracking-[0.03em]">
                        {row.finding}
                      </span>
                      <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-white/45">
                        {row.where}
                      </span>
                      <span className="font-mono text-base font-bold text-accent">
                        {row.score}
                      </span>
                      <span className="text-sm leading-6 text-white/60">
                        {row.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="mt-5 max-w-2xl">
                <Micro className="text-white/40">{copy.demo.queue.footnote}</Micro>
              </p>
            </TabsContent>

            {/* ── Pane 3 · the autopilot log ──────────────────────────── */}
            <TabsContent
              value="autopilot"
              className="border-t-2 border-white/20 p-5 sm:p-7"
            >
              <Micro className="text-white/45">
                {copy.demo.autopilot.label}
              </Micro>

              <ol className="mt-5 space-y-5 border-l-2 border-accent/40 pl-5">
                {copy.demo.autopilot.rows.map((row) => (
                  <li key={row.time} className="relative">
                    <span
                      aria-hidden="true"
                      className="absolute -left-[1.72rem] top-1.5"
                    >
                      <Pin />
                    </span>
                    <div className="flex flex-wrap items-baseline gap-3">
                      <Micro className="text-accent">{row.time}</Micro>
                      <Micro className="text-white/80">{row.agent}</Micro>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-white/65">
                      {row.text}
                    </p>
                  </li>
                ))}
              </ol>

              <p className="mt-6 max-w-2xl">
                <Micro className="text-white/40">
                  {copy.demo.autopilot.footnote}
                </Micro>
              </p>
            </TabsContent>
          </Tabs>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <a
            href={showcase}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center border-2 border-accent bg-accent px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:border-white hover:bg-white"
          >
            {copy.demo.cta}
          </a>
          <Micro className="text-white/40">showcase.classifyre.com</Micro>
        </div>
      </div>
    </section>
  );
}
