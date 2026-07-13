"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { DetectorCreatorForm } from "@/components/detector-creator-form";
import { useRegisterAssistantBridge } from "@/components/assistant-workflow-provider";

export default function NewCustomDetectorPage() {
  const router = useRouter();

  const assistantBridge = useMemo(
    () => ({
      contextKey: "detector.create" as const,
      canOpen: true,
      getContext: () => ({
        key: "detector.create" as const,
        route: "/detectors/new",
        title: "Detector Studio Assistant",
        entityId: null,
        values: {},
        schema: null,
        validation: { isValid: true, missingFields: [], errors: [] },
        metadata: {},
      }),
      // The detector kind/type editors (regex/LLM/GLiNER2/transformer) each own
      // their own local form state and aren't lifted up to this page, so there
      // is nothing to patch here yet — context-only bridge.
      applyAction: () => undefined,
    }),
    [],
  );

  useRegisterAssistantBridge(assistantBridge);

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <DetectorCreatorForm
        onCreated={(detector) => {
          router.push(`/detectors/${detector.id}`);
        }}
        onCancel={() => router.push("/detectors")}
      />
    </div>
  );
}
