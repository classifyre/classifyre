"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Compass } from "lucide-react";
import { api, type ExploreStartersResponseDto } from "@workspace/api-client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components";
import {
  AssetsTable,
  type PinnedAssets,
  type PinnedReason,
} from "@/components/assets-table";
import { ExploreWorkspace } from "@/components/explore/explore-workspace";
import { useCriticalAssets } from "@/components/explore/explore-home";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import {
  EXPLORE_MAX_SEEDS,
  readExploreView,
  type ExploreViewName,
} from "@/lib/explore";
import { useUrlParams } from "@/lib/url-filters";

export const START_FROM = [
  "lineage",
  "critical",
  "duplicates",
  "links",
  "all",
] as const;
export type StartFrom = (typeof START_FROM)[number];

const CRITICAL_ROWS = 20;

/**
 * The Explore tab: the map on top, its index below.
 *
 * The map is Explore's own canvas, starting from the workspace's most
 * connected assets until something is asked for. The list under it is the
 * same asset list as the other tabs, ordered by what is worth starting from
 * — most lineage, most critical, duplicate pairs, links people drew — or
 * every asset. A row's compass draws it (or its pair) on the map; ticked
 * rows explore together; rows on the map are marked. Map and list share
 * the address, so a view can be linked and walked back.
 */
export function ExploreAssetsView() {
  const { t } = useTranslation();
  const { searchParams, setParams } = useUrlParams();
  const mapRef = useRef<HTMLDivElement | null>(null);

  const [starters, setStarters] = useState<ExploreStartersResponseDto | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    api.explore
      .exploreControllerStarters()
      .then((res) => live && setStarters(res))
      .catch(
        () => live && setStarters({ lineage: [], patterns: [], links: [] }),
      );
    return () => {
      live = false;
    };
  }, []);
  const critical = useCriticalAssets(CRITICAL_ROWS);

  const startParam = searchParams.get("start");
  const startFrom: StartFrom = (START_FROM as readonly string[]).includes(
    startParam ?? "",
  )
    ? (startParam as StartFrom)
    : "lineage";

  // The map with nothing asked for: the most connected assets.
  const defaultSeeds = useMemo(
    () =>
      starters
        ? starters.lineage
            .slice(0, EXPLORE_MAX_SEEDS)
            .map((entry) => entry.asset.id)
        : undefined,
    [starters],
  );

  const view = readExploreView(new URLSearchParams(searchParams.toString()));
  const onMap = useMemo(
    () =>
      new Set(
        view.seeds.length || view.saved ? view.seeds : (defaultSeeds ?? []),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.seeds.join(","), view.saved, defaultSeeds],
  );

  const pinned = useMemo<PinnedAssets | null>(() => {
    if (startFrom === "all") return null;
    const reasons = new Map<string, PinnedReason>();
    const add = (id: string, reason: PinnedReason) => {
      if (!reasons.has(id)) reasons.set(id, reason);
    };
    if (startFrom === "critical") {
      if (!critical) return { ids: [], reasons };
      for (const item of critical) {
        const count = (severity: string) =>
          item.findings.filter((f) => f.severity === severity).length;
        add(item.asset.id, {
          label: t("assets.explore.reason.critical", {
            critical: count("CRITICAL"),
            high: count("HIGH"),
          }),
          ids: [item.asset.id],
          view: null,
        });
      }
    } else if (starters) {
      if (startFrom === "lineage") {
        for (const entry of starters.lineage) {
          add(entry.asset.id, {
            label: t("explore.home.lineageLinks", { count: entry.degree }),
            ids: [entry.asset.id],
            view: "lineage",
          });
        }
      } else if (startFrom === "duplicates") {
        for (const pattern of starters.patterns) {
          const [a, b] = pattern.pair;
          if (!a || !b) continue;
          const ids = [a.id, b.id];
          const pairs = t("explore.home.pairs", { count: pattern.pairCount });
          add(a.id, {
            label: t("assets.explore.reason.duplicate", {
              name: b.name,
              pairs,
            }),
            ids,
            view: "duplicates",
          });
          add(b.id, {
            label: t("assets.explore.reason.duplicate", {
              name: a.name,
              pairs,
            }),
            ids,
            view: "duplicates",
          });
        }
      } else if (startFrom === "links") {
        for (const link of starters.links) {
          const ids = [link.from.id, link.to.id];
          add(link.from.id, {
            label: t("assets.explore.reason.linkTo", { name: link.to.name }),
            ids,
            view: "connected",
          });
          add(link.to.id, {
            label: t("assets.explore.reason.linkFrom", {
              name: link.from.name,
            }),
            ids,
            view: "connected",
          });
        }
      }
    } else {
      return { ids: [], reasons };
    }
    return { ids: [...reasons.keys()], reasons };
  }, [critical, startFrom, starters, t]);

  const explore = (ids: string[], next: ExploreViewName | null) => {
    setParams({
      seeds: ids.slice(0, EXPLORE_MAX_SEEDS).join(","),
      view: next,
      kinds: null,
      saved: null,
    });
    mapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // Beside what the map shows, not instead of it; the oldest go when it is full.
  const addToMap = (ids: string[]) => {
    const next = [...onMap, ...ids.filter((id) => !onMap.has(id))];
    setParams({
      seeds: next.slice(-EXPLORE_MAX_SEEDS).join(","),
      saved: null,
    });
    mapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-6" data-testid="explore-assets-view">
      <div ref={mapRef} className="scroll-mt-4">
        <Suspense>
          <ExploreWorkspace embedded defaultSeeds={defaultSeeds} />
        </Suspense>
      </div>

      <Suspense>
        <AssetsTable
          preset="explore"
          pinned={pinned}
          onExplore={explore}
          onAddToMap={addToMap}
          onMap={onMap}
          toolbar={
            <Select
              value={startFrom}
              onValueChange={(value) =>
                setParams({ start: value === "lineage" ? null : value })
              }
            >
              <SelectTrigger
                className="h-9 w-[210px] rounded-[4px] border-2 border-foreground"
                aria-label={t("assets.explore.startFrom")}
                data-testid="explore-start-from"
              >
                <Compass className="h-3.5 w-3.5" aria-hidden />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {START_FROM.map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(`assets.explore.start.${option}` as TranslationKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </Suspense>
    </div>
  );
}
