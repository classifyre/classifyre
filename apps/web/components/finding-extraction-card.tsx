"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import {
  api,
  type CustomDetectorExtractionDto,
  ExtractionMethodEnum,
} from "@workspace/api-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { Layers } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";

const EXTRACTION_METHOD_LABELS: Record<string, string> = {
  [ExtractionMethodEnum.Regex]: "Regex",
  [ExtractionMethodEnum.Gliner]: "GLiNER",
  [ExtractionMethodEnum.ClassifierGliner]: "Classifier + GLiNER",
};

function renderFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

type Props = {
  findingId: string;
};

export function FindingExtractionCard({ findingId }: Props) {
  const { t } = useTranslation();
  const [extraction, setExtraction] = useState<
    CustomDetectorExtractionDto | null | undefined
  >(undefined);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await api.getFindingExtraction(findingId);
        if (!cancelled) setExtraction(data);
      } catch {
        if (!cancelled) setExtraction(null);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [findingId]);

  // undefined = still loading, null = not found / error
  if (extraction === undefined) return null;
  if (extraction === null) return null;

  const entries = Object.entries(extraction.extractedData).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );

  if (entries.length === 0) return null;

  const methodLabel =
    EXTRACTION_METHOD_LABELS[extraction.extractionMethod] ??
    extraction.extractionMethod;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>Extracted Data</CardTitle>
            <CardDescription>
              Structured fields extracted by the custom detector.
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">
            {methodLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <EmptyState
            icon={Layers}
            title={t("findings.extraction.noFields")}
            description={t("findings.extraction.noFieldsHint")}
          />
        ) : (
          <dl className="grid gap-2">
            {entries.map(([field, value]) => (
              <div
                key={field}
                className="grid grid-cols-[160px_1fr] items-start gap-3 rounded-[4px] border border-black/10 px-3 py-2"
              >
                <dt className="font-mono text-xs font-medium text-muted-foreground pt-0.5">
                  {field}
                </dt>
                <dd className="text-sm break-words">
                  {renderFieldValue(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
