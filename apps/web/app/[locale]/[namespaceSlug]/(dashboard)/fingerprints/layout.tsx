import type { Metadata } from "next";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";

export const metadata: Metadata = {
  title: translate(enTranslations, "seo.fingerprints.title"),
  description: translate(enTranslations, "seo.fingerprints.description"),
  openGraph: {
    title: translate(enTranslations, "seo.fingerprints.ogTitle"),
    description: translate(enTranslations, "seo.fingerprints.ogDescription"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
