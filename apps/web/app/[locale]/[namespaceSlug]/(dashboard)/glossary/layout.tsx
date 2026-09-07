import type { Metadata } from "next";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";

export const metadata: Metadata = {
  title: translate(enTranslations, "seo.glossary.title"),
  description: translate(enTranslations, "seo.glossary.description"),
  openGraph: {
    title: translate(enTranslations, "seo.glossary.ogTitle"),
    description: translate(enTranslations, "seo.glossary.ogDescription"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
