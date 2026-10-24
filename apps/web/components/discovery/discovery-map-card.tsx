"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import type { FindingsDiscoveryTopAssetDto } from "@workspace/api-client";
import { MEANING_URL_KEYS } from "@/components/glossary/meaning-map/meaning-map";
import { useTranslation } from "@/hooks/use-translation";
import { useNsPath } from "@/lib/ns-path";
import { ConnectionsCanvas } from "./connections-canvas";

/**
 * Discovery's map card: how the sources connect. The meaning map lives on the
 * glossary page; this card links to it, and an old `?map=meaning` address is
 * sent there with its view.
 */
export function DiscoveryMapCard({
  topAssets,
}: {
  topAssets?: FindingsDiscoveryTopAssetDto[];
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const nsPath = useNsPath();

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("map") !== "meaning") return;
    const carried = new URLSearchParams({ tab: "map" });
    for (const key of MEANING_URL_KEYS) {
      const value = params.get(key);
      if (value) carried.set(key, value);
    }
    router.replace(nsPath(`/glossary?${carried.toString()}`));
  }, [router, nsPath]);

  return (
    <ConnectionsCanvas
      topAssets={topAssets}
      headerSlot={
        <Link
          href={nsPath("/glossary?tab=map")}
          className="inline-flex items-center gap-1 rounded-[4px] border-2 border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] hover:bg-muted"
          data-testid="discovery-meaning-link"
        >
          {t("semanticMap.openMap")}
          <ArrowRight className="h-3 w-3" />
        </Link>
      }
    />
  );
}
