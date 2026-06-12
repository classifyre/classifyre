import type { Metadata } from "next";

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
    "Schema-driven source documentation generated from all_input_sources.json and all_input_examples.json.",
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
    { id: "sources-catalog", value: "Source Catalog" },
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
        </header>

        <section id="sources-catalog" className="scroll-mt-24">
          <SourceCatalog entries={catalogEntries} />
        </section>
      </div>
    </NextraPageShell>
  );
}
