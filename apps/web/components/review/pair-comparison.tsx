"use client";

import * as React from "react";
import { ExternalLink } from "lucide-react";
import type {
  ReviewPairAssetDto,
  ReviewFieldRowDto,
  ReviewSharedValueDto,
} from "@workspace/api-client";
import { microLabelClass } from "@/components/panel-card";
import { useTranslation } from "@/hooks/use-translation";

/** Side by side, with the values that disagree marked rather than left to be spotted. */
export function PairComparison({
  a,
  b,
  fields,
  onOpenAsset,
}: {
  a: ReviewPairAssetDto;
  b: ReviewPairAssetDto;
  fields: ReviewFieldRowDto[];
  onOpenAsset: (assetId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[84px_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-0">
        <span />
        {[a, b].map((asset) => (
          <button
            key={asset.id}
            type="button"
            onClick={() => onOpenAsset(asset.id)}
            className="group min-w-0 pb-2 text-left"
          >
            <span className="flex items-center gap-1 truncate text-[13px] font-medium text-foreground group-hover:underline">
              {asset.name}
              <ExternalLink className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
            </span>
            <span className={`${microLabelClass} block truncate`}>
              {asset.sourceName}
            </span>
          </button>
        ))}

        {fields.length === 0 ? (
          <p className="col-span-3 border-t-2 border-border py-4 text-center text-[12px] text-muted-foreground">
            {t("review.pair.noValues")}
          </p>
        ) : (
          fields.map((field) => (
            <React.Fragment key={field.label}>
              <span className="border-t-2 border-border py-2 font-mono text-[11px] text-muted-foreground">
                {field.label}
              </span>
              <FieldCell values={field.aValues} shared={field.sharedValues} />
              <FieldCell values={field.bValues} shared={field.sharedValues} />
            </React.Fragment>
          ))
        )}
      </div>
    </div>
  );
}

function FieldCell({
  values,
  shared,
}: {
  values: string[];
  shared: ReviewSharedValueDto[];
}) {
  const sharedSet = React.useMemo(
    () => new Set(shared.map((s) => s.value)),
    [shared],
  );
  return (
    <span className="min-w-0 border-t-2 border-border py-2">
      {values.length === 0 ? (
        <span className="text-[12px] text-muted-foreground">—</span>
      ) : (
        <span className="flex flex-wrap gap-1">
          {values.map((value) => (
            <span
              key={value}
              className={`max-w-full truncate rounded-[2px] px-1 py-px font-mono text-[11px] ${
                sharedSet.has(value)
                  ? "bg-accent/25 text-foreground"
                  : // Not shared: this is the evidence against, so it reads as
                    // a difference rather than as ordinary text.
                    "text-destructive"
              }`}
            >
              {value}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
