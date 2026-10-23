import type { Metadata } from "next";

import GlossaryTermDetail from "@/components/glossary/term-detail";
import { firstParam, termTabOf } from "@/lib/glossary-tabs";
import { isLocale } from "@/lib/locale-detection";
import { seoEntityName } from "@/lib/seo-entity";
import {
  entityMetadata,
  sectionMetadata,
  tabMetadata,
} from "@/lib/seo-metadata";

/**
 * A term's title and description name the term, and each tab (`?tab=evidence`)
 * says what it shows. Without a resolvable name it falls back to the generic
 * copy rather than printing the key.
 */
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; namespaceSlug: string; key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { locale, namespaceSlug, key } = await params;
  if (!isLocale(locale)) return {};
  const path = `/glossary/terms/${key}`;
  const name = await seoEntityName("term", namespaceSlug, key);
  if (!name) {
    return sectionMetadata(locale, "seo.glossaryTerm", { namespaceSlug, path });
  }

  const tab = termTabOf(firstParam((await searchParams).tab));
  if (!tab || tab === "overview") {
    return entityMetadata(locale, "seo.glossaryTerm", name, {
      namespaceSlug,
      path,
    });
  }
  return tabMetadata(locale, `seo.glossaryTerm.tabs.${tab}`, name, {
    namespaceSlug,
    path,
    query: `tab=${tab}`,
  });
}

export default function GlossaryTermPage() {
  return <GlossaryTermDetail />;
}
