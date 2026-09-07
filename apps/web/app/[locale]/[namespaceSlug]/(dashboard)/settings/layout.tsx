import type { Metadata } from "next";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";

export const metadata: Metadata = {
  title: translate(enTranslations, "seo.settings.title"),
  description: translate(enTranslations, "seo.settings.description"),
  openGraph: {
    title: translate(enTranslations, "seo.settings.ogTitle"),
    description: translate(enTranslations, "seo.settings.ogDescription"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
