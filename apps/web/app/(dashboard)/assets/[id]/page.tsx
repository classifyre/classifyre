"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
} from "@workspace/ui/components";
import { FindingsTable } from "@/components/findings-table";
import { DetailBackButton } from "@/components/detail-back-button";
import { useTranslation } from "@/hooks/use-translation";

export default function AssetDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { t } = useTranslation();
  const assetId = params.id as string;

  const [assetDetails, setAssetDetails] = useState<AssetListItemDto | null>(
    null,
  );
  const [sourceMeta, setSourceMeta] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
              name: sourceResponse.name?.trim() || t("assets.detail.unknownSource"),
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
            onClick: () => router.push("/discovery"),
          }}
          secondaryAction={{ label: t("assets.detail.goBack"), onClick: () => router.back() }}
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
              <Badge variant="outline">{assetDetails.assetType}</Badge>
              <Badge variant="outline">{assetDetails.sourceType}</Badge>
            </div>
            <p className="text-muted-foreground">
              {assetLabel} • {sourceLabel}
            </p>
          </div>
        </div>
        {sourceId && (
          <Button size="sm" asChild>
            <Link href={`/sources/${sourceId}`}>{t("assets.detail.openSource")}</Link>
          </Button>
        )}
      </div>

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
              <div className="text-sm text-muted-foreground">{t("common.source")}</div>
              {sourceId ? (
                <Link
                  href={`/sources/${sourceId}`}
                  className="text-base font-semibold underline-offset-4 hover:underline"
                  title={sourceLabel}
                >
                  {sourceLabel}
                </Link>
              ) : (
                <div className="text-base font-semibold">{sourceLabel}</div>
              )}
            </div>
          </div>
          <Separator />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs text-muted-foreground">{t("assets.detail.assetName")}</div>
              <div className="text-sm font-semibold break-words">
                {assetLabel}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("assets.detail.assetType")}</div>
              <div className="text-sm font-semibold">
                {assetDetails.assetType}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("assets.detail.externalUrl")}</div>
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
                  href={`/sources/${sourceId}`}
                  className="text-sm font-semibold underline-offset-4 hover:underline"
                >
                  {t("assets.detail.openSourceDetails")}
                </Link>
              ) : (
                <div className="text-sm font-semibold">{t("assets.detail.unavailable")}</div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {lockedFilters && (
        <Suspense>
          <FindingsTable lockedFilters={lockedFilters} />
        </Suspense>
      )}
    </div>
  );
}
