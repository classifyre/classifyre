import type { Metadata } from "next";

import { GlossaryWorkspace } from "@/components/glossary/glossary-workspace";
import { firstParam, glossaryTabOf } from "@/lib/glossary-tabs";
import { isLocale } from "@/lib/locale-detection";
import { tabMetadata } from "@/lib/seo-metadata";

/**
 * Each glossary tab is its own address (`?tab=entities`) with its own title and
 * description. The default tab keeps the section copy from the layout.
 */
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; namespaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { locale, namespaceSlug } = await params;
  if (!isLocale(locale)) return {};
  const tab = glossaryTabOf(firstParam((await searchParams).tab));
  if (!tab || tab === "concepts") return {};
  return tabMetadata(locale, `seo.glossary.tabs.${tab}`, null, {
    namespaceSlug,
    path: "/glossary",
    query: `tab=${tab}`,
  });
}

export default function GlossaryPage() {
  return <GlossaryWorkspace />;
}
