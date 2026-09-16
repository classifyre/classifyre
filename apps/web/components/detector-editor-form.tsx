"use client";

import * as React from "react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { api, type CustomDetectorResponseDto } from "@workspace/api-client";
import { PipelineDetectorEditor } from "@/components/pipeline-detector-editor";
import type { PipelineDetectorEditorHandle } from "@/components/pipeline-detector-editor";
import { RegexDetectorEditor } from "@/components/regex-detector-editor";
import type { RegexDetectorEditorHandle } from "@/components/regex-detector-editor";
import {
  TransformerDetectorEditor,
  type TransformerPipelineType,
} from "@/components/transformer-detector-editor";
import type { TransformerDetectorEditorHandle } from "@/components/transformer-detector-editor";
import {
  CustomDetectorEditor,
  type CustomDetectorEditorSubmit,
} from "@/components/custom-detector-editor";
import type { CustomDetectorEditorHandle } from "@/components/custom-detector-editor";
import { LLMDetectorEditor } from "@/components/llm-detector-editor";
import type { LLMDetectorEditorHandle } from "@/components/llm-detector-editor";
import { TagDetectorEditor } from "@/components/tag-detector-editor";
import type { TagDetectorEditorHandle } from "@/components/tag-detector-editor";
import { resolveDetectorKind } from "@/lib/detector-kind";
import { useTranslation } from "@/hooks/use-translation";

// ── Types ────────────────────────────────────────────────────────────────────

export type DetectorWithPipeline = CustomDetectorResponseDto & {
  pipelineSchema?: Record<string, unknown>;
};

export interface DetectorEditorFormHandle {
  submit: () => Promise<boolean>;
}

export interface DetectorEditorFormProps {
  detector: DetectorWithPipeline;
  embedded?: boolean;
  onSaved?: () => void;
}



// ── Component ────────────────────────────────────────────────────────────────

export const DetectorEditorForm = React.forwardRef<
  DetectorEditorFormHandle,
  DetectorEditorFormProps
