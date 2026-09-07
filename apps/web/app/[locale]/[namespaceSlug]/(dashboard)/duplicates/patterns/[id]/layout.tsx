import type { Metadata } from "next";

import { dynamicIdParams } from "@/lib/dynamic-route";
import { isLocale } from "@/lib/locale-detection";
import { sectionMetadata } from "@/lib/seo-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; namespaceSlug: string; id: string }>;
}): Promise<Metadata> {
  const { locale, namespaceSlug, id } = await params;
  if (!isLocale(locale)) return {};
  return {
    ...(await sectionMetadata(locale, "seo.duplicatePattern", {
      namespaceSlug,
      path: `/duplicates/patterns/${id}`,
    })),
  };
}

export function generateStaticParams() {
  return dynamicIdParams();
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
