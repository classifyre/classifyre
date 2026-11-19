import type { Locale } from "@/lib/locale";
import { BiDemo } from "@/components/demos/bi-demo";
import { DiscoverDemo } from "@/components/demos/discover-demo";
import { GovernDemo } from "@/components/demos/govern-demo";
import { QueryDemo } from "@/components/demos/query-demo";
import { ShareDemo } from "@/components/demos/share-demo";
import { RedactionSheet } from "@/components/landing/redaction-sheet";

/** The self-running product demos, by name. */
export type DemoId = "discover" | "query" | "govern" | "bi" | "share" | "mask";

export function Demo({
  id,
  locale,
  caption,
}: {
  id: DemoId;
  locale: Locale;
  caption?: string;
}) {
  switch (id) {
    case "discover":
      return <DiscoverDemo locale={locale} caption={caption} />;
    case "query":
      return <QueryDemo locale={locale} caption={caption} />;
    case "govern":
      return <GovernDemo locale={locale} caption={caption} />;
    case "bi":
      return <BiDemo locale={locale} caption={caption} />;
    case "share":
      return <ShareDemo locale={locale} caption={caption} />;
    case "mask":
      return <RedactionSheet locale={locale} badge={false} />;
  }
}
