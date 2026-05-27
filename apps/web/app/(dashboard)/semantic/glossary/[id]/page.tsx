"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Spinner,
} from "@workspace/ui/components";
import { PageTitle } from "@/components/page-title";
import { DetailBackButton } from "@/components/detail-back-button";
import { semanticApi, type GlossaryTerm } from "@/lib/semantic-api";
import { api, type CustomDetectorResponseDto } from "@workspace/api-client";
import { ArrowRight, BarChart3, Sparkles } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";

export default function GlossaryTermDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useTranslation();
  const id = params.id as string;

  const [term, setTerm] = useState<GlossaryTerm | null>(null);
  const [findingCount, setFindingCount] = useState<number | null>(null);
  const [linkedDetectors, setLinkedDetectors] = useState<
    CustomDetectorResponseDto[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [termData, preview] = await Promise.all([
          semanticApi.glossary.get(id),
          semanticApi.glossary.preview(id),
        ]);
        setTerm(termData);
        setFindingCount(preview.findingCount);

        // Load custom detectors linked via filterMapping.customDetectorKeys
        const keys: string[] =
          termData.filterMapping?.customDetectorKeys ?? [];
        if (keys.length > 0) {
          const all = await api.listCustomDetectors({ includeInactive: true });
          setLinkedDetectors(
            (all ?? []).filter((d) => keys.includes(d.key)),
          );
        }
      } catch (err) {
        console.error("Failed to load glossary term:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    );
  }

  if (!term) {
    return (
      <div className="p-6">
        <DetailBackButton fallbackHref="/semantic/glossary" />
        <p className="mt-4 text-muted-foreground">
          {t("semantic.glossary.notFound")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <DetailBackButton fallbackHref="/semantic/glossary" />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {term.color && (
            <div
              className="h-4 w-4 rounded-full"
              style={{ backgroundColor: term.color }}
            />
          )}
          <PageTitle
            title={term.displayName}
            description={term.description ?? undefined}
          />
        </div>
        {term.category && <Badge variant="outline">{term.category}</Badge>}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Finding Count Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {t("semantic.glossary.matchingFindings")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-hero text-4xl">
              {findingCount !== null ? findingCount.toLocaleString() : "—"}
            </p>
            <Button
              variant="link"
              size="sm"
              className="mt-2 p-0"
              onClick={() => router.push("/findings")}
            >
              {t("semantic.glossary.viewFindings")}
              <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </CardContent>
        </Card>

        {/* Filter Mapping Card */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {t("semantic.glossary.filterMappingTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(term.filterMapping).map(([key, values]) => (
              <div key={key}>
                <span className="text-xs font-medium uppercase text-muted-foreground">
                  {key}
                </span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(values as string[]).map((v) => (
                    <Badge key={v} variant="secondary">
                      {v}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Associated Metrics */}
      {term.metrics && term.metrics.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-medium">
              {t("semantic.glossary.associatedMetrics")}
            </h3>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {term.metrics.map((metric: any) => (
              <Card
                key={metric.id}
                className="cursor-pointer transition-all hover:-translate-y-0.5"
                onClick={() => router.push(`/semantic/metrics/${metric.id}`)}
              >
                <CardContent className="p-4">
                  <p className="text-sm font-medium">{metric.displayName}</p>
                  <Badge variant="outline" className="mt-1 text-[10px]">
                    {metric.type}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Linked Detectors */}
      {linkedDetectors.length > 0 && (
        <Card className="rounded-[6px] border-2 border-black shadow-[6px_6px_0_#000]">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm uppercase tracking-[0.06em]">
                Auto-Detection
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {linkedDetectors.map((det) => (
              <button
                key={det.id}
                type="button"
                onClick={() => router.push(`/detectors/${det.id}`)}
                className="group flex w-full items-center justify-between rounded-[4px] border-2 border-border bg-background px-3 py-2.5 text-left transition-all hover:-translate-y-px hover:bg-secondary/30"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{det.name}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {det.key} · {det.method}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={det.isActive ? "default" : "outline"}
                    className="text-[9px]"
                  >
                    {det.isActive ? "active" : "inactive"}
                  </Badge>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Metadata */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">
            {t("semantic.glossary.metadata")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">
              {t("semantic.glossary.activeLabel")}
            </span>{" "}
            {term.isActive
              ? t("semantic.glossary.yes")
              : t("semantic.glossary.no")}
          </div>
          <div>
            <span className="text-muted-foreground">
              {t("semantic.glossary.createdLabel")}
            </span>{" "}
            {new Date(term.createdAt).toLocaleDateString()}
          </div>
          <div>
            <span className="text-muted-foreground">
              {t("semantic.glossary.updatedLabel")}
            </span>{" "}
            {new Date(term.updatedAt).toLocaleDateString()}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
