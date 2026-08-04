import { SourceCatalog, SourceIcon } from "@workspace/ui/components";
import {
  resolveSourceCatalogMeta,
  SOURCE_TYPE_CATALOG_META,
  type SourceCatalogEntry,
} from "@workspace/ui/lib/source-catalog";
import { getAllSourceDocs } from "@workspace/schemas/source-docs";

import { docs } from "@/lib/site";

/**
 * The connector catalogue, shared by the landing page's Sources section and
 * the dedicated /sources page. Both read from the same schema-derived list
 * (`getAllSourceDocs`), so adding a connector to the schema adds it here with
 * no marketing-copy edit.
 */

const marqueeSeed = Object.keys(SOURCE_TYPE_CATALOG_META).map((type) => ({
  type,
  ...resolveSourceCatalogMeta(type),
}));

/** Doubled so the CSS marquee can loop without a visible seam. */
const marqueeEntries = [...marqueeSeed, ...marqueeSeed];

export function sourceCount(): number {
  return getAllSourceDocs().length;
}

/** Catalogue entries, each linking to that connector's page on the docs site. */
export function sourceCatalogEntries(): SourceCatalogEntry[] {
  return getAllSourceDocs()
    .map((source) => ({
      type: source.sourceType,
      href: `${docs.sources}${source.slug}/`,
      ...resolveSourceCatalogMeta(source.sourceType, { label: source.label }),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function SourceMarquee() {
  return (
    <div className="edge-fade-x overflow-hidden py-3">
      <div className="marquee-track-slow flex w-max items-stretch gap-14 py-6">
        {marqueeEntries.map((entry, index) => (
          <div
            key={`${entry.type}-${index}`}
            className="flex min-w-40 flex-col items-center justify-center gap-4 px-5 text-center"
          >
            <SourceIcon
              source={String(entry.icon)}
              size="lg"
              className="[&_svg]:h-14 [&_svg]:w-14 [&_svg]:text-foreground"
            />
            <span className="max-w-32 text-base font-medium uppercase tracking-[0.08em]">
              {entry.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SourceCatalogSection() {
  return <SourceCatalog entries={sourceCatalogEntries()} />;
}
