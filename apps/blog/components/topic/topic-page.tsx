import {
  DockerRunBlock,
  HelmLogo,
  KubernetesLogo,
} from "@workspace/ui/components";

import {
  getTopic,
  getTopicChrome,
  topicPath,
  type TopicId,
} from "@/content/topics";
import type { Locale } from "@/lib/locale";
import { withLocalePrefix } from "@/lib/locale";
import {
  JsonLdScripts,
  generateBreadcrumbSchema,
  generateFaqSchema,
  siteOrigin,
} from "@/lib/seo";
import {
  docs,
  enterpriseContactEmail,
  helmInstallCommand,
  routes,
  softwareVersion,
} from "@/lib/site";
import { ClosingBoard } from "@/components/closing-board";
import { FaqList } from "@/components/landing/faq";
import {
  Enter,
  ExhibitMark,
  LandingHead,
  LandingSection,
  Micro,
  Pin,
} from "@/components/landing/motifs";
import { Demo } from "@/components/demos";
import { Mascot } from "@/components/mascot";

/**
 * One page per search term, same shape in both languages, in the landing
 * page's case-file language: the string board behind the answer, exhibit
 * marks over every section, stage cards, mono microtype.
 *
 * The term is answered in the H1 and the paragraph under it. The loop lies
 * across the edge of the black band like a print. Then how Classifyre does
 * it, the longer explanation, the comparison where there is one, what it
 * does not do, the command, and the questions people ask next.
 */
