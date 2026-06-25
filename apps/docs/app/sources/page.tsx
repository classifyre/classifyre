import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@workspace/ui/components";
import { SourceCatalog } from "@workspace/ui/components/source-catalog";
import {
  resolveSourceCatalogMeta,
  type SourceCatalogEntry,
} from "@workspace/ui/lib/source-catalog";
import { getAllSourceDocs } from "@workspace/schemas/source-docs";

import { NextraPageShell } from "@/components/nextra-page-shell";
import { buildSourcesOverviewCopy } from "@/lib/source-copy";

export const metadata: Metadata = {
  title: "Sources",
  description:
    "How sources work in Classifyre: connect a system, configure required, masked, and optional fields, choose a sampling strategy, enable OCR and transcription, test the connection, and schedule scans. Plus a catalog of every supported source type.",
};

export default function SourcesPage() {
  const sources = getAllSourceDocs();
  const totalExamples = sources.reduce(
    (sum, source) => sum + source.examples.length,
    0,
  );
  const sourceCode = buildSourcesOverviewCopy(sources);
  const tocItems = [
    { id: "sources-overview", value: "Overview" },
    { id: "sources-concepts", value: "Learn the concepts" },
    { id: "sources-catalog", value: "Source Catalog" },
  ];

  const conceptLinks = [
    {
      href: "/sources/how-it-works",
      title: "How Sources Work",
      description:
        "What a source is, the parts of its configuration, and the journey from connecting a system to producing findings.",
    },
    {
      href: "/sources/configuration",
      title: "Configuration & Fields",
      description:
        "Required (mandatory), masked (secret), and optional fields — how they are validated and how secrets are stored.",
    },
    {
      href: "/sources/sampling",
      title: "Sampling Strategies",
      description:
        "Automatic, Latest, Random, and All — how each works, what the controls do, and how to choose.",
    },
    {
      href: "/sources/content-extraction",
      title: "OCR & Transcription",
      description:
        "Read text inside images and documents, and turn audio and video into text for detectors.",
    },
    {
      href: "/sources/testing",
      title: "Testing & Scheduling",
      description:
        "Confirm a source connects before scanning, then automate scans on a recurring schedule.",
    },
  ];

  const catalogEntries: SourceCatalogEntry[] = sources
    .map((source) => {
      const catalogMeta = resolveSourceCatalogMeta(source.sourceType, {
        label: source.label,
      });

      return {
        type: source.sourceType,
        href: `/sources/${source.slug}`,
        ...catalogMeta,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));

  return (
    <NextraPageShell
      title="Sources"
      filePath="app/sources/page.tsx"
      toc={tocItems}
      sourceCode={sourceCode}
    >
      <div className="space-y-8">
        <header id="sources-overview" className="scroll-mt-24 space-y-4">
          <h1 className="font-serif text-4xl font-black uppercase tracking-[0.08em] text-foreground sm:text-5xl">
            Sources
          </h1>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">{sources.length} source types</Badge>
            <Badge variant="outline">{totalExamples} examples</Badge>
          </div>
          <p className="max-w-3xl leading-7 text-muted-foreground">
            A <strong className="text-foreground">source</strong> is a connection
            to a system you already run — a database, a data lake, a collaboration
            tool, a content platform. Classifyre scans it, turns its contents into{" "}
            <strong className="text-foreground">assets</strong>, runs{" "}
            <Link
              href="/detectors"
              className="font-semibold text-foreground underline decoration-accent decoration-2 underline-offset-2"
            >
              detectors
            </Link>{" "}
            over them, and records any{" "}
            <strong className="text-foreground">findings</strong>. Each source
            type below has its own reference page generated from its schema; the
            concept guides explain the ideas shared by all of them.
          </p>
        </header>

        <section id="sources-concepts" className="scroll-mt-24 space-y-4">
          <h2 className="border-b-2 border-border pb-2 font-serif text-2xl font-black uppercase tracking-[0.06em] text-foreground sm:text-3xl">
            Learn the concepts
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {conceptLinks.map((concept) => (
              <Link
                key={concept.href}
                href={concept.href}
                className="group flex flex-col gap-2 rounded-[6px] border-2 border-border bg-background p-4 shadow-[4px_4px_0_var(--color-border)] transition-all hover:-translate-y-0.5 hover:shadow-[6px_6px_0_var(--color-border)]"
              >
                <span className="font-serif text-lg font-black uppercase leading-tight tracking-[0.04em] text-foreground">
                  {concept.title}
                </span>
                <span className="text-sm leading-6 text-muted-foreground">
                  {concept.description}
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section id="sources-catalog" className="scroll-mt-24 space-y-4">
          <h2 className="border-b-2 border-border pb-2 font-serif text-2xl font-black uppercase tracking-[0.06em] text-foreground sm:text-3xl">
            Source Catalog
          </h2>
          <SourceCatalog entries={catalogEntries} />
        </section>
      </div>
    </NextraPageShell>
  );
}
