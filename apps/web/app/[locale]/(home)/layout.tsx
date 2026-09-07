import type { Metadata } from "next";

import { isLocale } from "@/lib/locale-detection";
import { sectionMetadata } from "@/lib/seo-metadata";

// A route group, so the workspace directory keeps its URL (`/`, `/de/`) while
// gaining a server component that can carry its metadata — the page itself is
// a client component and cannot export any.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return sectionMetadata(locale, "seo.workspaces", { path: "/" });
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
