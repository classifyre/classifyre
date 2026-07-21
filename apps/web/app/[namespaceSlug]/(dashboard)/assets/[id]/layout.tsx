import type { Metadata } from "next";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";
import { dynamicIdParams } from "@/lib/dynamic-route";

export const metadata: Metadata = {
  title: translate(enTranslations, "assets.detail.title"),
};

// Static export: emit a single placeholder shell for this dynamic segment; the
// page reads the real id from the URL at runtime (see @/lib/use-route-id).
export function generateStaticParams() {
  return dynamicIdParams();
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
