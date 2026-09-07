import type { Metadata } from "next";

import { dynamicIdParams } from "@/lib/dynamic-route";
import { isLocale } from "@/lib/locale-detection";
import { entityMetadata } from "@/lib/seo-metadata";
import { seoEntityName } from "@/lib/seo-entity";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; namespaceSlug: string; id: string }>;
}): Promise<Metadata> {
  const { locale, namespaceSlug, id } = await params;
  if (!isLocale(locale)) return {};
  const name = await seoEntityName("detector", namespaceSlug, id);
  return entityMetadata(locale, "seo.detectorDetail", name, {
    namespaceSlug,
    path: `/detectors/${id}`,
  });
}

export function generateStaticParams() {
  return dynamicIdParams();
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
