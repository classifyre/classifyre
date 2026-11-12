"use client";

import { useNsPath } from "@/lib/ns-path";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useRouteId } from "@/lib/use-route-id";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { api, type AssetListItemDto } from "@workspace/api-client";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Separator,
  SourceIcon,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components";
import { FindingsTable } from "@/components/findings-table";
import dynamic from "next/dynamic";
import { ColumnLineagePanel } from "@/components/column-lineage-panel";
import { AssetMetadataCard } from "@/components/asset-metadata-card";
import { AssetKindBadge } from "@/components/asset-kind-badge";
import { ReferencingFindingsPanel } from "@/components/referencing-findings-panel";
import { formatAssetKind } from "@/lib/asset-kind";
import { DetailBackButton } from "@/components/detail-back-button";
import { useTranslation } from "@/hooks/use-translation";
import { useEntityDocumentTitle } from "@/components/document-title-updater";
import {
  catalogTableFor,
  fetchCatalog,
  type QueryCatalog,
} from "@/lib/data-query";
import {
  useAssetColumns,
  useAssetGovernance,
  useAssetUsage,
} from "@/lib/governance";
import { useCan } from "@/hooks/use-me";
import { AssetOverview } from "@/components/governance/asset-overview";
import { GovernanceBadge } from "@/components/governance/governance-badge";
import { ActorChip } from "@/components/actor-chip";

// Monaco and the results grid: client-only, loaded when the Data tab opens.
const AssetDataTab = dynamic(
  () =>
    import("@/components/data-query/asset-data-tab").then(
      (m) => m.AssetDataTab,
    ),
  { ssr: false },
);

// The canvas measures the DOM: client-only, loaded when the tab opens.
const ExploreWorkspace = dynamic(
  () =>
    import("@/components/explore/explore-workspace").then(
      (m) => m.ExploreWorkspace,
    ),
  { ssr: false },
);

/**
 * Column names off an asset's normalized metadata.
 *
 * The tabular sources record `columns` as `[{name, type}]`; anything else has
 * no columns and the column-lineage panel hides itself.
 */
function columnNames(metadata: unknown): string[] {
  const columns = (metadata as { columns?: unknown } | null)?.columns;
  if (!Array.isArray(columns)) return [];
  return columns
    .map((column) =>
      typeof column === "string"
        ? column
        : ((column as { name?: unknown })?.name ?? ""),
    )
    .filter(
      (name): name is string => typeof name === "string" && name.length > 0,
    );
}

