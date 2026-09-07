import type { Metadata } from "next";

import { isLocale } from "@/lib/locale-detection";
import { sectionMetadata, NO_INDEX } from "@/lib/seo-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; namespaceSlug: string; id: string }>;
}): Promise<Metadata> {
  const { locale, namespaceSlug, id } = await params;
  if (!isLocale(locale)) return {};
  return {
    ...(await sectionMetadata(locale, "seo.sourceEdit", {
      namespaceSlug,
      path: `/sources/${id}/edit`,
    })),
    robots: NO_INDEX,
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
