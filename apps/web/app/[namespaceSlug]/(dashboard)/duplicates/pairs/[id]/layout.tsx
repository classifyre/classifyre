import type { Metadata } from "next";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";
import { dynamicIdParams } from "@/lib/dynamic-route";

export const metadata: Metadata = {
  title: translate(enTranslations, "seo.duplicatePair.title"),
  description: translate(enTranslations, "seo.duplicatePair.description"),
  openGraph: {
    title: translate(enTranslations, "seo.duplicatePair.ogTitle"),
    description: translate(enTranslations, "seo.duplicatePair.ogDescription"),
  },
};

export function generateStaticParams() {
  return dynamicIdParams();
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
