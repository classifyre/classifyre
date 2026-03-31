"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import {
  api,
  type AssistantOperation,
  type AssistantUiAction,
  type CreateCustomDetectorDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { toast } from "sonner";
import {
  CustomDetectorEditor,
  type CustomDetectorEditorHandle,
  type CustomDetectorEditorSubmit,
} from "@/components/custom-detector-editor";
import { useRegisterAssistantBridge } from "@/components/assistant-workflow-provider";
import { useTranslation } from "@/hooks/use-translation";

export default function NewCustomDetectorPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const editorRef = useRef<CustomDetectorEditorHandle | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [createdDetectorId, setCreatedDetectorId] = useState<string | null>(
    null,
  );

  const handleCreate = async (payload: CustomDetectorEditorSubmit) => {
    const request: CreateCustomDetectorDto = {
      name: payload.name,
      key: payload.key,
      method: payload.method,
      description: payload.description,
      isActive: payload.isActive,
      config: payload.config,
    };

    try {
      setIsSaving(true);
      const created = await api.createCustomDetector(request);
      setCreatedDetectorId(created.id);
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

  const assistantBridge = useMemo(
    () => ({
      contextKey: "detector.create" as const,
      canOpen: true,
      getContext: async () => {
        const snapshot = editorRef.current?.getAssistantSnapshot();
        const validation = editorRef.current?.validate() ?? {
          isValid: false,
          missingFields: [],
          errors: ["Detector editor is not mounted"],
        };

        return {
          key: "detector.create" as const,
          route: "/detectors/new",
          title: t("detectors.studioAssistant"),
          entityId: createdDetectorId,
          values: {
            name: snapshot?.name ?? "",
            key: snapshot?.key ?? "",
            description: snapshot?.description ?? "",
            method: snapshot?.method ?? "RULESET",
          },
          schema: null,
          validation,
          metadata: {
            name: snapshot?.name ?? "",
            key: snapshot?.key ?? "",
            description: snapshot?.description ?? "",
            method: snapshot?.method ?? "RULESET",
            isActive: snapshot?.isActive ?? true,
            config: snapshot?.config ?? {},
            editorMode: snapshot?.editorMode ?? "builder",
          },
          supportedOperations: createdDetectorId
            ? (["train_custom_detector"] satisfies AssistantOperation[])
            : (["create_custom_detector"] satisfies AssistantOperation[]),
        };
      },
      applyAction: async (action: AssistantUiAction) => {
        if (action.type === "patch_fields") {
          editorRef.current?.applyPatches(action.patches);
          return;
        }

        if (action.type === "sync_detector") {
          setCreatedDetectorId(action.detectorId);
          const patches = Object.entries(action.values).map(
            ([path, value]) => ({
              path,
              value,
            }),
          );
          editorRef.current?.applyPatches(patches);
          router.push(`/detectors/${action.detectorId}`);
        }
      },
    }),
    [createdDetectorId, t],
  );

  useRegisterAssistantBridge(assistantBridge);

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <div>
        <Button
          variant="outline"
          onClick={() => router.push("/detectors")}
          className="mb-4 rounded-[4px] border-2 border-black shadow-[3px_3px_0_#000]"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("detectors.backToCatalog")}
        </Button>
        <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
          {t("detectors.addNew")}
        </h1>
        <p className="text-muted-foreground mt-2">
          {t("detectors.addNewDesc")}
        </p>
      </div>

      <CustomDetectorEditor
        ref={editorRef}
        mode="create"
        submitLabel={t("detectors.create")}
        isSubmitting={isSaving}
        onSubmit={handleCreate}
      />
    </div>
  );
}
