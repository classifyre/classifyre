"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { toast } from "sonner";
import { api } from "@workspace/api-client";
import { PipelineDetectorEditor } from "@/components/pipeline-detector-editor";
import { RegexDetectorEditor } from "@/components/regex-detector-editor";
import {
  TransformerDetectorEditor,
  type TransformerPipelineType,
} from "@/components/transformer-detector-editor";
import { getDetectorExamples, type DetectorExample } from "@/lib/detector-examples-loader";
import { useTranslation } from "@/hooks/use-translation";
import {
  DetectorTypeSelector,
  type DetectorKind,
} from "@/components/detector-type-selector";
import { TransformerExampleSelector } from "@/components/detector-example-selector";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DetectorCreatorFormProps {
  embedded?: boolean;
  onCreated?: (detector: { id: string; name: string; key?: string }) => void;
  onCancel?: () => void;
}

type TransformerDetectorKind =
  | "text_classification"
  | "image_classification"
  | "feature_extraction"
  | "object_detection";

// ── Helpers ──────────────────────────────────────────────────────────────────

function kindToPipelineType(kind: TransformerDetectorKind): TransformerPipelineType {
  const map: Record<TransformerDetectorKind, TransformerPipelineType> = {
    text_classification: "TEXT_CLASSIFICATION",
    image_classification: "IMAGE_CLASSIFICATION",
    feature_extraction: "FEATURE_EXTRACTION",
    object_detection: "OBJECT_DETECTION",
  };
  return map[kind];
}

function isTransformerKind(kind: DetectorKind | null): kind is TransformerDetectorKind {
  return [
    "text_classification",
    "image_classification",
    "feature_extraction",
    "object_detection",
  ].includes(kind ?? "");
}

// ── Component ────────────────────────────────────────────────────────────────

export function DetectorCreatorForm({
  embedded,
  onCreated,
  onCancel,
}: DetectorCreatorFormProps) {
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
      onCreated?.(created);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("detectors.failedToCreate"),
      );
    } finally {
      setIsSaving(false);
    }
  };

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
      onCancel?.();
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
    <div className="space-y-6">
      {/* Header */}
      {!embedded && (
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
      )}

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
