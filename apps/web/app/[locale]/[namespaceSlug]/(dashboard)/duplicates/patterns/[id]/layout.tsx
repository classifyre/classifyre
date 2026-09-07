import type { Metadata } from "next";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";
import { dynamicIdParams } from "@/lib/dynamic-route";

export const metadata: Metadata = {
  title: translate(enTranslations, "seo.duplicatePattern.title"),
  description: translate(enTranslations, "seo.duplicatePattern.description"),
  openGraph: {
    title: translate(enTranslations, "seo.duplicatePattern.ogTitle"),
    description: translate(enTranslations, "seo.duplicatePattern.ogDescription"),
  },
};

// Static export: one placeholder shell for this dynamic segment. The page reads
// the real pattern key from the URL at runtime via .
export function generateStaticParams() {
  return dynamicIdParams();
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
