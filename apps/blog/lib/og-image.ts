import type { Locale } from "@/lib/locale";

/** File name of a page's social card in `public/og/` (see `scripts/og.tsx`). */
export function ogImageName(locale: Locale, page: string): string {
  return `${locale}-${page}.png`;
}

/** The `openGraph.images` / `twitter.images` entry for a page. */
export function ogImage(locale: Locale, page: string, alt: string) {
  return {
    url: `/og/${ogImageName(locale, page)}`,
    width: 1200,
    height: 630,
    alt,
    type: "image/png",
  };
}
