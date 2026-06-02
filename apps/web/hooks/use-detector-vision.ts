"use client";

import { useMemo } from "react";
import { useAiProviderConfigs } from "@/hooks/use-ai-provider-configs";

/**
 * Fetches all AI provider configs and returns a lookup function that resolves
 * an aiProviderConfigId to its supportsVision boolean. Non-blocking — starts
 * loading on mount and returns false until providers are loaded.
 *
 * Used by components that render custom detectors (LLM pipelines) and need to
 * show a visual-scan badge only when the backing AI provider supports vision.
 */
export function useDetectorVision(): {
  supportsVision: (aiProviderConfigId: string | null | undefined) => boolean;
  loading: boolean;
} {
  const { providers, loading } = useAiProviderConfigs();

  const providerVisionMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const p of providers) {
      map.set(p.id, p.supportsVision);
    }
    return map;
  }, [providers]);

  return {
    supportsVision: (aiProviderConfigId) =>
      aiProviderConfigId != null
        ? providerVisionMap.get(aiProviderConfigId) ?? false
        : false,
    loading,
  };
}
