import { getLandingCopy } from "@/content/landing";
import type { Locale } from "@/lib/locale";
import { withLocalePrefix } from "@/lib/locale";
import { routes, showcaseUrlFor } from "@/lib/site";
import { ClosingBoard } from "@/components/closing-board";
import { ExhibitMark, Micro, Pin } from "@/components/landing/motifs";
import { GovernancePath } from "@/components/landing/governance-path";
import { RedactionSheet } from "@/components/landing/redaction-sheet";

/**
 * Hero: asymmetric composition pairing an executive headline on the left with
 * a live interactive multi-group masking & row-filter table on the right.
 *
 * Below the fold line: the six-step end-to-end governance flow and a clean
 * four-column architecture proof strip (Docker/Helm commands live in the
 * Deployment section and /get, keeping the hero clean for business leaders).
 */
export function Hero({ locale }: { locale: Locale }) {
  const copy = getLandingCopy(locale);
  const showcase = showcaseUrlFor(locale);
  const deployHref = `${withLocalePrefix(locale, routes.get)}/`;
  const supportHref = `${withLocalePrefix(locale, routes.support)}/`;

  return (
    <section
      aria-labelledby="hero-title"
      className="cl-bleed relative overflow-hidden bg-black text-white"
    >
      <ClosingBoard locale={locale} />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-12 px-4 py-12 sm:px-6 lg:gap-14 lg:px-10 lg:py-16">
        <div className="grid items-center gap-12 xl:grid-cols-12 xl:gap-10">
          {/* Headline & value proposition */}
          <div className="relative z-10 min-w-0 space-y-7 xl:col-span-5">
            <div className="flex flex-wrap items-center gap-2">
              {copy.hero.chips.map((chip) => (
                <ExhibitMark key={chip}>{chip}</ExhibitMark>
              ))}
            </div>

            <h1
              id="hero-title"
              lang={locale}
              className="font-hero text-[clamp(3.1rem,7vw,5.4rem)] uppercase leading-[0.88] tracking-[0.01em] text-white [hyphens:manual]"
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

            <p className="max-w-xl text-base leading-7 text-white/80 sm:text-lg sm:leading-8">
              {copy.hero.lede}
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <a
                href={deployHref}
                className="inline-flex items-center border-2 border-accent bg-accent px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:border-white hover:bg-white"
              >
                {copy.hero.ctaPrimary}
              </a>
              <a
                href={supportHref}
                className="inline-flex items-center border-2 border-white/25 px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white transition-colors hover:border-accent hover:text-accent"
              >
                {copy.hero.ctaSecondary}
              </a>
              <a
                href={showcase}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex items-center gap-2 py-2.5 pl-1"
              >
                <Pin solid={false} />
                <Micro className="text-white/65 transition-colors group-hover:text-accent">
                  {copy.hero.ctaShowcase} →
                </Micro>
              </a>
            </div>
          </div>

          {/* Interactive multi-group row-filter & column-masking preview */}
          <div className="relative min-w-0 xl:col-span-7">
            <RedactionSheet locale={locale} />
          </div>
        </div>

        {/* End-to-end flow: Integrate → Detect → Govern → Mask → Query & BI → Request & Share */}
        <div className="border-t-2 border-white/15 pt-8">
          <GovernancePath locale={locale} />
        </div>

        {/* Architectural proof strip */}
        <dl className="grid gap-6 border-t border-white/15 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          {copy.hero.proofBar.map((item) => (
            <div key={item.label} className="space-y-1">
              <dt>
                <Micro className="text-accent">{item.label}</Micro>
              </dt>
              <dd className="text-sm font-medium text-white/85">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
