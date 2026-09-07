import type { Metadata } from "next";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";
import { dynamicIdParams } from "@/lib/dynamic-route";

export async function generateMetadata({ params }: { params: Promise<Record<string, string>> }): Promise<Metadata> {
  const resolved = await params;
  const entityId = resolved["id"] ?? resolved["id"] ?? "";
  const isPlaceholder = !entityId || entityId === "__id__" || entityId === "placeholder";
  if (isPlaceholder) {
    return {
      title: translate(enTranslations, "seo.detectorDetail.title"),
      description: translate(enTranslations, "seo.detectorDetail.description"),
      openGraph: {
        title: translate(enTranslations, "seo.detectorDetail.ogTitle"),
        description: translate(enTranslations, "seo.detectorDetail.ogDescription"),
      },
    };
  }
  // Entity-specific title/description. At build time this is the short id;
  // in a server-rendered request the same branch can be expanded to fetch
  // the real name (asset name, source name, finding snippet) via the API.
  return {
    title: translate(enTranslations, "seo.detectorDetail.titleWithEntity", { entity: entityId, name: entityId, title: entityId }),
    description: translate(enTranslations, "seo.detectorDetail.descriptionWithEntity", { entity: entityId, name: entityId, title: entityId, type: "", severity: "", source: "" }),
    openGraph: {
      title: translate(enTranslations, "seo.detectorDetail.titleWithEntity", { entity: entityId, name: entityId, title: entityId }),
      description: translate(enTranslations, "seo.detectorDetail.descriptionWithEntity", { entity: entityId, name: entityId, title: entityId, type: "", severity: "", source: "" }),
    },
  };
}

export function generateStaticParams() {
  return dynamicIdParams();
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