export default function AssetDetailPage() {
  const nsPath = useNsPath();
  const router = useRouter();
  const { t } = useTranslation();
  const assetId = useRouteId();

  const [assetDetails, setAssetDetails] = useState<AssetListItemDto | null>(
    null,
  );
  const [sourceMeta, setSourceMeta] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // What SQL can read: the Data tab shows only for an asset that is a table.
  const [queryCatalog, setQueryCatalog] = useState<QueryCatalog | null>(null);

  useEffect(() => {
    let active = true;
    fetchCatalog()
      .then((catalog) => active && setQueryCatalog(catalog))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const queryTable = assetId ? catalogTableFor(queryCatalog, assetId) : null;
  // Owners, description, lifecycle (docs/prd/GOV-governed-data-assets.md).
  const governance = useAssetGovernance(assetId);
  const columns = useAssetColumns(assetId);
  const usage = useAssetUsage(assetId, useCan("activity.view"));
  const owner = governance.data?.roles.find(
    (role: { role: string }) => role.role === "OWNER",
  );

  useEffect(() => {
    let isActive = true;

    const fetchAsset = async () => {
      if (!assetId) return;
      try {
        setLoading(true);
        setError(null);

        const assetResponse = await api.assets.assetsControllerGetAsset({
          id: assetId,
        });
        if (!isActive) return;
        setAssetDetails(assetResponse);

        if (assetResponse.sourceId) {
          try {
            const sourceResponse = await api.sources.sourcesControllerGetSource(
              {
                id: assetResponse.sourceId,
              },
            );
            if (!isActive) return;
            setSourceMeta({
              id: assetResponse.sourceId,
              name:
                sourceResponse.name?.trim() || t("assets.detail.unknownSource"),
            });
          } catch {
            if (!isActive) return;
            setSourceMeta({
              id: assetResponse.sourceId,
              name: t("assets.detail.unknownSource"),
            });
          }
        } else {
          setSourceMeta(null);
        }
      } catch (fetchError) {
        if (!isActive) return;
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load asset details",
        );
        setAssetDetails(null);
        setSourceMeta(null);
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    fetchAsset();

    return () => {
      isActive = false;
    };
  }, [assetId]);

  const sourceId = sourceMeta?.id || assetDetails?.sourceId;
  const sourceLabel = sourceMeta?.name || t("assets.detail.unknownSource");
  const sourceType = assetDetails?.sourceType ?? "filesystem";

  const assetLabel =
    assetDetails?.name ||
    assetDetails?.externalUrl ||
    assetDetails?.id ||
    assetId;

  const lockedFilters = useMemo(() => {
    if (!assetDetails?.id) {
      return undefined;
    }

    return {
      assetId: [assetDetails.id],
      includeResolved: true,
    };
  }, [assetDetails?.id]);

  useEntityDocumentTitle(assetLabel !== assetId ? assetLabel : null);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner size="lg" label={t("assets.detail.loading")} />
      </div>
    );
  }

  if (error || !assetDetails) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <DetailBackButton fallbackHref="/discovery" />
          <div>
            <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
              {t("assets.detail.notAvailable")}
            </h1>
            <p className="text-muted-foreground">
              {error || t("assets.detail.notFound")}
            </p>
          </div>
        </div>
        <EmptyState
          icon={ShieldAlert}
          title={t("assets.detail.couldntLoad")}
          description={t("assets.detail.tryAgain")}
          action={{
            label: t("assets.detail.backToDiscovery"),
            onClick: () => router.push(nsPath("/discovery")),
          }}
          secondaryAction={{
            label: t("assets.detail.goBack"),
            onClick: () => router.back(),
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <DetailBackButton fallbackHref="/discovery" />
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
                {t("assets.detail.title")}
              </h1>
              <AssetKindBadge kind={assetDetails.assetType} />
              <Badge variant="outline">{assetDetails.sourceType}</Badge>
              {governance.data && (
                <GovernanceBadge status={governance.data.status} />
              )}
              {owner && (
                <span
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                  data-testid="asset-owner"
                >
                  {t("governance.role.OWNER")}
                  <ActorChip actorRef={owner.principal.ref} />
                </span>
              )}
            </div>
            <p className="text-muted-foreground">
              {assetLabel} • {sourceLabel}
            </p>
          </div>
        </div>
        {sourceId && (
          <Button size="sm" asChild>
            <Link href={nsPath(`/sources/${sourceId}`)}>
              {t("assets.detail.openSource")}
            </Link>
          </Button>
        )}
      </div>

      {lockedFilters && (
        <Tabs
          // Remounted once the Data tab is known, so ?tab=data opens it: the
          // tabs read the address when they mount.
          key={queryTable ? "with-data" : "without-data"}
          defaultValue="overview"
          urlParam="tab"
          className="space-y-4"
        >
          <TabsList>
            <TabsTrigger value="overview" data-testid="asset-overview-tab">
              {t("governance.overviewTab")}
            </TabsTrigger>
            <TabsTrigger value="findings">
              {t("correlation.findingsTab")}
            </TabsTrigger>
            <TabsTrigger
              value="connections"
              data-testid="asset-connections-tab"
            >
              {t("explore.assetTab")}
            </TabsTrigger>
            {queryTable && (
              <TabsTrigger value="data" data-testid="asset-data-tab-trigger">
                {t("dataQuery.assetTab")}
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="overview" className="space-y-4">
            <AssetOverview
              governance={governance.data}
              loading={governance.loading}
              onChange={governance.setData}
              columns={columns.data}
              onColumnsChange={(next) => {
                columns.setData(next);
                // Reviewing a classification can tick the checklist.
                void governance.reload();
              }}
              usage={usage.data}
              usageLoading={usage.loading}
              sourceHref={sourceId ? nsPath(`/sources/${sourceId}`) : undefined}
            >
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>{t("assets.detail.metadata")}</CardTitle>
                  <CardDescription>
                    {t("assets.detail.metadataDesc")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3">
                    <SourceIcon source={sourceType} size="md" />
                    <div>
                      <div className="text-sm text-muted-foreground">
                        {t("common.source")}
                      </div>
                      {sourceId ? (
                        <Link
                          href={nsPath(`/sources/${sourceId}`)}
                          className="text-base font-semibold underline-offset-4 hover:underline"
                          title={sourceLabel}
                        >
                          {sourceLabel}
                        </Link>
                      ) : (
                        <div className="text-base font-semibold">
                          {sourceLabel}
                        </div>
                      )}
                    </div>
                  </div>
                  <Separator />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-xs text-muted-foreground">
                        {t("assets.detail.assetName")}
                      </div>
                      <div className="text-sm font-semibold break-words">
                        {assetLabel}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">
                        {t("assets.detail.assetType")}
                      </div>
                      <div className="text-sm font-semibold">
                        {formatAssetKind(assetDetails.assetType)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">
                        {t("assets.detail.externalUrl")}
                      </div>
                      <div className="text-sm font-mono break-all">
                        {assetDetails.externalUrl || "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">
                        {t("assets.detail.sourceProfile")}
                      </div>
                      {sourceId ? (
                        <Link
                          href={nsPath(`/sources/${sourceId}`)}
                          className="text-sm font-semibold underline-offset-4 hover:underline"
                        >
                          {t("assets.detail.openSourceDetails")}
                        </Link>
                      ) : (
                        <div className="text-sm font-semibold">
                          {t("assets.detail.unavailable")}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {assetDetails.metadata &&
                Object.keys(assetDetails.metadata).length > 0 && (
                  <AssetMetadataCard
                    metadata={assetDetails.metadata}
                    hideColumns={Boolean(columns.data?.columns.length)}
                  />
                )}
            </AssetOverview>
          </TabsContent>
          <TabsContent value="findings" className="space-y-4">
            <Suspense>
              <FindingsTable lockedFilters={lockedFilters} />
            </Suspense>
            {/*
              An integrity check or a derived profile is its own asset that
              references the thing it is about, so this tab could read "No
              findings found" while a finding pointed straight at the asset
              (field report P12). Renders nothing when nothing points here.
            */}
            <ReferencingFindingsPanel assetId={assetDetails.id} />
          </TabsContent>
          {/*
            What this asset is connected to and why: lineage traced either
            way, duplicates and shared values (fingerprints), the concepts it
            is about and what reads alike, on Explore's canvas. Its meaning
            and links by hand are in the canvas's Details for the asset.
          */}
          <TabsContent value="connections" className="space-y-4">
            <ExploreWorkspace mode="asset" assetId={assetDetails.id} />
            <ColumnLineagePanel
              assetId={assetDetails.id}
              columns={columnNames(assetDetails.metadata)}
            />
          </TabsContent>
          {queryTable && queryCatalog && (
            <TabsContent value="data" className="space-y-4">
              <AssetDataTab catalog={queryCatalog} table={queryTable} />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
