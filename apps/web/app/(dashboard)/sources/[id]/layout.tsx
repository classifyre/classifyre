import type { Metadata } from "next";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";

export const metadata: Metadata = {
  title: translate(enTranslations, "sources.detail.title"),
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
