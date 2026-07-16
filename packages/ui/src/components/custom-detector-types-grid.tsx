import * as React from "react";
import {
  Layers,
  Regex,
  Bot,
  Brain,
  Image,
  ScanSearch,
  ArrowRight,
} from "lucide-react";
import { cn } from "../lib/utils";

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

type DetectorKind =
  | "gliner2"
  | "regex"
  | "llm"
  | "text_classification"
  | "image_classification"
  | "object_detection";

const DETECTOR_ICONS: Record<
  DetectorKind,
  React.ComponentType<{ className?: string }>
> = {
  gliner2: Layers,
  regex: Regex,
  llm: Bot,
  text_classification: Brain,
  image_classification: Image,
  object_detection: ScanSearch,
};

const DETECTOR_DATA: Record<
  DetectorKind,
  {
    title: string;
    tagline: string;
    description: string;
    tags: string[];
    slug: string;
  }
> = {
  gliner2: {
    title: "GLiNER2 Pipeline",
    tagline: "Single-pass neural extraction",
    description:
      "Define entities to extract and classification tasks — all run in a single model pass. Ideal for structured information extraction from unstructured text, with no training data required.",
    tags: ["NER", "Zero-shot", "Validation rules"],
    slug: "gliner2",
  },
  regex: {
    title: "Regex Patterns",
    tagline: "Deterministic pattern matching",
    description:
      "Define precise pattern-matching rules using regular expressions. Fast, deterministic, zero ML overhead. Perfect for codes, IDs, and structured formats like IBANs or order numbers.",
    tags: ["Pattern matching", "No ML", "Deterministic"],
    slug: "regex",
  },
  llm: {
    title: "AI Detector",
    tagline: "Prompt-driven detection",
    description:
      "Use a large language model with a natural-language prompt to classify content and extract structured fields. Best for nuanced, context-dependent detection where examples and rules are hard to define explicitly.",
    tags: ["Prompt-based", "Classification", "Extraction"],
    slug: "llm",
  },
  text_classification: {
    title: "Text Classification",
    tagline: "Fine-tuned HuggingFace classifier",
    description:
      "Run any HuggingFace text-classification model. Map predicted labels to severity levels. Ideal for spam detection, toxicity, sentiment, and custom topic classifiers.",
    tags: ["Classification", "Confidence threshold", "Severity map"],
    slug: "text-classification",
  },
  image_classification: {
    title: "Image Classification",
    tagline: "Label images using a vision model",
    description:
      "Classify images with any HuggingFace vision model. Useful for NSFW detection, harmful content filtering, and custom image category labelling.",
    tags: ["Vision", "NSFW", "Harmful content"],
    slug: "image-classification",
  },
  object_detection: {
    title: "Object Detection",
    tagline: "Locate and label objects in images",
    description:
      "Run any HuggingFace object-detection model on images. Findings include bounding boxes, confidence scores, and label-based severity mapping.",
    tags: ["Bounding boxes", "Object labels", "Severity map"],
    slug: "object-detection",
  },
};

const GENERAL_KINDS: DetectorKind[] = ["gliner2", "regex", "llm"];
const TRANSFORMER_KINDS: DetectorKind[] = [
  "text_classification",
  "image_classification",
  "object_detection",
];

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function DetectorMethodCard({
  kind,
  href,
  variant,
}: {
  kind: DetectorKind;
  href?: string;
  variant: "marketing" | "reference";
}) {
  const Icon = DETECTOR_ICONS[kind];
  const data = DETECTOR_DATA[kind];
  const isVisual =
    kind === "image_classification" || kind === "object_detection";

  const inner = (
    <>
      {/* Visual badge */}
      {isVisual && (
        <span className="absolute right-4 top-4 rounded-[3px] border border-border bg-background px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
          Visual
        </span>
      )}

      {/* Icon */}
      <div
        className={cn(
          "mb-4 flex h-9 w-9 items-center justify-center rounded-[4px] border-2",
          "border-border bg-accent shadow-[2px_2px_0_var(--color-border)]",
          href &&
            "group-hover:shadow-[3px_3px_0_var(--color-border)] transition-shadow",
        )}
      >
        <Icon className="h-4 w-4 text-accent-foreground" />
      </div>

      {/* Title + tagline */}
      <div className="mb-2">
        <div className="font-serif text-base font-black uppercase tracking-[0.06em] leading-tight">
          {data.title}
        </div>
        <div className="mt-0.5 text-[10px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
          {data.tagline}
        </div>
      </div>

      {/* Description */}
      <p className="mb-4 text-sm text-muted-foreground leading-relaxed">
        {data.description}
      </p>

      {/* Tags */}
      <div className="mt-auto flex flex-wrap gap-1">
        {data.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-[3px] border border-border/30 bg-foreground/5 px-1.5 py-0.5 text-[10px] font-mono text-foreground"
          >
            {tag}
          </span>
        ))}
      </div>

      {/* CTA arrow for marketing variant with link */}
      {variant === "marketing" && href && (
        <div className="mt-4 self-end">
          <span className="inline-flex items-center gap-1 rounded-[4px] border-2 border-border bg-accent px-3 py-1 text-[11px] font-mono font-bold uppercase tracking-[0.08em] text-accent-foreground shadow-[2px_2px_0_var(--color-border)] group-hover:shadow-[3px_3px_0_var(--color-border)] transition-shadow">
            Learn more <ArrowRight className="h-3 w-3" />
          </span>
        </div>
      )}
    </>
  );

  const baseClass = cn(
    "group relative flex flex-col items-start rounded-[6px] border-2 p-5 text-left transition-all bg-background",
    href
      ? "border-border shadow-[4px_4px_0_var(--color-border)] hover:-translate-y-0.5 hover:shadow-[6px_6px_0_var(--color-border)] cursor-pointer no-underline text-foreground"
      : "border-border",
  );

  if (href) {
    return (
      <a href={href} className={baseClass}>
        {inner}
      </a>
    );
  }

  return <div className={baseClass}>{inner}</div>;
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

export type CustomDetectorTypesGridProps = {
  /**
   * Base URL for card links. Card href = `{hrefBase}{slug}`.
   * When omitted cards are non-interactive.
   */
  hrefBase?: string;
  /**
   * marketing — larger cards with a "Learn more" CTA button
   * reference — compact, links but no extra CTA chrome
   */
  variant?: "marketing" | "reference";
};

export function CustomDetectorTypesGrid({
  hrefBase,
  variant = "reference",
}: CustomDetectorTypesGridProps) {
  const makeHref = (slug: string) =>
    hrefBase ? `${hrefBase.replace(/\/$/, "")}/${slug}` : undefined;

  return (
    <div className="space-y-6">
      {/* General group */}
      <div className="grid gap-4 sm:grid-cols-3">
        {GENERAL_KINDS.map((kind) => (
          <DetectorMethodCard
            key={kind}
            kind={kind}
            href={makeHref(DETECTOR_DATA[kind].slug)}
            variant={variant}
          />
        ))}
      </div>

      {/* HuggingFace Transformers group */}
      <div>
        <div className="mb-3 flex items-center gap-3">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
            HuggingFace Transformers
          </div>
          <div className="flex-1 border-t border-border" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TRANSFORMER_KINDS.map((kind) => (
            <DetectorMethodCard
              key={kind}
              kind={kind}
              href={makeHref(DETECTOR_DATA[kind].slug)}
              variant={variant}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
