import type { Metadata } from "next";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";

export const metadata: Metadata = {
  title: {
    template: translate(enTranslations, "seo.duplicates.titleTemplate"),
    default: translate(enTranslations, "seo.duplicates.defaultTitle"),
  },
  description: translate(enTranslations, "seo.duplicates.description"),
  openGraph: {
    title: translate(enTranslations, "seo.duplicates.ogTitle"),
    description: translate(enTranslations, "seo.duplicates.ogDescription"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
