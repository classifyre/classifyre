import type { Metadata } from "next";

import { isLocale } from "@/lib/locale-detection";
import { sectionMetadata } from "@/lib/seo-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; namespaceSlug: string; key: string }>;
}): Promise<Metadata> {
  const { locale, namespaceSlug, key } = await params;
  if (!isLocale(locale)) return {};
  return sectionMetadata(locale, "seo.glossary", {
    namespaceSlug,
    path: `/glossary/terms/${key}`,
  });
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
