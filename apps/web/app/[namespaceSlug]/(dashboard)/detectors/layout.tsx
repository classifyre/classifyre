import type { Metadata } from "next";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";

export const metadata: Metadata = {
  title: translate(enTranslations, "seo.detectors.title"),
  description: translate(enTranslations, "seo.detectors.description"),
  openGraph: {
    title: translate(enTranslations, "seo.detectors.ogTitle"),
    description: translate(enTranslations, "seo.detectors.ogDescription"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
