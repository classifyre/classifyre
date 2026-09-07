import type { Metadata } from "next";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";

export const metadata: Metadata = {
  title: translate(enTranslations, "seo.detectorNew.title"),
  description: translate(enTranslations, "seo.detectorNew.description"),
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    title: translate(enTranslations, "seo.detectorNew.ogTitle"),
    description: translate(enTranslations, "seo.detectorNew.ogDescription"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
