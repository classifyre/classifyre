import type { Metadata } from "next";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";

export const metadata: Metadata = {
  title: translate(enTranslations, "seo.scans.title"),
  description: translate(enTranslations, "seo.scans.description"),
  openGraph: {
    title: translate(enTranslations, "seo.scans.ogTitle"),
    description: translate(enTranslations, "seo.scans.ogDescription"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
