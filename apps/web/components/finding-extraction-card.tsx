"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { api, type CustomDetectorExtractionDto } from "@workspace/api-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

type Props = {
  findingId: string;
};

export function FindingExtractionCard({ findingId }: Props) {
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

  const pipelineResult = extraction.pipelineResult ?? {};
  const entityEntries = Object.entries(pipelineResult.entities ?? {}).filter(
    ([, spans]) => Array.isArray(spans) && spans.length > 0,
  );
  const classificationEntries = Object.entries(
    pipelineResult.classification ?? {},
  ).filter(([, outcome]) => outcome && outcome.label);

  if (entityEntries.length === 0 && classificationEntries.length === 0) {
    return null;
  }

  const metadata = pipelineResult.metadata ?? {};
  const runner =
    typeof metadata.runner === "string" ? metadata.runner : undefined;
  const model =
    typeof metadata.model === "string" ? metadata.model : undefined;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>Extracted Data</CardTitle>
            <CardDescription>
              Structured output from the custom detector pipeline.
            </CardDescription>
          </div>
          {runner ? (
            <Badge variant="outline" className="font-mono text-xs">
              {runner}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {entityEntries.length > 0 ? (
          <dl className="grid gap-2">
            {entityEntries.map(([label, spans]) => (
              <div
                key={label}
                className="grid grid-cols-[160px_1fr] items-start gap-3 rounded-[4px] border border-border/10 px-3 py-2"
              >
                <dt className="font-mono text-xs font-medium text-muted-foreground pt-0.5">
                  {label}
                </dt>
                <dd className="flex flex-wrap gap-1.5">
                  {spans.map((span, index) => (
                    <Badge
                      key={`${label}-${index}`}
                      variant="secondary"
                      className="font-normal"
                    >
                      {span.value}
                      <span className="ml-1 text-muted-foreground">
                        {formatConfidence(span.confidence)}
                      </span>
                    </Badge>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {classificationEntries.length > 0 ? (
          <dl className="grid gap-2">
            {classificationEntries.map(([task, outcome]) => (
              <div
                key={task}
                className="grid grid-cols-[160px_1fr] items-start gap-3 rounded-[4px] border border-border/10 px-3 py-2"
              >
                <dt className="font-mono text-xs font-medium text-muted-foreground pt-0.5">
                  {task}
                </dt>
                <dd className="text-sm break-words">
                  {outcome.label}
                  <span className="ml-1 text-muted-foreground">
                    {formatConfidence(outcome.confidence)}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {model ? (
          <p className="text-xs text-muted-foreground">Model: {model}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
