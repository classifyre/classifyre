"use client";

import { useState } from "react";
import { ArrowLeft, Layers, Regex, Bot } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { toast } from "sonner";
import { PipelineDetectorEditor } from "@/components/pipeline-detector-editor";
import { useTranslation } from "@/hooks/use-translation";

// ── Detector type cards ────────────────────────────────────────────────────

type DetectorKind = "gliner2";

const DETECTOR_TYPES = [
  {
    id: "gliner2" as DetectorKind,
    Icon: Layers,
    title: "GLiNER2 Pipeline",
    tagline: "Single-pass neural extraction",
    description:
      "Define entities to extract and classification tasks — all run in a single model pass. Ideal for structured information extraction from unstructured text, with no training data required.",
    tags: ["NER", "Zero-shot", "Validation rules"],
    available: true,
  },
  {
    id: "regex" as const,
    Icon: Regex,
    title: "Regex Patterns",
    tagline: "Deterministic pattern matching",
    description:
      "Define precise pattern-matching rules using regular expressions. Fast, deterministic, zero ML overhead. Perfect for codes, IDs, and structured formats like IBANs or order numbers.",
    tags: ["Pattern matching", "No ML", "Deterministic"],
    available: false,
  },
  {
    id: "llm" as const,
    Icon: Bot,
    title: "LLM Detector",
    tagline: "Prompt-driven detection",
    description:
      "Use a large language model with a natural-language prompt. Best for nuanced, context-dependent detection where examples and rules are hard to define explicitly.",
    tags: ["Prompt-based", "Context-aware", "High accuracy"],
    available: false,
  },
] as const;

function DetectorTypeSelector({
  onSelect,
}: {
  onSelect: (kind: DetectorKind) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {DETECTOR_TYPES.map((dt) => {
          const { Icon } = dt;
          return (
            <button
              key={dt.id}
              type="button"
              disabled={!dt.available}
              onClick={() => dt.available && onSelect(dt.id as DetectorKind)}
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
        })}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function NewCustomDetectorPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [selectedKind, setSelectedKind] = useState<DetectorKind | null>(null);
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

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      {/* Header */}
      <div>
        <Button
          variant="outline"
          onClick={() =>
            selectedKind ? setSelectedKind(null) : router.push("/detectors")
          }
          className="mb-4 rounded-[4px] border-2 border-black shadow-[3px_3px_0_#000]"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {selectedKind ? t("detectors.selectType") : t("detectors.backToCatalog")}
        </Button>

        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-0.5">
          {t("detectors.title")}
        </div>
        <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
          {t("detectors.addNew")}
        </h1>
        <p className="text-muted-foreground mt-2 max-w-xl">
          {selectedKind
            ? "Build a GLiNER2 pipeline detector. Define entities to extract and classification tasks — all run in a single model pass."
            : t("detectors.selectTypeDesc")}
        </p>
      </div>

      {/* Phase 1: type selector */}
      {!selectedKind && (
        <DetectorTypeSelector onSelect={setSelectedKind} />
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
    </div>
  );
}