>(function DetectorEditorForm({ detector, embedded, onSaved }, ref) {
  const { t } = useTranslation();
  const [isSaving, setIsSaving] = useState(false);

  const pipelineRef = React.useRef<PipelineDetectorEditorHandle>(null);
  const regexRef = React.useRef<RegexDetectorEditorHandle>(null);
  const transformerRef = React.useRef<TransformerDetectorEditorHandle>(null);
  const llmRef = React.useRef<LLMDetectorEditorHandle>(null);
  const tagRef = React.useRef<TagDetectorEditorHandle>(null);
  const customRef = React.useRef<CustomDetectorEditorHandle>(null);

  // Resolved through the shared helper so this form and the details page
  // can never disagree about which editor a detector gets.
  const detectorKind = resolveDetectorKind(
    detector.pipelineSchema as Record<string, unknown> | null,
  );
  const pipelineSchemaType = (
    detector.pipelineSchema as Record<string, unknown>
  )?.type as string | undefined;
  const isPipelineDetector = detectorKind !== "legacy";
  const isRegexPipeline = detectorKind === "regex";
  const isLLMPipeline = detectorKind === "llm";
  const isTagPipeline = detectorKind === "tag";
  const isTransformerPipeline = detectorKind === "transformer";

  const handleSave = useCallback(
    async (payload: {
      name: string;
      key?: string;
      description?: string;
      isActive?: boolean;
      pipelineSchema?: Record<string, unknown>;
      aiProviderConfigId?: string;
      config?: Record<string, unknown>;
      method?: string;
    }) => {
      try {
        setIsSaving(true);
        await api.updateCustomDetector(detector.id, {
          name: payload.name,
          key: payload.key,
          description: payload.description,
          isActive: payload.isActive,
          pipelineSchema: payload.pipelineSchema,
          aiProviderConfigId: payload.aiProviderConfigId,
          config: payload.config,
          method: payload.method,
        } as any);
        toast.success(t("detectors.saved"));
        onSaved?.();
        return true;
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("detectors.failedToSave"),
        );
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [detector.id, onSaved, t],
  );

  React.useImperativeHandle(
    ref,
    () => ({
      submit: async () => {
        try {
          if (isTransformerPipeline) {
            await transformerRef.current?.submit();
            return true;
          }
          if (isLLMPipeline) {
            await llmRef.current?.submit();
            return true;
          }
          if (isTagPipeline) {
            await tagRef.current?.submit();
            return true;
          }
          if (isRegexPipeline) {
            await regexRef.current?.submit();
            return true;
          }
          if (isPipelineDetector) {
            await pipelineRef.current?.submit();
            return true;
          }
          await customRef.current?.submit();
          return true;
        } catch {
          return false;
        }
      },
    }),
    [
      isPipelineDetector,
      isRegexPipeline,
      isLLMPipeline,
      isTagPipeline,
      isTransformerPipeline,
    ],
  );

  if (isTransformerPipeline) {
    return (
      <TransformerDetectorEditor
        ref={transformerRef}
        pipelineType={pipelineSchemaType as TransformerPipelineType}
        mode="edit"
        detectorId={detector.id}
        submitLabel={t("common.save")}
        isSubmitting={isSaving}
        embedded={embedded}
        initialPipelineSchema={detector.pipelineSchema}
        initialName={detector.name}
        initialKey={detector.key}
        initialDescription={detector.description ?? ""}
        initialIsActive={detector.isActive}
        onSubmit={async (payload) => {
          await handleSave({
            name: payload.name,
            key: payload.key,
            description: payload.description,
            isActive: payload.isActive,
            pipelineSchema: payload.pipelineSchema,
          });
        }}
      />
    );
  }

  if (isLLMPipeline) {
    return (
      <LLMDetectorEditor
        ref={llmRef}
        mode="edit"
        detectorId={detector.id}
        submitLabel={t("common.save")}
        isSubmitting={isSaving}
        embedded={embedded}
        initialPipelineSchema={detector.pipelineSchema}
        initialName={detector.name}
        initialKey={detector.key}
        initialDescription={detector.description ?? ""}
        initialIsActive={detector.isActive}
        initialAiProviderConfigId={
          (detector as { aiProviderConfigId?: string | null })
            .aiProviderConfigId ?? null
        }
        onSubmit={async (payload) => {
          await handleSave({
            name: payload.name,
            key: payload.key,
            description: payload.description,
            isActive: payload.isActive,
            pipelineSchema: payload.pipelineSchema,
            aiProviderConfigId: payload.aiProviderConfigId,
          });
        }}
      />
    );
  }

  if (isTagPipeline) {
    return (
      <TagDetectorEditor
        ref={tagRef}
        mode="edit"
        submitLabel={t("common.save")}
        isSubmitting={isSaving}
        embedded={embedded}
        initialPipelineSchema={detector.pipelineSchema}
        initialName={detector.name}
        initialKey={detector.key}
        initialDescription={detector.description ?? ""}
        initialIsActive={detector.isActive}
        onSubmit={async (payload) => {
          await handleSave({
            name: payload.name,
            key: payload.key,
            description: payload.description,
            isActive: payload.isActive,
            pipelineSchema: payload.pipelineSchema,
          });
        }}
      />
    );
  }

  if (isRegexPipeline) {
    return (
      <RegexDetectorEditor
        ref={regexRef}
        mode="edit"
        detectorId={detector.id}
        submitLabel={t("common.save")}
        isSubmitting={isSaving}
        embedded={embedded}
        initialPipelineSchema={detector.pipelineSchema}
        initialName={detector.name}
        initialKey={detector.key}
        initialDescription={detector.description ?? ""}
        initialIsActive={detector.isActive}
        onSubmit={async (payload) => {
          await handleSave({
            name: payload.name,
            key: payload.key,
            description: payload.description,
            isActive: payload.isActive,
            pipelineSchema: payload.pipelineSchema,
          });
        }}
      />
    );
  }

  if (isPipelineDetector) {
    return (
      <PipelineDetectorEditor
        ref={pipelineRef}
        mode="edit"
        detectorId={detector.id}
        submitLabel={t("common.save")}
        isSubmitting={isSaving}
        embedded={embedded}
        initialPipelineSchema={detector.pipelineSchema}
        initialName={detector.name}
        initialKey={detector.key}
        initialDescription={detector.description ?? ""}
        initialIsActive={detector.isActive}
        onSubmit={async (payload) => {
          await handleSave({
            name: payload.name,
            key: payload.key,
            description: payload.description,
            isActive: payload.isActive,
            pipelineSchema: payload.pipelineSchema,
          });
        }}
      />
    );
  }

  return (
    <CustomDetectorEditor
      ref={customRef}
      mode="edit"
      initialValue={{
        id: detector.id,
        name: detector.name,
        key: detector.key,
        description: detector.description ?? "",
        method: detector.method,
        isActive: detector.isActive,
        config: detector.config,
      }}
      submitLabel={t("common.save")}
      isSubmitting={isSaving}
      embedded={embedded}
      onSubmit={async (payload: CustomDetectorEditorSubmit) => {
        await handleSave({
          name: payload.name,
          key: payload.key,
          description: payload.description,
          method: payload.method,
          isActive: payload.isActive,
          config: payload.config,
        });
      }}
    />
  );
});
