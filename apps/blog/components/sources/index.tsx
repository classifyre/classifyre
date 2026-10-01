import {
  SOURCE_CATEGORY_META,
  resolveSourceCatalogMeta,
  type SourceCatalogCategory,
} from "@workspace/ui/lib/source-catalog";
import { getAllSourceDocs } from "@workspace/schemas/source-docs";

import { getSourcesCopy } from "@/content/sources";
import type { Locale } from "@/lib/locale";
import { withLocalePrefix } from "@/lib/locale";
import { docs, enterpriseContactEmail, repoUrl, routes } from "@/lib/site";
import { ClosingBoard } from "@/components/closing-board";
import { Mascot } from "@/components/mascot";
import {
  DotRow,
  Enter,
  ExhibitMark,
  LandingHead,
  LandingSection,
  Micro,
} from "@/components/landing/motifs";
import {
  SourceCatalogSection,
  SourceMarquee,
  sourceCount,
} from "@/components/source-showcase";

/**
 * /sources (Supported Sources), in the case-dossier language of the landing
 * page: a black poster band with the investigator and the live connector
 * count, the drifting connector tape, the schema-derived catalogue kept
 * exactly as it is, the category breakdown set as a paper index of dot
 * leaders, what every connector gives you as hairline editorial rows, and a
 * black closing board. Shared by both locales; every string comes from
 * `@/content/sources`, every URL from `@/lib/site`.
 */

/* ── Data: counted from the schema, never hand-maintained ────────────── */

