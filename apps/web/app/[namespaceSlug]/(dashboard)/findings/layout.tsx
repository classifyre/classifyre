import type { Metadata } from "next";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";

export const metadata: Metadata = {
  title: translate(enTranslations, "seo.findings.title"),
  description: translate(enTranslations, "seo.findings.description"),
  openGraph: {
    title: translate(enTranslations, "seo.findings.ogTitle"),
    description: translate(enTranslations, "seo.findings.ogDescription"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