export function TopicPage({ locale, id }: { locale: Locale; id: TopicId }) {
  const topic = getTopic(locale, id);
  const chrome = getTopicChrome(locale);
  const siteUrl = siteOrigin();
  const home = withLocalePrefix(locale, routes.home);
  const homeHref = home === "/" ? "/" : `${home}/`;
  const pilot = `mailto:${enterpriseContactEmail}?subject=Classifyre%20pilot`;

  return (
    <>
      <JsonLdScripts
        schemas={[
          generateBreadcrumbSchema(siteUrl, [
            { name: "Classifyre", path: homeHref },
            { name: topic.name, path: topicPath(locale, id) },
          ]),
          generateFaqSchema(topic.faq),
        ]}
      />
      <noscript>
        <style>{".cl-reveal{opacity:1 !important;transform:none !important}"}</style>
      </noscript>

      <main className="flex w-full flex-col">
        {/* ── The answer, on the board ─────────────────────────────── */}
        <section
          aria-labelledby="topic-title"
          className="cl-bleed relative overflow-hidden bg-black text-white"
        >
          <ClosingBoard locale={locale} />
          <div className="relative mx-auto w-full max-w-7xl px-4 pb-40 pt-12 sm:px-6 lg:px-10 lg:pb-52 lg:pt-16">
            <nav aria-label="Breadcrumb" className="flex items-center gap-2">
              <a href={homeHref} className="group">
                <Micro className="text-white/55 transition-colors group-hover:text-accent">
                  Classifyre
                </Micro>
              </a>
              <Micro className="text-white/30">/</Micro>
              <Micro className="text-white/80">{topic.name}</Micro>
            </nav>

            <div className="mt-8 grid items-center gap-10 lg:grid-cols-12">
              <div className="space-y-7 lg:col-span-9">
                <ExhibitMark>{chrome.chip}</ExhibitMark>
                <h1
                  id="topic-title"
                  className="max-w-[20ch] font-hero text-[clamp(3rem,7.4vw,6.2rem)] uppercase leading-[0.88] tracking-[0.01em]"
                >
                  {topic.h1}
                </h1>
                <p className="max-w-2xl text-base leading-7 text-white/75 sm:text-lg sm:leading-8">
                  {topic.lede}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href="#run-it"
                    className="inline-flex items-center border-2 border-accent bg-accent px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:border-white hover:bg-white"
                  >
                    {chrome.runTitle}
                  </a>
                  <a
                    href={pilot}
                    className="inline-flex items-center border-2 border-white/25 px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white transition-colors hover:border-accent hover:text-accent"
                  >
                    {chrome.pilotCta}
                  </a>
                </div>
              </div>
              <div className="hidden justify-end lg:col-span-3 lg:flex">
                <Mascot
                  name={topic.mascot}
                  alt={topic.mascotAlt}
                  surface="dark"
                  tilt="right"
                  eager
                  className="h-52 w-auto"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ── The demo, lying across the band's edge ────────────────── */}
        <div className="relative z-10 mx-auto -mt-32 w-full max-w-5xl px-4 sm:px-6 lg:-mt-44">
          <div className="bg-black p-3 pb-10 sm:p-4 sm:pb-12">
            <Demo id={topic.demo} locale={locale} caption={topic.demoCaption} />
          </div>
        </div>

        {/* ── How Classifyre does it ───────────────────────────────── */}
        <LandingSection className="py-20 lg:py-24">
          <div aria-labelledby="points-title">
            <LandingHead id="points-title" mark={chrome.marks.points} title={topic.pointsTitle} />
            <ol className="mt-12 grid gap-6 md:grid-cols-2">
              {topic.points.map((point, index) => (
                <Enter key={point.title} as="li" delayMs={index * 90}>
                  <article className="h-full border-2 border-foreground/80 bg-card p-6">
                    <span className="font-hero text-4xl leading-none text-accent-ink dark:text-accent">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 className="mt-4 font-serif text-lg font-black uppercase leading-tight tracking-[0.04em]">
                      {point.title}
                    </h3>
                    <p className="mt-3 text-sm leading-7 text-muted-foreground">{point.body}</p>
                    {point.href ? (
                      <a
                        href={point.href}
                        className="mt-4 inline-block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent-ink underline-offset-4 hover:underline dark:text-accent"
                      >
                        {point.linkLabel} →
                      </a>
                    ) : null}
                  </article>
                </Enter>
              ))}
            </ol>
          </div>
        </LandingSection>

        {/* ── The longer explanation, on the reading measure ───────── */}
        <section
          aria-labelledby="detail-title"
          className="cl-bleed relative overflow-hidden bg-black py-20 text-white lg:py-24"
        >
          <div className="landing-grid absolute inset-0 opacity-[0.08]" />
          <div className="relative mx-auto grid w-full max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:px-10">
            <div className="space-y-4 lg:col-span-4">
              <ExhibitMark tone="outline-light">{chrome.marks.detail}</ExhibitMark>
              <h2
                id="detail-title"
                className="font-serif text-xl font-black uppercase leading-tight tracking-[0.04em]"
              >
                {topic.detail.title}
              </h2>
            </div>
            <div className="space-y-5 lg:col-span-7 lg:col-start-6">
              {topic.detail.paragraphs.map((paragraph) => (
                <p key={paragraph.slice(0, 32)} className="text-base leading-8 text-white/75">
                  {paragraph}
                </p>
              ))}
            </div>
          </div>
        </section>

        {topic.comparison ? (
          <LandingSection className="py-20 lg:py-24">
            <div aria-labelledby="compare-title">
              <LandingHead
                id="compare-title"
                mark={chrome.marks.compare}
                title={topic.comparison.title}
                lede={topic.comparison.asOf}
              />
              <div className="mt-10 overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-left">
                  <thead>
                    <tr className="border-b-2 border-foreground/80">
                      <th scope="col" className="w-[22%] py-2 pr-6">
                        <span className="sr-only">Aspect</span>
                      </th>
                      <th scope="col" className="w-[39%] py-2 pr-6">
                        <Micro className="text-muted-foreground">
                          {topic.comparison.columns.them}
                        </Micro>
                      </th>
                      <th scope="col" className="w-[39%] py-2">
                        <Micro className="text-accent-ink dark:text-accent">
                          {topic.comparison.columns.us}
                        </Micro>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {topic.comparison.rows.map((row) => (
                      <tr key={row.aspect} className="border-b border-foreground/20 align-top">
                        <th
                          scope="row"
                          className="py-4 pr-6 font-serif text-sm font-black uppercase tracking-[0.03em]"
                        >
                          {row.aspect}
                        </th>
                        <td className="py-4 pr-6 text-sm leading-6 text-muted-foreground">
                          {row.them}
                        </td>
                        <td className="py-4 text-sm leading-6 text-foreground/90">{row.us}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-6 max-w-3xl">
                <Micro className="leading-5 text-muted-foreground/80">{topic.comparison.note}</Micro>
              </p>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
                {topic.comparison.sources.map((source) => (
                  <a
                    key={source.href}
                    href={source.href}
                    rel="noreferrer"
                    className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent-ink underline-offset-4 hover:underline dark:text-accent"
                  >
                    {source.label} →
                  </a>
                ))}
              </div>
            </div>
          </LandingSection>
        ) : null}

        {/* ── What it does not do: one memo, said plainly ─────────── */}
        <LandingSection className={topic.comparison ? "pb-20 lg:pb-24" : "py-20 lg:py-24"}>
          <Enter>
            <div className="border-2 border-foreground/25 bg-muted/50 p-6 sm:p-8">
              <Micro className="text-accent-ink dark:text-accent">{chrome.marks.notDo}</Micro>
              <p className="mt-3 max-w-4xl text-base leading-8 sm:text-lg sm:leading-9">
                {topic.notDo.body}
              </p>
            </div>
          </Enter>
        </LandingSection>

        {/* ── Run it, or start with us ─────────────────────────────── */}
        <section
          id="run-it"
          aria-labelledby="run-title"
          className="cl-bleed relative overflow-hidden bg-black text-white"
        >
          <ClosingBoard locale={locale} />
          <div className="relative mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-10 lg:py-24">
            <LandingHead
              id="run-title"
              mark={chrome.marks.run}
              title={chrome.runTitle}
              lede={chrome.runBody}
              tone="dark"
            />
            <div className="mt-12 grid gap-10 lg:grid-cols-12">
              <div className="space-y-6 lg:col-span-7">
                <div className="border-2 border-white/20 bg-white/[0.04] p-5 sm:p-6">
                  <DockerRunBlock tone="dark" tag={softwareVersion} showNotes={false} />
                  <a
                    href={`${withLocalePrefix(locale, routes.get)}/`}
                    className="mt-4 inline-block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent underline-offset-4 hover:underline"
                  >
                    {chrome.runDocs} →
                  </a>
                </div>
                <div className="flex items-center gap-6 border-2 border-white/15 bg-white/[0.04] px-5 py-4">
                  <KubernetesLogo className="h-10 w-10 shrink-0 text-accent" />
                  <span aria-hidden="true" className="h-8 w-px bg-white/20" />
                  <HelmLogo className="h-10 w-10 shrink-0 text-accent" />
                  <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-[11px] leading-6 text-white/70">
                    <code>{helmInstallCommand.join("\n")}</code>
                  </pre>
                </div>
                <a
                  href={docs.kubernetes}
                  className="inline-block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent underline-offset-4 hover:underline"
                >
                  Helm →
                </a>
              </div>
              <div className="lg:col-span-5">
                <div className="border-l-2 border-accent/40 pl-5">
                  <div className="flex items-center gap-2">
                    <Pin />
                    <Micro className="text-white/85">{chrome.pilotTitle}</Micro>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-white/65">{chrome.pilotBody}</p>
                  <a
                    href={pilot}
                    className="mt-6 inline-flex items-center border-2 border-accent bg-accent px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:border-white hover:bg-white"
                  >
                    {chrome.pilotCta}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <FaqList
          id="topic-faq"
          mark={chrome.marks.faq}
          title={chrome.faqTitle}
          items={topic.faq}
          locale={locale}
        />

        {/* ── Related topics: the internal links crawlers follow too ── */}
        <section
          aria-labelledby="related-title"
          className="cl-bleed border-t-2 border-foreground/80 bg-background py-12"
        >
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-10">
            <h2 id="related-title">
              <Micro className="text-muted-foreground">{chrome.marks.related}</Micro>
            </h2>
            <ul className="mt-5 grid gap-4 sm:grid-cols-3">
              {topic.related.map((relatedId) => {
                const related = getTopic(locale, relatedId);
                return (
                  <li key={relatedId}>
                    <a
                      href={topicPath(locale, relatedId)}
                      className="group block h-full border-2 border-foreground/80 p-4 transition-colors hover:border-accent-ink dark:hover:border-accent"
                    >
                      <span className="block font-serif text-sm font-black uppercase tracking-[0.04em]">
                        {related.name}
                      </span>
                      <span className="mt-2 block text-sm leading-6 text-muted-foreground">
                        {related.metaTitle}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </main>
    </>
  );
}
