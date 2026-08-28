import type { Metadata } from "next";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";

export const metadata: Metadata = {
  title: translate(enTranslations, "seo.discovery.title"),
  description: translate(enTranslations, "seo.discovery.description"),
  openGraph: {
    title: translate(enTranslations, "seo.discovery.ogTitle"),
    description: translate(enTranslations, "seo.discovery.ogDescription"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
