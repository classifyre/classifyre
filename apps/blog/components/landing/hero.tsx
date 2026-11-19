import { DockerRunBlock } from "@workspace/ui/components";

import { getLandingCopy } from "@/content/landing";
import type { Locale } from "@/lib/locale";
import { withLocalePrefix } from "@/lib/locale";
import { docs, routes, showcaseUrlFor, softwareVersion } from "@/lib/site";
import { ClosingBoard } from "@/components/closing-board";
import { ExhibitMark, Micro, Pin } from "@/components/landing/motifs";
import { GovernancePath } from "@/components/landing/governance-path";
import { RedactionSheet } from "@/components/landing/redaction-sheet";

/**
 * Hero: the governance board.
 *
 * Composition stays asymmetric: display type holds the left of the grid
 * like a poster, the redaction sheet sits on the right with the badge
 * pinned to it. The backdrop is the string board, drawn as the path data
 * takes through Classifyre (connected, found, governed, granted, shared,
 * connected to BI, logged), with a pulse travelling it.
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
        <div className="grid items-center gap-14 xl:grid-cols-12 xl:gap-10">
          {/* Poster column */}
          <div className="relative z-10 min-w-0 space-y-7 xl:col-span-5">
            <div className="flex flex-wrap items-center gap-2">
              {copy.hero.chips.map((chip) => (
                <ExhibitMark key={chip}>{chip}</ExhibitMark>
              ))}
            </div>

            <h1
              id="hero-title"
              className="font-hero text-[clamp(3.4rem,8vw,6.4rem)] uppercase leading-[0.86] tracking-[0.01em] text-white"
            >
              {copy.hero.titleA.split(/(?<=\.)\s+/).map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
              <span className="block">
                {copy.hero.titleBLead ? `${copy.hero.titleBLead} ` : null}
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

          {/* The exhibit: a customer table, redacted as you watch. */}
          <div className="relative min-w-0 pt-14 xl:col-span-7 xl:pt-16">
            <RedactionSheet locale={locale} />
          </div>
        </div>

        {/* The path data takes, station by station. */}
        <div className="border-t-2 border-white/15 pt-8">
          <GovernancePath locale={locale} />
        </div>

        {/* Install strip: the answer to "how do I run it", above the fold's
            end. One command, three ways onward, no form. */}
        <div className="grid gap-6 border-t-2 border-white/15 pt-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:items-center lg:gap-10">
          <div className="min-w-0">
            <Micro className="text-white/60">{copy.install.marker}</Micro>
            <DockerRunBlock tone="dark" tag={softwareVersion} className="mt-2" />
          </div>
          <nav aria-label={copy.install.marker} className="flex flex-col gap-2">
            {[
              { label: copy.install.dockerCta, href: `${withLocalePrefix(locale, routes.get)}/` },
              { label: copy.install.helmCtaDocs, href: docs.kubernetes },
              { label: copy.hero.ctaSecondary, href: showcase },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                {...(link.href === showcase
                  ? { target: "_blank", rel: "noreferrer" }
                  : null)}
                className="group flex items-center gap-2 py-1.5"
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
