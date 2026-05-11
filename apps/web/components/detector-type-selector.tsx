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

// ── Detector type cards ────────────────────────────────────────────────────

export type DetectorKind =
  | "gliner2"
  | "regex"
  | "llm"
  | "text_classification"
  | "image_classification"
  | "feature_extraction"
  | "object_detection";

export const DETECTOR_TYPES: Array<{
  id: DetectorKind;
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  tagline: string;
  description: string;
  tags: string[];
  available: boolean;
  group?: string;
}> = [
  {
    id: "gliner2",
    Icon: Layers,
    title: "GLiNER2 Pipeline",
    tagline: "Single-pass neural extraction",
    description:
      "Define entities to extract and classification tasks — all run in a single model pass. Ideal for structured information extraction from unstructured text, with no training data required.",
    tags: ["NER", "Zero-shot", "Validation rules"],
    available: true,
    group: "General",
  },
  {
    id: "regex",
    Icon: Regex,
    title: "Regex Patterns",
    tagline: "Deterministic pattern matching",
    description:
      "Define precise pattern-matching rules using regular expressions. Fast, deterministic, zero ML overhead. Perfect for codes, IDs, and structured formats like IBANs or order numbers.",
    tags: ["Pattern matching", "No ML", "Deterministic"],
    available: true,
    group: "General",
  },
  {
    id: "llm",
    Icon: Bot,
    title: "LLM Detector",
    tagline: "Prompt-driven detection",
    description:
      "Use a large language model with a natural-language prompt. Best for nuanced, context-dependent detection where examples and rules are hard to define explicitly.",
    tags: ["Prompt-based", "Context-aware", "High accuracy"],
    available: false,
    group: "General",
  },
  {
    id: "text_classification",
    Icon: Brain,
    title: "Text Classification",
    tagline: "Fine-tuned HuggingFace classifier",
    description:
      "Run any HuggingFace text-classification model. Map predicted labels to severity levels. Ideal for spam detection, toxicity, sentiment, and custom topic classifiers.",
    tags: ["Classification", "Confidence threshold", "Severity map"],
    available: true,
    group: "Transformers",
  },
  {
    id: "image_classification",
    Icon: Image,
    title: "Image Classification",
    tagline: "Label images using a vision model",
    description:
      "Classify images with any HuggingFace vision model. Useful for NSFW detection, harmful content filtering, and custom image category labelling.",
    tags: ["Vision", "NSFW", "Harmful content"],
    available: true,
    group: "Transformers",
  },
  {
    id: "feature_extraction",
    Icon: Network,
    title: "Feature Extraction",
    tagline: "Dense vector embeddings",
    description:
      "Embed text into dense vectors using any HuggingFace sentence-transformer. Store embeddings as findings for downstream semantic search or clustering.",
    tags: ["Embeddings", "Pooling", "Vector DB"],
    available: true,
    group: "Transformers",
  },
  {
    id: "object_detection",
    Icon: ScanSearch,
    title: "Object Detection",
    tagline: "Locate and label objects in images",
    description:
      "Run any HuggingFace object-detection model on images. Findings include bounding boxes, confidence scores, and label-based severity mapping.",
    tags: ["Bounding boxes", "Object labels", "Severity map"],
    available: true,
    group: "Transformers",
  },
];

function DetectorTypeCard({
  dt,
  onSelect,
}: {
  dt: (typeof DETECTOR_TYPES)[number];
  onSelect: (kind: DetectorKind) => void;
}) {
  const { Icon } = dt;
  return (
    <button
      type="button"
      disabled={!dt.available}
      data-testid={`method-card-${dt.id}`}
      onClick={() => dt.available && onSelect(dt.id)}
      className={cn(
        "group relative flex flex-col items-start rounded-[6px] border-2 p-5 text-left transition-all",
        dt.available
          ? "border-black bg-background shadow-[4px_4px_0_#000] hover:-translate-y-0.5 hover:shadow-[6px_6px_0_#000] cursor-pointer"
          : "border-border bg-muted/30 cursor-not-allowed opacity-60",
      )}
    >
      {/* Coming soon pill */}
      {!dt.available && (
        <span className="absolute right-4 top-4 rounded-[3px] border border-border bg-background px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
          Coming soon
        </span>
      )}

      {/* Icon */}
      <div
        className={cn(
          "mb-4 flex h-9 w-9 items-center justify-center rounded-[4px] border-2",
          dt.available
            ? "border-black bg-[#b7ff00] shadow-[2px_2px_0_#000] group-hover:shadow-[3px_3px_0_#000]"
            : "border-border bg-muted",
        )}
      >
        <Icon className="h-4 w-4" />
      </div>

      {/* Title + tagline */}
      <div className="mb-2">
        <div className="font-serif text-base font-black uppercase tracking-[0.06em] leading-tight">
          {dt.title}
        </div>
        <div className="mt-0.5 text-[10px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
          {dt.tagline}
        </div>
      </div>

      {/* Description */}
      <p className="mb-4 text-sm text-muted-foreground leading-relaxed">
        {dt.description}
      </p>

      {/* Tags */}
      <div className="mt-auto flex flex-wrap gap-1">
        {dt.tags.map((tag) => (
          <span
            key={tag}
            className={cn(
              "rounded-[3px] border px-1.5 py-0.5 text-[10px] font-mono",
              dt.available
                ? "border-black/30 bg-black/5 text-foreground"
                : "border-border bg-background text-muted-foreground",
            )}
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Select arrow — only when available */}
      {dt.available && (
        <div className="mt-4 self-end">
          <span className="rounded-[4px] border-2 border-black bg-[#b7ff00] px-3 py-1 text-[11px] font-mono font-bold uppercase tracking-[0.08em] shadow-[2px_2px_0_#000] group-hover:shadow-[3px_3px_0_#000] transition-shadow">
            Select →
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
  const generalTypes = DETECTOR_TYPES.filter((dt) => dt.group === "General");
  const transformerTypes = DETECTOR_TYPES.filter(
    (dt) => dt.group === "Transformers",
  );
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {generalTypes.map((dt) => (
          <DetectorTypeCard key={dt.id} dt={dt} onSelect={onSelect} />
        ))}
      </div>

      <div>
        <div className="mb-3 flex items-center gap-3">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
            HuggingFace Transformers
          </div>
          <div className="flex-1 border-t border-border" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {transformerTypes.map((dt) => (
            <DetectorTypeCard key={dt.id} dt={dt} onSelect={onSelect} />
          ))}
        </div>
      </div>
    </div>
  );
}
