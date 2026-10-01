import { DockerRunBlock } from "@workspace/ui/components";

import { getLandingCopy } from "@/content/landing";
import type { Locale } from "@/lib/locale";
import { docs, routes, showcaseUrlFor, softwareVersion } from "@/lib/site";
import { ClosingBoard } from "@/components/closing-board";
import {
  ExhibitMark,
  Micro,
  Pin,
  Stamp,
} from "@/components/landing/motifs";

/**
 * Hero: the case dossier pinned to the board.
 *
 * Composition is deliberately asymmetric: display type holds the left
 * two-thirds of the grid like a poster and the investigator's badge hangs
 * in the right margin on a slow float. The backdrop is the same string
 * board the closing CTA uses: evidence pins joined by dashed threads, with
 * rotating classification labels. "Scattered data in, closed cases out",
 * drawn once, quietly, in the background.
 *
 * The bottom edge is the install strip, so the page answers "how do I run
 * it" before the first scroll ends. No signup, no form.
 */

export function Hero({ locale }: { locale: Locale }) {
  const copy = getLandingCopy(locale);
  const showcase = showcaseUrlFor(locale);

  return (
    <section
      aria-labelledby="hero-title"
      className="cl-bleed relative overflow-hidden bg-black text-white"
    >
      <ClosingBoard locale={locale} />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-12 px-4 py-12 sm:px-6 lg:gap-16 lg:px-10 lg:py-16">
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-10">
          {/* Poster column */}
          <div className="relative z-10 space-y-7 lg:col-span-7">
            <div className="flex flex-wrap items-center gap-2">
              {copy.hero.chips.map((chip) => (
                <ExhibitMark key={chip}>{chip}</ExhibitMark>
              ))}
            </div>

            <h1
              id="hero-title"
              className="font-hero text-[clamp(3.4rem,9.5vw,7.6rem)] uppercase leading-[0.86] tracking-[0.01em] text-white"
            >
              <span className="block">{copy.hero.titleA}</span>
              <span className="block">
                {copy.hero.titleBLead}{" "}
                <span className="inline-block bg-accent px-[0.12em] text-black">
                  {copy.hero.titleBHighlight}
                </span>
              </span>
            </h1>

            <p className="max-w-2xl text-base leading-7 text-white/75 sm:text-lg sm:leading-8">
              {copy.hero.lede}
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <a
                href="#run-it"
                className="inline-flex items-center border-2 border-accent bg-accent px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:border-white hover:bg-white"
              >
                {copy.hero.ctaPrimary}
              </a>
              <a
                href={showcase}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center border-2 border-white/25 px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white transition-colors hover:border-accent hover:text-accent"
              >
                {copy.hero.ctaSecondary}
              </a>
            </div>

            <Micro className="block text-white/40">{copy.hero.micro}</Micro>
          </div>

          {/* The pinned case file: exhibit A, where the threads land. */}
          <div className="lg:col-span-5">
            <div className="cl-float relative mx-auto w-full max-w-xs sm:max-w-sm">
              <div className="flex">
                <Micro className="border-2 border-b-0 border-white/25 bg-white/5 px-3 py-1 text-white/65">
                  {copy.hero.exhibit.tab}
                </Micro>
              </div>
              <div className="relative border-2 border-white/25 bg-white/[0.04] p-5 sm:p-6">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/clasifyre_icon.png"
                  alt="The Classifyre investigator, a detective cat on a green badge"
                  width={288}
                  height={288}
                  className="w-full drop-shadow-[0_0_70px_rgba(183,255,0,0.3)]"
                />
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/15 pt-3">
                  <Micro className="text-white/55">
                    {copy.hero.exhibit.subject}
                  </Micro>
                  <Micro className="inline-flex items-center gap-1.5 whitespace-nowrap text-accent">
                    <span
                      aria-hidden="true"
                      className="inline-block size-1.5 rounded-full bg-accent"
                    />
                    {copy.hero.exhibit.status}
                  </Micro>
                </div>
              </div>
              <Stamp className="absolute -right-4 -top-3">
                {copy.hero.exhibit.stamp}
              </Stamp>
            </div>
          </div>
        </div>

        {/* Install strip: the answer to "how do I run it", above the fold's
            end. One command, three ways onward, no form. */}
        <div className="grid gap-6 border-t-2 border-white/15 pt-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:items-center lg:gap-10">
          <div className="min-w-0">
            <Micro className="text-white/45">{copy.install.marker}</Micro>
            <DockerRunBlock tone="dark" tag={softwareVersion} className="mt-2" />
          </div>
          <nav aria-label={copy.install.marker} className="flex flex-col gap-2">
            {[
              {
                label: copy.install.dockerCta,
                href: routes.get,
              },
              {
                label: copy.install.helmCtaDocs,
                href: docs.kubernetes,
              },
              {
                label: copy.hero.ctaSecondary,
                href: showcase,
              },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                {...(link.href === showcase
                  ? { target: "_blank", rel: "noreferrer" }
                  : null)}
                className="group flex items-center gap-2"
              >
                <Pin solid={false} />
                <Micro className="text-white/60 transition-colors group-hover:text-accent">
                  {link.label} →
                </Micro>
              </a>
            ))}
          </nav>
        </div>
      </div>
    </section>
  );
}
