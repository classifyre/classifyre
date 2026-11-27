import { ArrowDown, Check, Minus } from "lucide-react";

import {
  DockerRunBlock,
  HelmLogo,
  KubernetesLogo,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";

import {
  getTopic,
  getTopicChrome,
  topicPath,
  type TopicId,
} from "@/content/topics";
import type { ScorecardLevel, TopicComparison } from "@/content/topics/types";
import type { Locale } from "@/lib/locale";
import { withLocalePrefix } from "@/lib/locale";
import {
  JsonLdScripts,
  generateBreadcrumbSchema,
  generateFaqSchema,
  generateTechArticleSchema,
  siteOrigin,
} from "@/lib/seo";
import {
  docs,
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

/**
 * Visual capability meter: 3 bars = Native, 2 = Supported, 1 = Partial, 0 = Not included.
 * Clean, objective, no star-rating gimmicks.
 */
function LevelMeter({
  level,
  label,
  highlight = false,
}: {
  level: ScorecardLevel;
  label: string;
  highlight?: boolean;
}) {
  const filled =
    level === "native" ? 3 : level === "supported" ? 2 : level === "partial" ? 1 : 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1" aria-hidden="true">
        {[0, 1, 2].map((slot) => (
          <span
            key={slot}
            className={cn(
              "h-2 w-7 border transition-colors",
              slot < filled
                ? highlight
                  ? "border-black bg-accent dark:border-accent"
                  : "border-foreground/70 bg-foreground/75"
                : "border-foreground/20 bg-transparent",
            )}
          />
        ))}
      </div>
      <span
        className={cn(
          "font-mono text-[11px] leading-4",
          level === "none"
            ? "text-muted-foreground/70"
            : highlight && level === "native"
              ? "font-semibold text-foreground"
              : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </div>
  );
}

/** Side-by-side visual architecture diagram comparing how each platform enforces governance. */
function ArchitectureComparison({
  mark,
  arch,
}: {
  mark: string;
  arch: NonNullable<TopicComparison["architecture"]>;
}) {
  const sides = [
    { data: arch.them, accent: false },
    { data: arch.us, accent: true },
  ] as const;

  return (
    <section
      aria-labelledby="arch-compare-title"
      className="cl-bleed relative overflow-hidden bg-black py-20 text-white lg:py-24"
    >
      <div className="landing-grid absolute inset-0 opacity-[0.07]" />
      <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-10">
        <LandingHead
          id="arch-compare-title"
          mark={mark}
          title={arch.title}
          lede={arch.lede}
          tone="dark"
        />

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {sides.map(({ data, accent }) => (
            <div
              key={data.name}
              className={cn(
                "flex flex-col justify-between border-2 p-6 sm:p-7",
                accent
                  ? "border-accent bg-white/[0.04]"
                  : "border-white/20 bg-white/[0.02]",
              )}
            >
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/15 pb-4">
                  <h3 className="font-sans text-xl font-bold text-white">
                    {data.name}
                  </h3>
                  <Micro className={accent ? "text-accent" : "text-white/55"}>
                    {data.badge}
                  </Micro>
                </div>

                <ol className="mt-6 space-y-3">
                  {data.flow.map((item, idx) => (
                    <li key={item.step}>
                      <div
                        className={cn(
                          "border p-4",
                          accent
                            ? "border-white/20 bg-black/50"
                            : "border-white/15 bg-black/35",
                        )}
                      >
                        <Micro className={accent ? "text-accent" : "text-white/60"}>
                          {item.step}
                        </Micro>
                        <p className="mt-1.5 text-sm leading-6 text-white/85">
                          {item.detail}
                        </p>
                      </div>
                      {idx < data.flow.length - 1 ? (
                        <div className="flex justify-center py-1 text-white/35" aria-hidden="true">
                          <ArrowDown className="size-4" />
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>

              <p
                className={cn(
                  "mt-6 border-l-4 pl-4 text-sm leading-6",
                  accent
                    ? "border-accent text-white/85"
                    : "border-white/30 text-white/65",
                )}
              >
                {data.takeaway}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Visual scorecard + 2x2 honest strengths & limitations + decision guide. */
function ComparisonDeepDive({
  comparison,
  marks,
}: {
  comparison: TopicComparison;
  marks: {
    architecture: string;
    scorecard: string;
    tradeoffs: string;
    decision: string;
    compare: string;
  };
}) {
  return (
    <>
      {comparison.architecture ? (
        <ArchitectureComparison
          mark={marks.architecture}
          arch={comparison.architecture}
        />
      ) : null}

      {/* Visual Capability Scorecard */}
      {comparison.scorecard ? (
        <LandingSection className="py-20 lg:py-24">
          <div aria-labelledby="scorecard-title">
            <LandingHead
              id="scorecard-title"
              mark={marks.scorecard}
              title={comparison.scorecard.title}
              lede={comparison.scorecard.lede}
            />

            <div className="mt-10 overflow-x-auto">
              <div className="min-w-[600px] border-2 border-foreground/80 bg-card">
                <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] gap-6 border-b-2 border-foreground/80 bg-muted/40 px-5 py-3">
                  <Micro className="text-muted-foreground">{comparison.columns.aspect}</Micro>
                  <Micro className="text-muted-foreground">{comparison.columns.them}</Micro>
                  <Micro className="text-accent-ink dark:text-accent">{comparison.columns.us}</Micro>
                </div>
                <ul className="divide-y divide-foreground/15">
                  {comparison.scorecard.items.map((item) => (
                    <li
                      key={item.dimension}
                      className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-6 px-5 py-4"
                    >
                      <span className="font-sans text-sm font-semibold leading-snug text-foreground">
                        {item.dimension}
                      </span>
                      <LevelMeter level={item.them.level} label={item.them.label} />
                      <LevelMeter level={item.us.level} label={item.us.label} highlight />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </LandingSection>
      ) : null}

      {/* Balanced 2x2 Strengths & Honest Limitations */}
      {comparison.tradeoffs ? (
        <section
          aria-labelledby="tradeoffs-title"
          className="cl-bleed border-y-2 border-foreground/15 bg-muted/35 py-20 lg:py-24"
        >
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-10">
            <LandingHead
              id="tradeoffs-title"
              mark={marks.tradeoffs}
              title={comparison.tradeoffs.title}
              lede={comparison.tradeoffs.lede}
            />

            <div className="mt-12 grid gap-6 md:grid-cols-2">
              {[
                { block: comparison.tradeoffs.themPros, kind: "pro", accent: false },
                { block: comparison.tradeoffs.usPros, kind: "pro", accent: true },
                { block: comparison.tradeoffs.themCons, kind: "con", accent: false },
                { block: comparison.tradeoffs.usCons, kind: "con", accent: false },
              ].map(({ block, kind, accent }) => (
                <article
                  key={block.heading}
                  className={cn(
                    "flex h-full flex-col border-2 bg-background p-6",
                    accent
                      ? "border-foreground/90 shadow-[6px_6px_0_var(--color-accent)]"
                      : "border-foreground/25",
                  )}
                >
                  <h3 className="font-sans text-lg font-bold text-foreground">
                    {block.heading}
                  </h3>
                  <ul className="mt-4 space-y-3">
                    {block.items.map((text) => (
                      <li key={text} className="flex items-start gap-3 text-sm leading-6 text-muted-foreground">
                        {kind === "pro" ? (
                          <span
                            aria-hidden="true"
                            className={cn(
                              "mt-1 inline-flex size-4 shrink-0 items-center justify-center",
                              accent
                                ? "bg-accent text-black"
                                : "bg-foreground/15 text-foreground",
                            )}
                          >
                            <Check className="size-3" strokeWidth={2.6} />
                          </span>
                        ) : (
                          <span
                            aria-hidden="true"
                            className="mt-1 inline-flex size-4 shrink-0 items-center justify-center border border-foreground/30 text-muted-foreground"
                          >
                            <Minus className="size-3" strokeWidth={2.4} />
                          </span>
                        )}
                        <span>{text}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Executive Decision Guide */}
      {comparison.chooseWhen ? (
        <LandingSection className="pt-20 lg:pt-24">
          <div aria-labelledby="decision-title">
            <LandingHead
              id="decision-title"
              mark={marks.decision}
              title={comparison.chooseWhen.title}
            />
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              <article className="border-2 border-foreground/30 bg-card p-6 sm:p-7">
                <h3 className="font-sans text-lg font-bold text-foreground">
                  {comparison.chooseWhen.them.heading}
                </h3>
                <ul className="mt-4 space-y-3">
                  {comparison.chooseWhen.them.items.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm leading-6 text-muted-foreground">
                      <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 bg-foreground/50" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>

              <article className="border-2 border-black bg-black p-6 text-white sm:p-7 dark:border-accent">
                <h3 className="font-sans text-lg font-bold text-white">
                  {comparison.chooseWhen.us.heading}
                </h3>
                <ul className="mt-4 space-y-3">
                  {comparison.chooseWhen.us.items.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm leading-6 text-white/80">
                      <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 bg-accent" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            </div>
          </div>
        </LandingSection>
      ) : null}

      {/* Detailed Sourced Specification Table */}
      <LandingSection className="py-20 lg:py-24">
        <div aria-labelledby="compare-title">
          <LandingHead
            id="compare-title"
            mark={marks.compare}
            title={comparison.title}
            lede={comparison.asOf}
          />
          <div className="mt-10 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b-2 border-foreground/80">
                  <th scope="col" className="w-[22%] py-2.5 pr-6">
                    <Micro className="text-muted-foreground">{comparison.columns.aspect}</Micro>
                  </th>
                  <th scope="col" className="w-[39%] py-2.5 pr-6">
                    <Micro className="text-muted-foreground">
                      {comparison.columns.them}
                    </Micro>
                  </th>
                  <th scope="col" className="w-[39%] py-2.5">
                    <Micro className="text-accent-ink dark:text-accent">
                      {comparison.columns.us}
                    </Micro>
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((row) => (
                  <tr key={row.aspect} className="border-b border-foreground/20 align-top">
                    <th
                      scope="row"
                      className="py-4 pr-6 font-sans text-sm font-bold text-foreground"
                    >
                      {row.aspect}
                    </th>
                    <td className="py-4 pr-6 text-sm leading-6 text-muted-foreground">
                      {row.them}
                    </td>
                    <td className="py-4 text-sm leading-6 text-foreground/95">{row.us}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-6 max-w-3xl text-xs leading-5 text-muted-foreground">
            {comparison.note}
          </p>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            {comparison.sources.map((source) => (
              <a
                key={source.href}
                href={source.href}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent-ink underline-offset-4 hover:underline dark:text-accent"
              >
                {source.label} →
              </a>
            ))}
          </div>
        </div>
      </LandingSection>
    </>
  );
}

export function TopicPage({ locale, id }: { locale: Locale; id: TopicId }) {
  const topic = getTopic(locale, id);
  const chrome = getTopicChrome(locale);
  const siteUrl = siteOrigin();
  const home = withLocalePrefix(locale, routes.home);
  const homeHref = home === "/" ? "/" : `${home}/`;
  const canonicalPath = topicPath(locale, id);

  return (
    <>
      <JsonLdScripts
        schemas={[
          generateBreadcrumbSchema(siteUrl, [
            { name: "Classifyre", path: homeHref },
            { name: topic.name, path: canonicalPath },
          ]),
          generateTechArticleSchema({
            siteUrl,
            path: canonicalPath,
            headline: topic.h1,
            description: topic.metaDescription,
            locale,
            keywords: topic.keywords,
          }),
          generateFaqSchema(topic.faq),
        ]}
      />
      <noscript>
        <style>{".cl-reveal{opacity:1 !important;transform:none !important}"}</style>
      </noscript>

      <main className="flex w-full flex-col">
        {/* ── Hero ──────────────────────────────────────────────────── */}
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

            <div className="mt-8 max-w-4xl space-y-7">
              <ExhibitMark>{chrome.chip}</ExhibitMark>
              <h1
                id="topic-title"
                className="max-w-[22ch] font-hero text-[clamp(3rem,7vw,5.6rem)] uppercase leading-[0.88] tracking-[0.01em]"
              >
                {topic.h1}
              </h1>
              <p className="max-w-3xl text-base leading-7 text-white/80 sm:text-lg sm:leading-8">
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
                  href={`${withLocalePrefix(locale, routes.support)}/`}
                  className="inline-flex items-center border-2 border-white/30 px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white transition-colors hover:border-accent hover:text-accent"
                >
                  {chrome.tailoringCta}
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ── Live product demo ─────────────────────────────────────── */}
        <div className="relative z-10 mx-auto -mt-32 w-full max-w-5xl px-4 sm:px-6 lg:-mt-44">
          <div className="bg-black p-3 pb-10 sm:p-4 sm:pb-12">
            <Demo id={topic.demo} locale={locale} caption={topic.demoCaption} />
          </div>
        </div>

        {/* ── Core differences / how it works ───────────────────────── */}
        <LandingSection className="py-20 lg:py-24">
          <div aria-labelledby="points-title">
            <LandingHead id="points-title" mark={chrome.marks.points} title={topic.pointsTitle} />
            <ol className="mt-12 grid gap-6 md:grid-cols-2">
              {topic.points.map((point, index) => (
                <Enter key={point.title} as="li" delayMs={index * 70}>
                  <article className="h-full border-2 border-foreground/80 bg-card p-6">
                    <span className="font-hero text-4xl leading-none text-accent-ink dark:text-accent">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 className="mt-4 font-sans text-lg font-bold leading-snug text-foreground">
                      {point.title}
                    </h3>
                    <p className="mt-2.5 text-sm leading-7 text-muted-foreground">{point.body}</p>
                    {point.href ? (
                      <a
                        href={point.href}
                        target="_blank"
                        rel="noreferrer"
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

        {/* ── Deep architectural comparison (for vs Immuta / vs Unity Catalog) ── */}
        {topic.comparison ? (
          <ComparisonDeepDive comparison={topic.comparison} marks={chrome.marks} />
        ) : null}

        {/* ── Detailed narrative analysis ───────────────────────────── */}
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
                className="font-sans text-2xl font-bold leading-snug text-white"
              >
                {topic.detail.title}
              </h2>
            </div>
            <div className="space-y-5 lg:col-span-7 lg:col-start-6">
              {topic.detail.paragraphs.map((paragraph) => (
                <p key={paragraph.slice(0, 32)} className="text-base leading-8 text-white/80">
                  {paragraph}
                </p>
              ))}
            </div>
          </div>
        </section>

        {/* ── Scope & boundaries ────────────────────────────────────── */}
        <LandingSection className="py-16 lg:py-20">
          <Enter>
            <div className="border-2 border-foreground/25 bg-muted/40 p-6 sm:p-8">
              <Micro className="text-accent-ink dark:text-accent">{chrome.marks.notDo}</Micro>
              <p className="mt-3 max-w-4xl text-base leading-8 text-foreground sm:text-lg">
                {topic.notDo.body}
              </p>
            </div>
          </Enter>
        </LandingSection>

        {/* ── Deploy or collaborate ─────────────────────────────────── */}
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
                  <p className="mt-3 text-xs leading-6 text-white/70">
                    {locale === "de" ? (
                      <>
                        Anschließend <span className="font-mono text-white">localhost:3000</span>{" "}
                        öffnen und mit <span className="font-mono text-accent">admin / admin</span>{" "}
                        anmelden (temporäres Passwort – beim ersten Anmelden vergeben Sie ein neues).
                      </>
                    ) : (
                      <>
                        Then open <span className="font-mono text-white">localhost:3000</span> and
                        sign in with <span className="font-mono text-accent">admin / admin</span>{" "}
                        (temporary password — you will be asked to choose a new one on first sign-in).
                      </>
                    )}
                  </p>
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
                  <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-[11px] leading-6 text-white/75">
                    <code>{helmInstallCommand.join("\n")}</code>
                  </pre>
                </div>
                <a
                  href={docs.kubernetes}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent underline-offset-4 hover:underline"
                >
                  Kubernetes & OpenShift Helm docs →
                </a>
              </div>
              <div className="lg:col-span-5">
                <div className="border-l-2 border-accent/40 pl-5">
                  <div className="flex items-center gap-2">
                    <Pin />
                    <Micro className="text-white/90">{chrome.tailoringTitle}</Micro>
                  </div>
                  <p className="mt-2.5 text-sm leading-7 text-white/70">{chrome.tailoringBody}</p>
                  <a
                    href={`${withLocalePrefix(locale, routes.support)}/`}
                    className="mt-6 inline-flex items-center border-2 border-accent bg-accent px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:border-white hover:bg-white"
                  >
                    {chrome.tailoringCta}
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

        {/* ── Related comparisons & guides ──────────────────────────── */}
        <section
          aria-labelledby="related-title"
          className="cl-bleed border-t-2 border-foreground/80 bg-background py-12"
        >
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-10">
            <h2 id="related-title">
              <Micro className="text-muted-foreground">{chrome.marks.related}</Micro>
            </h2>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {topic.related.map((relatedId) => {
                const related = getTopic(locale, relatedId);
                return (
                  <li key={relatedId}>
                    <a
                      href={topicPath(locale, relatedId)}
                      className="group block h-full border-2 border-foreground/80 p-5 transition-colors hover:border-accent-ink dark:hover:border-accent"
                    >
                      <span className="block font-sans text-base font-bold text-foreground">
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
