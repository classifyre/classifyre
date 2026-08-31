import type { Metadata } from "next";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";

export const metadata: Metadata = {
  title: translate(enTranslations, "seo.assets.title"),
  description: translate(enTranslations, "seo.assets.description"),
  openGraph: {
    title: translate(enTranslations, "seo.assets.ogTitle"),
    description: translate(enTranslations, "seo.assets.ogDescription"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
