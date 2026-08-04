import type { Metadata } from "next";

import { Button } from "@workspace/ui/components";
import {
  SOURCE_CATEGORY_META,
  resolveSourceCatalogMeta,
  type SourceCatalogCategory,
} from "@workspace/ui/lib/source-catalog";
import { getAllSourceDocs } from "@workspace/schemas/source-docs";

import { Illustration } from "@/components/illustration";
import {
  DocsLink,
  PageHero,
  SectionHead,
  SectionShell,
} from "@/components/page-kit";
import { Reveal } from "@/components/reveal";
import {
  SourceCatalogSection,
  SourceMarquee,
  sourceCount,
} from "@/components/source-showcase";
import { docs, enterpriseContactEmail, routes } from "@/lib/site";

import "../landing.css";

const total = sourceCount();

export const metadata: Metadata = {
  title: "Supported Sources",
  description: `Every system Classifyre can scan — ${total} connectors across databases, warehouses and lakehouses, streaming, object storage, collaboration tools, analytics, and public content. Each connector links to its configuration reference.`,
  alternates: { canonical: routes.sources },
  openGraph: {
    title: "Classifyre — Supported Sources",
    description: `${total} connectors across databases, lakehouses, storage, collaboration tools, analytics, and public content.`,
    type: "website",
  },
};

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

/** What every connector gives you, regardless of which system it talks to. */
const commonCapabilities = [
  {
    illustration: "docs" as const,
    title: "Assets, not just rows",
    body: "Each connector yields assets with source metadata attached — owner, path, timestamps — so a finding always carries where it came from.",
    href: docs.sources,
    hrefLabel: "Assets & metadata",
  },
  {
    illustration: "probe" as const,
    title: "Test before you scan",
    body: "Every source can be dry-run from the app: check the credentials, see what it would read, and only then commit to a full scan.",
    href: docs.sourceTesting,
    hrefLabel: "Testing sources",
  },
  {
    illustration: "dna" as const,
    title: "Sampling that bounds cost",
    body: "Large tables and files are read through sampling windows with a per-asset cursor, so a scan reads a bounded slice instead of everything.",
    href: docs.sampling,
    hrefLabel: "Sampling",
  },
  {
    illustration: "finger-print" as const,
    title: "Cross-source fingerprints",
    body: "The same value showing up in two different systems gets linked by identity, which is where most real investigations actually begin.",
    href: docs.howItWorks,
    hrefLabel: "How it works",
  },
] as const;

