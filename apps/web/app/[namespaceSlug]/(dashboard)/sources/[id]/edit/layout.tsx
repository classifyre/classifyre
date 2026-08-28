import type { Metadata } from "next";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";

export const metadata: Metadata = {
  title: translate(enTranslations, "seo.sourceEdit.title"),
  description: translate(enTranslations, "seo.sourceEdit.description"),
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    title: translate(enTranslations, "seo.sourceEdit.ogTitle"),
    description: translate(enTranslations, "seo.sourceEdit.ogDescription"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