/** Category counts, derived from the schema rather than hand-maintained. */
function categoryBreakdown(): {
  category: SourceCatalogCategory;
  label: string;
  description: string;
  count: number;
}[] {
  const counts = new Map<SourceCatalogCategory, number>();
  for (const source of getAllSourceDocs()) {
    const { category } = resolveSourceCatalogMeta(source.sourceType);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  return (Object.keys(SOURCE_CATEGORY_META) as SourceCatalogCategory[])
    .map((category) => ({
      category,
      label: SOURCE_CATEGORY_META[category].label,
      description: SOURCE_CATEGORY_META[category].description,
      count: counts.get(category) ?? 0,
    }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.count - left.count);
}

/** Substitutes the live connector count into a copy template. */
function withCount(template: string, count: number): string {
  return template.replace("{count}", String(count));
}

/* ── Page ───────────────────────────────────────────────────────────── */

export function SourcesPage({ locale }: { locale: Locale }) {
  const copy = getSourcesCopy(locale);
  const total = sourceCount();
  const breakdown = categoryBreakdown();
  /** Localized marketing routes keep the site's trailing-slash convention. */
  const getHref =
    locale === "de" ? `${withLocalePrefix("de", routes.get)}/` : routes.get;

  return (
    <>
      {/* Without JS the in-view reveals never fire; show everything. */}
      <noscript>
        <style>{".cl-reveal{opacity:1 !important;transform:none !important}"}</style>
      </noscript>
      <main className="flex w-full flex-col">
        {/* ── Hero band ───────────────────────────────────────────── */}
        <section
          aria-labelledby="sources-hero-title"
          className="cl-bleed relative overflow-hidden bg-black text-white"
        >
          <div className="landing-grid absolute inset-0 opacity-[0.10]" />
          <div className="relative mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-10 lg:py-24">
            <div className="grid items-center gap-10 lg:grid-cols-12">
              <div className="space-y-6 lg:col-span-8">
                <ExhibitMark>{copy.hero.mark}</ExhibitMark>
                <h1
                  id="sources-hero-title"
                  className="font-hero text-[clamp(3rem,8vw,6.5rem)] uppercase leading-[0.88] tracking-[0.01em] text-white"
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
                  <strong className="text-white">
                    {total} {copy.hero.lede.count}
                  </strong>{" "}
                  {copy.hero.lede.tail}
                </p>
                <Micro className="block text-white/40">
                  {withCount(copy.hero.micro, total)}
                </Micro>
                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href="#catalog"
                    className="inline-flex items-center border-2 border-accent bg-accent px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:border-white hover:bg-white"
                  >
                    {copy.hero.ctaCatalog}
                  </a>
                  <a
                    href={getHref}
                    className="inline-flex items-center border-2 border-white/25 px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white transition-colors hover:border-accent hover:text-accent"
                  >
                    {copy.hero.ctaGet}
                  </a>
                </div>
              </div>

              {/* The investigator shows the hidden gem under the loupe. */}
              <div className="flex justify-center lg:col-span-4 lg:justify-end">
                <Mascot
                  name="hidden-gem"
                  alt={copy.mascots.hiddenGem}
                  surface="dark"
                  className="hidden h-56 w-auto lg:block"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ── The connector tape ──────────────────────────────────── */}
        <div className="cl-bleed border-y-2 border-foreground/80 bg-background">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-10">
            <SourceMarquee />
          </div>
        </div>

        {/* ── The catalogue, kept as it is ────────────────────────── */}
        <section id="catalog" aria-labelledby="catalog-title">
          <LandingSection className="py-20 lg:py-28">
            <LandingHead
              id="catalog-title"
              mark={copy.catalog.marker}
              title={withCount(copy.catalog.title, total)}
              lede={copy.catalog.lede}
              aside={
                <a
                  href={docs.sourceConfiguration}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent-ink underline-offset-4 hover:underline dark:text-accent"
                >
                  {copy.catalog.action} →
                </a>
              }
            />
            <div className="mt-12">
              <SourceCatalogSection locale={locale} />
            </div>
          </LandingSection>
        </section>

        {/* ── The categories, as a paper index ────────────────────── */}
        <section aria-labelledby="categories-title">
          <LandingSection className="pb-20 lg:pb-28">
            <LandingHead
              id="categories-title"
              mark={copy.categories.marker}
              title={copy.categories.title}
              lede={copy.categories.lede}
            />

            <div className="mt-12">
              <div className="border-b-2 border-foreground/80 pb-2">
                <DotRow
                  label={copy.categories.label}
                  value={copy.categories.shortLabel}
                />
              </div>
              <ul className="grid gap-x-12 lg:grid-cols-2">
                {breakdown.map((entry, index) => (
                  <Enter
                    key={entry.category}
                    as="li"
                    delayMs={index * 50}
                    className="border-b border-foreground/15 py-4"
                  >
                    <DotRow label={entry.label} value={entry.count} />
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {entry.description}
                    </p>
                  </Enter>
                ))}
              </ul>
            </div>
          </LandingSection>
        </section>

        {/* ── What every connector gives you ──────────────────────── */}
        <section aria-labelledby="capabilities-title">
          <LandingSection className="pb-20 lg:pb-28">
            <LandingHead
              id="capabilities-title"
              mark={copy.capabilities.marker}
              title={copy.capabilities.title}
              lede={copy.capabilities.lede}
            />

            <div className="mt-12 grid gap-x-12 lg:grid-cols-2">
              {copy.capabilities.items.map((item, index) => (
                <Enter key={item.title} delayMs={index * 70}>
                  <article className="border-t-2 border-foreground/80 py-6">
                    <h3 className="font-serif text-base font-black uppercase tracking-[0.04em]">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {item.body}
                    </p>
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent-ink underline-offset-4 hover:underline dark:text-accent"
                    >
                      {item.hrefLabel} →
                    </a>
                  </article>
                </Enter>
              ))}
            </div>
          </LandingSection>
        </section>

        {/* ── Closing ─────────────────────────────────────────────── */}
        <section
          aria-labelledby="sources-cta-title"
          className="cl-bleed relative overflow-hidden bg-black text-white"
        >
          <ClosingBoard locale={locale} />
          <div className="relative mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-4 py-20 text-center sm:px-6 lg:py-24">
            <h2
              id="sources-cta-title"
              className="font-hero text-[clamp(2.5rem,7vw,5rem)] uppercase leading-[0.88] tracking-[0.01em]"
            >
              {copy.closing.titleLead}{" "}
              <span className="inline-block bg-accent px-[0.12em] text-black">
                {copy.closing.titleHighlight}
              </span>
            </h2>
            <p className="max-w-xl text-base leading-7 text-white/70">
              {copy.closing.body}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <a
                href={`${repoUrl}/issues/new`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center border-2 border-accent bg-accent px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:border-white hover:bg-white"
              >
                {copy.closing.ctaPrimary}
              </a>
              <a
                href={`mailto:${enterpriseContactEmail}`}
                className="inline-flex items-center border-2 border-white/25 px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white transition-colors hover:border-accent hover:text-accent"
              >
                {copy.closing.ctaSecondary}
              </a>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
