import type { Metadata } from "next";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";

export const metadata: Metadata = {
  title: translate(enTranslations, "seo.duplicateTune.title"),
  description: translate(enTranslations, "seo.duplicateTune.description"),
  openGraph: {
    title: translate(enTranslations, "seo.duplicateTune.ogTitle"),
    description: translate(enTranslations, "seo.duplicateTune.ogDescription"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