export default function SourcesPage() {
  const breakdown = categoryBreakdown();

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
      <PageHero
        eyebrow="Sources"
        title={
          <>
            Scan the systems
            <br />
            you{" "}
            <span className="inline-block bg-accent px-[0.12em] text-black">
              already own.
            </span>
          </>
        }
        lede={
          <>
            <strong className="text-white">{total} connectors</strong> across
            databases, warehouses and lakehouses, streaming, object storage,
            collaboration tools, analytics, and public content — all feeding one
            evidence stream.
          </>
        }
        actions={
          <>
            <Button
              asChild
              size="lg"
              className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
            >
              <a href="#catalog">Browse the catalog</a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="secondary"
              className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
            >
              <a href={routes.download}>Download & connect one</a>
            </Button>
          </>
        }
      />

      {/* ── Marquee + breakdown ──────────────────────────────────────────── */}
      <section aria-labelledby="breakdown-title">
        <SectionShell tone="plain">
          <div className="space-y-8">
            <SourceMarquee />

            <SectionHead
              id="breakdown-title"
              marker="By category"
              title="Where the evidence comes from"
              lede="Connectors are grouped by what they are, not by vendor. Counts come straight from the schema, so this page can never drift from what the product actually supports."
            />

            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {breakdown.map((entry, index) => (
                <Reveal key={entry.category} as="li" delayMs={index * 60}>
                  <div className="flex h-full flex-col gap-2 border-2 border-border bg-background p-5 shadow-[4px_4px_0_var(--color-border)]">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-serif text-base font-black uppercase leading-tight tracking-[0.04em]">
                        {entry.label}
                      </span>
                      <span className="shrink-0 border-2 border-accent bg-accent px-1.5 py-0.5 font-mono text-[11px] font-black text-black">
                        {entry.count}
                      </span>
                    </div>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {entry.description}
                    </p>
                  </div>
                </Reveal>
              ))}
            </ul>
          </div>
        </SectionShell>
      </section>

      {/* ── The catalog ──────────────────────────────────────────────────── */}
      <section aria-labelledby="catalog-title" id="catalog">
        <SectionShell tone="signal">
          <div className="space-y-8">
            <SectionHead
              id="catalog-title"
              marker="Full catalog"
              tone="signal"
              illustration="binders"
              title={`All ${total} connectors`}
              lede="Search by name, category, or capability. Every entry links to its configuration reference on the docs site — required fields, auth, and a worked example."
              action={
                <DocsLink href={docs.sourceConfiguration} tone="signal">
                  Configuration reference
                </DocsLink>
              }
            />

            <SourceCatalogSection />
          </div>
        </SectionShell>
      </section>

      {/* ── What every connector does ────────────────────────────────────── */}
      <section aria-labelledby="capabilities-title">
        <SectionShell tone="plain">
          <div className="space-y-8">
            <SectionHead
              id="capabilities-title"
              marker="Every connector"
              title="What they all have in common"
              lede="The system on the other end changes. What Classifyre does with what it reads does not."
            />

            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {commonCapabilities.map((item, index) => (
                <Reveal key={item.title} as="li" delayMs={index * 80}>
                  <div className="flex h-full flex-col border-2 border-border bg-background shadow-[4px_4px_0_var(--color-border)]">
                    <div className="flex min-h-38 items-center justify-center px-5 py-6">
                      <Illustration
                        name={item.illustration}
                        tilt={index % 2 === 0 ? "left" : "right"}
                        className="h-28 w-28"
                      />
                    </div>
                    <div className="flex flex-1 flex-col gap-2 border-t-2 border-border p-5">
                      <p className="font-serif text-base font-black uppercase leading-tight tracking-[0.04em]">
                        {item.title}
                      </p>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {item.body}
                      </p>
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-auto pt-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-accent-foreground/70 underline-offset-4 hover:underline dark:text-accent"
                      >
                        {item.hrefLabel} →
                      </a>
                    </div>
                  </div>
                </Reveal>
              ))}
            </ul>
          </div>
        </SectionShell>
      </section>

      {/* ── Missing one ──────────────────────────────────────────────────── */}
      <section aria-labelledby="missing-title">
        <SectionShell tone="signal" fullWidth className="bg-black">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 py-4 text-center text-white">
            <Illustration
              name="settings"
              surface="inverted"
              tilt="right"
              className="h-24 w-24"
            />
            <h2
              id="missing-title"
              className="font-hero text-[clamp(2.5rem,7vw,5rem)] uppercase leading-[0.88] tracking-[0.01em]"
            >
              Missing the one{" "}
              <span className="inline-block bg-accent px-[0.12em] text-black">
                you need?
              </span>
            </h2>
            <p className="max-w-xl text-base leading-7 text-white/70">
              Connectors are plugins, and the project is open source — so the
              answer is either a pull request or a conversation. Enterprise
              customers get sources built for their industry&apos;s systems by
              our engineers.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button
                asChild
                size="lg"
                className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
              >
                <a
                  href="https://github.com/classifyre/classifyre/issues/new"
                  target="_blank"
                  rel="noreferrer"
                >
                  Request a connector
                </a>
              </Button>
              <Button
                asChild
                size="lg"
                variant="secondary"
                className="border-2 border-white/20 bg-white/10 text-white hover:bg-white/16"
              >
                <a href={`mailto:${enterpriseContactEmail}`}>
                  Talk to us about enterprise
                </a>
              </Button>
            </div>
          </div>
        </SectionShell>
      </section>
    </main>
  );
}
