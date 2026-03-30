"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import {
  api,
  type ExtractionCoverageDto,
  type ExtractionFieldCoverageDto,
} from "@workspace/api-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Progress } from "@workspace/ui/components/progress";
import { Badge } from "@workspace/ui/components/badge";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { Layers } from "lucide-react";

type Props = {
  detectorId: string;
};

function normalizeCoverage(coverage: ExtractionCoverageDto | null) {
  const fields = Array.isArray(coverage?.fields)
    ? coverage.fields
    : Array.isArray(coverage?.fieldCoverage)
      ? coverage.fieldCoverage
      : [];
  const totalExtractions =
    typeof coverage?.totalExtractions === "number"
      ? coverage.totalExtractions
      : typeof coverage?.findingsWithExtraction === "number"
        ? coverage.findingsWithExtraction
        : 0;

  return {
    fields,
    totalExtractions,
  };
}

function FieldCoverageRow({ field }: { field: ExtractionFieldCoverageDto }) {
  const percent = Math.round(field.rate * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm">{field.field}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {field.populated}/{field.total}
          </span>
          <Badge
            variant={
              percent >= 80
                ? "default"
                : percent >= 40
                  ? "secondary"
                  : "outline"
            }
            className="min-w-[44px] justify-center text-xs"
          >
            {percent}%
          </Badge>
        </div>
      </div>
      <Progress value={percent} className="h-1.5" />
    </div>
  );
}

export function CustomDetectorExtractionCoverage({ detectorId }: Props) {
  const [coverage, setCoverage] = useState<ExtractionCoverageDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const data = await api.getExtractionCoverage(detectorId);
        if (!cancelled) setCoverage(data);
      } catch {
        if (!cancelled) setCoverage(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [detectorId]);

  if (loading) {
    return (
      <Card className="border-2 border-black rounded-[6px] shadow-[6px_6px_0_#000]">
        <CardHeader>
          <CardTitle>Extraction Coverage</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading coverage…</p>
        </CardContent>
      </Card>
    );
  }

  const normalizedCoverage = normalizeCoverage(coverage);
  const hasFields = normalizedCoverage.fields.length > 0;

  return (
    <Card className="border-2 border-black rounded-[6px] shadow-[6px_6px_0_#000]">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Extraction Coverage</CardTitle>
            <CardDescription>
              How often each configured extractor field is populated across
              findings.
            </CardDescription>
          </div>
          {coverage && (
            <Badge variant="secondary" className="text-sm">
              {normalizedCoverage.totalExtractions} extraction
              {normalizedCoverage.totalExtractions !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!hasFields ? (
          <EmptyState
            icon={Layers}
            title="No extraction data yet"
            description="Extractions are generated during source scans once an extractor is configured."
          />
        ) : (
          <div className="space-y-4">
            {normalizedCoverage.fields.map((field) => (
              <FieldCoverageRow key={field.field} field={field} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
