import type { Metadata } from "next";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";

export const metadata: Metadata = {
  title: translate(enTranslations, "seo.sources.title"),
  description: translate(enTranslations, "seo.sources.description"),
  openGraph: {
    title: translate(enTranslations, "seo.sources.ogTitle"),
    description: translate(enTranslations, "seo.sources.ogDescription"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
