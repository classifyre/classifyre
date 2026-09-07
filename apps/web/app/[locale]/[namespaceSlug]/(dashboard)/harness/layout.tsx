import type { Metadata } from "next";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";

export const metadata: Metadata = {
  title: translate(enTranslations, "seo.harness.title"),
  description: translate(enTranslations, "seo.harness.description"),
  openGraph: {
    title: translate(enTranslations, "seo.harness.ogTitle"),
    description: translate(enTranslations, "seo.harness.ogDescription"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
