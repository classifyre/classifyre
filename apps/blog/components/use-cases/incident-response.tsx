import { getLandingCopy } from "@/content/landing";
import type { Locale } from "@/lib/locale";
import { withLocalePrefix } from "@/lib/locale";
import {
  JsonLdScripts,
  generateBreadcrumbSchema,
  generateFaqSchema,
  siteOrigin,
} from "@/lib/seo";
import { routes, showcaseUrlFor } from "@/lib/site";
import { ClosingBoard } from "@/components/closing-board";
import { CaseDemo } from "@/components/landing/case-demo";
import { FaqList } from "@/components/landing/faq";
import {
  Enter,
  ExhibitMark,
  LandingHead,
  LandingSection,
  Micro,
} from "@/components/landing/motifs";
import { Mascot } from "@/components/mascot";

/**
 * Incident response as a use case of its own.
 *
 * The homepage tells the governed-access story; the investigation layer
 * (inquiries, fingerprints, cases, autopilot) is what someone opens on the
 * day something leaks, so it gets this page instead of a homepage block.
 * Same case-file language: the string board behind the answer, the case
 * file opened below it, then the four parts and the questions people ask.
 */
export function IncidentResponsePage({ locale }: { locale: Locale }) {
  const copy = getLandingCopy(locale);
  const page = copy.incident;
  const siteUrl = siteOrigin();
  const home = withLocalePrefix(locale, routes.home);
  const homeHref = home === "/" ? "/" : `${home}/`;
  const path = `${withLocalePrefix(locale, routes.incidentResponse)}/`;

  return (
    <>
      <JsonLdScripts
        schemas={[
          generateBreadcrumbSchema(siteUrl, [
            { name: "Classifyre", path: homeHref },
            { name: page.breadcrumb, path },
          ]),
          generateFaqSchema(page.faq),
        ]}
      />
      <noscript>
        <style>{".cl-reveal{opacity:1 !important;transform:none !important}"}</style>
      </noscript>

      <main className="flex w-full flex-col">
        <section
          aria-labelledby="incident-title"
          className="cl-bleed relative overflow-hidden bg-black text-white"
        >
          <ClosingBoard locale={locale} />
          <div className="relative mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-10 lg:py-16">
            <nav aria-label="Breadcrumb" className="flex items-center gap-2">
              <a href={homeHref} className="group">
                <Micro className="text-white/55 transition-colors group-hover:text-accent">
                  Classifyre
                </Micro>
              </a>
              <Micro className="text-white/30">/</Micro>
              <Micro className="text-white/80">{page.breadcrumb}</Micro>
            </nav>

            <div className="mt-8 grid items-center gap-10 lg:grid-cols-12">
              <div className="space-y-7 lg:col-span-9">
                <ExhibitMark>{page.chip}</ExhibitMark>
                <h1
                  id="incident-title"
                  className="max-w-[20ch] font-hero text-[clamp(3rem,7vw,5.8rem)] uppercase leading-[0.88] tracking-[0.01em]"
                >
                  <span className="block">{page.titleLead}</span>
                  <span className="inline-block bg-accent px-[0.12em] text-black">
                    {page.titleHighlight}
                  </span>
                </h1>
                <p className="max-w-2xl text-base leading-7 text-white/75 sm:text-lg sm:leading-8">
                  {page.lede}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href={showcaseUrlFor(locale)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center border-2 border-accent bg-accent px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:border-white hover:bg-white"
                  >
                    {page.ctaPrimary}
                  </a>
                  <a
                    href={`${withLocalePrefix(locale, `${routes.blog}/cases`)}/`}
                    className="inline-flex items-center border-2 border-white/25 px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white transition-colors hover:border-accent hover:text-accent"
                  >
                    {page.ctaSecondary}
                  </a>
                </div>
              </div>
              <div className="hidden justify-end lg:col-span-3 lg:flex">
                <Mascot
                  name="questioning"
                  alt={copy.mascots.questioning}
                  surface="dark"
                  tilt="right"
                  eager
                  className="h-52 w-auto"
                />
              </div>
            </div>
          </div>
        </section>

        <CaseDemo locale={locale} />

        <LandingSection className="py-20 lg:py-24">
          <div aria-labelledby="incident-points-title">
            <LandingHead
              id="incident-points-title"
              mark={page.points.marker}
              title={page.points.title}
            />
            <ol className="mt-12 grid gap-6 md:grid-cols-2">
              {page.points.items.map((point, index) => (
                <Enter key={point.title} as="li" delayMs={index * 90}>
                  <article className="h-full border-2 border-foreground/80 bg-card p-6">
                    <span className="font-hero text-4xl leading-none text-accent-ink dark:text-accent">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h2 className="mt-4 font-serif text-lg font-black uppercase leading-tight tracking-[0.04em]">
                      {point.title}
                    </h2>
                    <p className="mt-3 text-sm leading-7 text-muted-foreground">{point.body}</p>
                    <a
                      href={point.href}
                      className="mt-4 inline-block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent-ink underline-offset-4 hover:underline dark:text-accent"
                    >
                      {page.points.linkLabel} →
                    </a>
                  </article>
                </Enter>
              ))}
            </ol>
          </div>
        </LandingSection>

        <FaqList
          id="incident-faq-title"
          mark={copy.faq.marker}
          title={copy.faq.title}
          items={page.faq}
          locale={locale}
        />
      </main>
    </>
  );
}
