"use client";

import { useState } from "react";
import { ArrowLeft, Layers, Regex, Bot, Brain, Image, Network, ScanSearch, FileText, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@workspace/api-client";
import { Badge, Card } from "@workspace/ui/components";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { toast } from "sonner";
import { PipelineDetectorEditor } from "@/components/pipeline-detector-editor";
import { RegexDetectorEditor } from "@/components/regex-detector-editor";
import {
  TransformerDetectorEditor,
  type TransformerPipelineType,
} from "@/components/transformer-detector-editor";
import { getDetectorExamples, type DetectorExample } from "@/lib/detector-examples-loader";
import { useTranslation } from "@/hooks/use-translation";

// ── Detector type cards ────────────────────────────────────────────────────

type DetectorKind =
  | "gliner2"
  | "regex"
  | "llm"
  | "text_classification"
  | "image_classification"
  | "feature_extraction"
  | "object_detection";

const DETECTOR_TYPES: Array<{
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

function DetectorTypeSelector({
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

// ── Transformer example selector ───────────────────────────────────────────

function TransformerExampleSelector({
  pipelineType,
  onStartBlank,
  onSelectExample,
}: {
  pipelineType: TransformerPipelineType;
  onStartBlank: () => void;
  onSelectExample: (example: DetectorExample) => void;
}) {
  const { t } = useTranslation();
  const examples = getDetectorExamples("CUSTOM").filter((ex) => {
    const ps = (ex.config as Record<string, unknown>)?.pipeline_schema as
      | Record<string, unknown>
      | undefined;
    return ps?.type === pipelineType;
  });

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <button
        type="button"
        onClick={onStartBlank}
        data-testid="start-blank"
        className={cn(
          "group text-left rounded-[6px]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2",
        )}
      >
        <Card clickable className="h-full p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] border-2 border-black bg-card">
              <FileText className="h-4 w-4" />
            </div>
            <Badge className="rounded-[4px] border border-black bg-[#b7ff00] text-black">
              {t("ai.start")}
            </Badge>
          </div>
          <div className="mt-3">
            <div className="text-sm font-semibold">{t("detectors.startBlank")}</div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("detectors.startBlankDesc")}
            </div>
          </div>
        </Card>
      </button>

      {examples.map((example) => (
        <button
          key={example.name}
          type="button"
          onClick={() => onSelectExample(example)}
          className={cn(
            "group text-left rounded-[6px]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2",
          )}
        >
          <Card
            clickable
            className="h-full border-black bg-background p-4 shadow-[4px_4px_0_#000]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] border-2 border-black bg-card">
                <Sparkles className="h-4 w-4" />
              </div>
              <Badge
                variant="outline"
                className="rounded-[4px] border-black text-[10px]"
              >
                {t("detectors.templateBadge")}
              </Badge>
            </div>
            <div className="mt-3">
              <div className="text-sm font-semibold">{example.name}</div>
              <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {example.description || t("ai.startBlankDescription")}
              </div>
            </div>
          </Card>
        </button>
      ))}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function NewCustomDetectorPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [selectedKind, setSelectedKind] = useState<DetectorKind | null>(null);
  const [examplePhaseComplete, setExamplePhaseComplete] = useState(false);
  const [chosenExample, setChosenExample] = useState<DetectorExample | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleCreate = async (payload: {
    name: string;
    key?: string;
    description?: string;
    isActive?: boolean;
    pipelineSchema: Record<string, unknown>;
  }) => {
    try {
      setIsSaving(true);
      const created = await api.createCustomDetector({
        name: payload.name,
        key: payload.key,
        description: payload.description,
        isActive: payload.isActive ?? true,
        pipelineSchema: payload.pipelineSchema,
      } as any);
      toast.success(t("detectors.created"));
      router.push(`/detectors/${created.id}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("detectors.failedToCreate"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const isTransformerKind = (kind: DetectorKind | null): kind is TransformerDetectorKind =>
    ["text_classification", "image_classification", "feature_extraction", "object_detection"].includes(kind ?? "");

  const handleSelectKind = (kind: DetectorKind) => {
    setSelectedKind(kind);
    setExamplePhaseComplete(false);
    setChosenExample(null);
  };

  const handleBack = () => {
    if (isTransformerKind(selectedKind) && examplePhaseComplete) {
      setExamplePhaseComplete(false);
    } else if (selectedKind) {
      setSelectedKind(null);
      setExamplePhaseComplete(false);
      setChosenExample(null);
    } else {
      router.push("/detectors");
    }
  };

  const backLabel = isTransformerKind(selectedKind) && examplePhaseComplete
    ? t("detectors.chooseTemplate")
    : selectedKind
    ? t("detectors.selectType")
    : t("detectors.backToCatalog");

  const subtitle = isTransformerKind(selectedKind) && !examplePhaseComplete
    ? t("detectors.chooseTemplateDesc")
    : selectedKind === "gliner2"
    ? "Build a GLiNER2 pipeline detector. Define entities to extract and classification tasks — all run in a single model pass."
    : selectedKind === "regex"
    ? "Build a regex pattern detector. Define precise pattern-matching rules — fast, deterministic, zero ML overhead."
    : isTransformerKind(selectedKind)
    ? (() => {
        const labels: Record<TransformerDetectorKind, string> = {
          text_classification: "Run a HuggingFace text-classification model. Map predicted labels to severity levels.",
          image_classification: "Classify images with any HuggingFace vision model. Useful for NSFW, harmful content, and custom labelling.",
          feature_extraction: "Embed text into dense vectors using a HuggingFace sentence-transformer. Findings store the resulting embedding.",
          object_detection: "Detect and locate objects in images with any HuggingFace object-detection model.",
        };
        return labels[selectedKind as TransformerDetectorKind];
      })()
    : t("detectors.selectTypeDesc");

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      {/* Header */}
      <div>
        <Button
          variant="outline"
          onClick={handleBack}
          className="mb-4 rounded-[4px] border-2 border-black shadow-[3px_3px_0_#000]"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {backLabel}
        </Button>

        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-0.5">
          {t("detectors.title")}
        </div>
        <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
          {t("detectors.addNew")}
        </h1>
        <p className="text-muted-foreground mt-2 max-w-xl">{subtitle}</p>
      </div>

      {/* Phase 1: type selector */}
      {!selectedKind && (
        <DetectorTypeSelector onSelect={handleSelectKind} />
      )}

      {/* Phase 2a (transformer): example/blank selection */}
      {isTransformerKind(selectedKind) && !examplePhaseComplete && (
        <TransformerExampleSelector
          pipelineType={kindToPipelineType(selectedKind)}
          onStartBlank={() => {
            setChosenExample(null);
            setExamplePhaseComplete(true);
          }}
          onSelectExample={(ex) => {
            setChosenExample(ex);
            setExamplePhaseComplete(true);
          }}
        />
      )}

      {/* Phase 2b (transformer): form pre-filled from example or blank */}
      {isTransformerKind(selectedKind) && examplePhaseComplete && (
        <TransformerDetectorEditor
          pipelineType={kindToPipelineType(selectedKind)}
          mode="create"
          submitLabel={t("detectors.create")}
          isSubmitting={isSaving}
          initialName={chosenExample ? String((chosenExample.config as Record<string, unknown>)?.name ?? "") : ""}
          initialKey={chosenExample ? String((chosenExample.config as Record<string, unknown>)?.custom_detector_key ?? "") : ""}
          initialDescription={chosenExample?.description ?? ""}
          initialPipelineSchema={
            chosenExample
              ? (chosenExample.config as Record<string, unknown>)?.pipeline_schema as Record<string, unknown>
              : undefined
          }
          onSubmit={handleCreate}
        />
      )}

      {/* Phase 2: GLiNER2 form with stepper */}
      {selectedKind === "gliner2" && (
        <PipelineDetectorEditor
          mode="create"
          submitLabel={t("detectors.create")}
          isSubmitting={isSaving}
          onSubmit={handleCreate}
        />
      )}

      {/* Phase 2: Regex form with stepper */}
      {selectedKind === "regex" && (
        <RegexDetectorEditor
          mode="create"
          submitLabel={t("detectors.create")}
          isSubmitting={isSaving}
          onSubmit={handleCreate}
        />
      )}
    </div>
  );
}

type TransformerDetectorKind =
  | "text_classification"
  | "image_classification"
  | "feature_extraction"
  | "object_detection";

function kindToPipelineType(kind: TransformerDetectorKind): TransformerPipelineType {
  const map: Record<TransformerDetectorKind, TransformerPipelineType> = {
    text_classification: "TEXT_CLASSIFICATION",
    image_classification: "IMAGE_CLASSIFICATION",
    feature_extraction: "FEATURE_EXTRACTION",
    object_detection: "OBJECT_DETECTION",
  };
  return map[kind];
}
