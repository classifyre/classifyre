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
import {
  semanticApi,
  type MetricDefinition,
  type MetricResult,
} from "@/lib/semantic-api";
import { CheckCircle2 } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";

export default function MetricDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useTranslation();
  const id = params.id as string;

  const [metric, setMetric] = useState<MetricDefinition | null>(null);
  const [result, setResult] = useState<MetricResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [metricData, queryResult] = await Promise.all([
          semanticApi.metrics.get(id),
          semanticApi.query.evaluate({ metricId: id }).catch(() => null),
        ]);
        setMetric(metricData);
        setResult(queryResult);
      } catch (err) {
        console.error("Failed to load metric:", err);
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

  if (!metric) {
    return (
      <div className="p-6">
        <DetailBackButton fallbackHref="/semantic/metrics" />
        <p className="mt-4 text-muted-foreground">{t("semantic.metrics.notFound")}</p>
      </div>
    );
  }

  const formatValue = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "—";
    if (metric.format === "percentage") return `${(value * 100).toFixed(1)}%`;
    if (Number.isInteger(value)) return value.toLocaleString();
    return value.toFixed(2);
  };

  const handleCertify = async () => {
    try {
      const updated = await semanticApi.metrics.certify(id, "admin");
      setMetric(updated);
    } catch (err) {
      console.error("Failed to certify:", err);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <DetailBackButton fallbackHref="/semantic/metrics" />

      <div className="flex items-center justify-between">
        <PageTitle
          title={metric.displayName}
          description={metric.description ?? undefined}
        />
        <div className="flex items-center gap-2">
          {metric.status === "DRAFT" && (
            <Button variant="outline" size="sm" onClick={handleCertify}>
              <CheckCircle2 className="mr-1 h-3 w-3" />
              {t("semantic.metrics.certify")}
            </Button>
          )}
          <Badge
            variant={metric.status === "ACTIVE" ? "default" : "secondary"}
          >
            {metric.status}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Current Value */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {t("semantic.metrics.currentValue")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-hero text-4xl">
              {formatValue(result?.value)}
            </p>
            {metric.unit && (
              <p className="text-sm text-muted-foreground">{metric.unit}</p>
            )}
          </CardContent>
        </Card>

        {/* Type & Config */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {t("semantic.metrics.configuration")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("semantic.metrics.typeLabel")}</span>
              <Badge variant="outline">{metric.type}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("semantic.metrics.formatLabel")}</span>
              <span className="text-sm">{metric.format ?? "number"}</span>
            </div>
            {metric.glossaryTerm && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {t("semantic.metrics.glossaryLabel")}
                </span>
                <Badge
                  variant="outline"
                  className="cursor-pointer"
                  onClick={() =>
                    router.push(
                      `/semantic/glossary/${metric.glossaryTerm!.id}`,
                    )
                  }
                >
                  {metric.glossaryTerm.displayName}
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Dimensions */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {t("semantic.metrics.allowedDimensions")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {metric.allowedDimensions.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {metric.allowedDimensions.map((dim) => (
                  <Badge key={dim} variant="secondary">
                    {dim}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("semantic.metrics.noDimensionBreakdowns")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Dimension Breakdown */}
      {result?.breakdown && result.breakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("semantic.metrics.dimensionBreakdown")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {result.breakdown.map((b) => (
                <div
                  key={b.dimensionValue}
                  className="flex items-center justify-between border-b pb-2 last:border-0"
                >
                  <span className="text-sm">{b.dimensionValue}</span>
                  <span className="font-mono text-sm font-medium">
                    {b.value.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Definition */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("semantic.metrics.definitionJson")}</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="rounded-lg bg-muted p-3 text-xs font-mono overflow-auto max-h-48">
            {JSON.stringify(metric.definition, null, 2)}
          </pre>
        </CardContent>
      </Card>

      {/* Governance Info */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">
            {t("semantic.metrics.governance")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
          <div>
            <span className="text-muted-foreground">{t("semantic.metrics.ownerLabel")}</span>{" "}
            {metric.owner ?? "—"}
          </div>
          <div>
            <span className="text-muted-foreground">{t("semantic.metrics.certifiedByLabel")}</span>{" "}
            {metric.certifiedBy ?? "—"}
          </div>
          <div>
            <span className="text-muted-foreground">{t("semantic.metrics.certifiedAtLabel")}</span>{" "}
            {metric.certifiedAt
              ? new Date(metric.certifiedAt).toLocaleDateString()
              : "—"}
          </div>
          <div>
            <span className="text-muted-foreground">{t("semantic.metrics.createdLabel")}</span>{" "}
            {new Date(metric.createdAt).toLocaleDateString()}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
