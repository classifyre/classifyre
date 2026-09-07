import type { Metadata } from "next";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";

export const metadata: Metadata = {
  title: translate(enTranslations, "seo.investigations.title"),
  description: translate(enTranslations, "seo.investigations.description"),
  openGraph: {
    title: translate(enTranslations, "seo.investigations.ogTitle"),
    description: translate(enTranslations, "seo.investigations.ogDescription"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
