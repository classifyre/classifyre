import type { Metadata } from "next";

import { isLocale } from "@/lib/locale-detection";
import { sectionMetadata } from "@/lib/seo-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; namespaceSlug: string }>;
}): Promise<Metadata> {
  const { locale, namespaceSlug } = await params;
  if (!isLocale(locale)) return {};
  return {
    ...(await sectionMetadata(locale, "seo.duplicatesDecisions", {
      namespaceSlug,
      path: "/duplicates/decisions",
    })),
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
