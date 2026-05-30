"use client";

import * as React from "react";
import {
  Layers,
  Regex,
  Bot,
  Brain,
  Image,
  Network,
  ScanSearch,
} from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";

// ── Detector type cards ────────────────────────────────────────────────────

export type DetectorKind =
  | "gliner2"
  | "regex"
  | "llm"
  | "text_classification"
  | "image_classification"
  | "feature_extraction"
  | "object_detection";

const DETECTOR_ICONS: Record<DetectorKind, React.ComponentType<{ className?: string }>> = {
  gliner2: Layers,
  regex: Regex,
  llm: Bot,
  text_classification: Brain,
  image_classification: Image,
  feature_extraction: Network,
  object_detection: ScanSearch,
};

function DetectorTypeCard({
  kind,
  onSelect,
}: {
  kind: DetectorKind;
  onSelect: (kind: DetectorKind) => void;
}) {
  const { t } = useTranslation();
  const Icon = DETECTOR_ICONS[kind];
  const available = true;

  const title = t(`detectors.types.${kind}.title`);
  const tagline = t(`detectors.types.${kind}.tagline`);
  const description = t(`detectors.types.${kind}.description`);
  const tagsRaw = t(`detectors.types.${kind}.tags`);
  const tags = tagsRaw === `detectors.types.${kind}.tags` ? [] : tagsRaw.split(",").map((s) => s.trim());

  return (
    <button
      type="button"
      disabled={!available}
      data-testid={`method-card-${kind}`}
      onClick={() => available && onSelect(kind)}
      className={cn(
        "group relative flex flex-col items-start rounded-[6px] border-2 p-5 text-left transition-all",
        available
          ? "border-border bg-background shadow-[4px_4px_0_var(--color-border)] hover:-translate-y-0.5 hover:shadow-[6px_6px_0_var(--color-border)] cursor-pointer"
          : "border-border bg-muted/30 cursor-not-allowed opacity-60",
      )}
    >
      {/* Coming soon pill */}
      {!available && (
        <span className="absolute right-4 top-4 rounded-[3px] border border-border bg-background px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
          {t("detectors.comingSoon")}
        </span>
      )}

      {/* Icon */}
      <div
        className={cn(
          "mb-4 flex h-9 w-9 items-center justify-center rounded-[4px] border-2",
          available
            ? "border-border bg-accent shadow-[2px_2px_0_var(--color-border)] group-hover:shadow-[3px_3px_0_var(--color-border)]"
            : "border-border bg-muted",
        )}
      >
        <Icon className="h-4 w-4 text-accent-foreground" />
      </div>

      {/* Title + tagline */}
      <div className="mb-2">
        <div className="font-serif text-base font-black uppercase tracking-[0.06em] leading-tight">
          {title}
        </div>
        <div className="mt-0.5 text-[10px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
          {tagline}
        </div>
      </div>

      {/* Description */}
      <p className="mb-4 text-sm text-muted-foreground leading-relaxed">
        {description}
      </p>

      {/* Tags */}
      <div className="mt-auto flex flex-wrap gap-1">
        {tags.map((tag) => (
          <span
            key={tag}
            className={cn(
              "rounded-[3px] border px-1.5 py-0.5 text-[10px] font-mono",
              available
                ? "border-border/30 bg-foreground/5 text-foreground"
                : "border-border bg-background text-muted-foreground",
            )}
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Select arrow — only when available */}
      {available && (
        <div className="mt-4 self-end">
          <span className="rounded-[4px] border-2 border-border bg-accent px-3 py-1 text-[11px] font-mono font-bold uppercase tracking-[0.08em] text-accent-foreground shadow-[2px_2px_0_var(--color-border)] group-hover:shadow-[3px_3px_0_var(--color-border)] transition-shadow">
            {t("detectors.select")}
          </span>
        </div>
      )}
    </button>
  );
}

export function DetectorTypeSelector({
  onSelect,
}: {
  onSelect: (kind: DetectorKind) => void;
}) {
  const { t } = useTranslation();
  const generalIds: DetectorKind[] = ["gliner2", "regex", "llm"];
  const transformerIds: DetectorKind[] = [
    "text_classification",
    "image_classification",
    "feature_extraction",
    "object_detection",
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {generalIds.map((id) => (
          <DetectorTypeCard key={id} kind={id} onSelect={onSelect} />
        ))}
      </div>

      <div>
        <div className="mb-3 flex items-center gap-3">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
            {t("detectors.typeGroups.transformers")}
          </div>
          <div className="flex-1 border-t border-border" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {transformerIds.map((id) => (
            <DetectorTypeCard key={id} kind={id} onSelect={onSelect} />
          ))}
        </div>
      </div>
    </div>
  );
}
