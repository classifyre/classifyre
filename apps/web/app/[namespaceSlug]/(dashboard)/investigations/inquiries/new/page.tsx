"use client";

import { useMemo, useRef } from "react";
import type { AssistantUiAction } from "@workspace/api-client";
import { InquiryForm, type InquiryFormHandle } from "@/components/inquiry-form";
import { useRegisterAssistantBridge } from "@/components/assistant-workflow-provider";
import { useTranslation } from "@/hooks/use-translation";

export default function NewInquiryPage() {
  const formRef = useRef<InquiryFormHandle | null>(null);
  const { t } = useTranslation();

  const assistantBridge = useMemo(
    () => ({
      contextKey: "inquiry.create" as const,
      canOpen: true,
      getContext: () => {
        const values = formRef.current?.getValues() ?? {
          title: "",
          description: "",
          matchers: {},
        };
        return {
          key: "inquiry.create" as const,
          route: "/investigations/inquiries/new",
          title: t("investigations.inquiryForm.assistantTitle"),
          entityId: null,
          values,
          schema: null,
          validation: { isValid: true, missingFields: [], errors: [] },
          metadata: {},
        };
      },
      applyAction: (action: AssistantUiAction) => {
        if (action.type === "patch_fields") {
          formRef.current?.applyPatches(action.patches);
        }
      },
    }),
    [t],
  );

  useRegisterAssistantBridge(assistantBridge);

  return <InquiryForm ref={formRef} mode="create" />;
}
