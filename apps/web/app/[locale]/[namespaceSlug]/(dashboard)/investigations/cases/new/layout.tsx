import type { Metadata } from "next";

import { isLocale } from "@/lib/locale-detection";
import { sectionMetadata, NO_INDEX } from "@/lib/seo-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; namespaceSlug: string }>;
}): Promise<Metadata> {
  const { locale, namespaceSlug } = await params;
  if (!isLocale(locale)) return {};
  return {
    ...(await sectionMetadata(locale, "seo.caseNew", {
      namespaceSlug,
      path: "/investigations/cases/new",
    })),
    robots: NO_INDEX,
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
