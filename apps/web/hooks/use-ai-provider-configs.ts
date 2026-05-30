"use client";

import * as React from "react";
import {
  api,
  type AiProviderConfigResponseDto,
} from "@workspace/api-client";
import { useTranslation } from "@/hooks/use-translation";

export type UseAiProviderConfigs = {
  providers: AiProviderConfigResponseDto[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<AiProviderConfigResponseDto[]>;
};

/**
 * Loads the reusable AI provider credentials. Shared by the assistant model
 * selector (General tab) and the provider management list (AI Providers tab).
 */
export function useAiProviderConfigs(): UseAiProviderConfigs {
  const { t } = useTranslation();
  const [providers, setProviders] = React.useState<
    AiProviderConfigResponseDto[]
  >([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result =
        await api.aiProviderConfigs.aiProviderConfigControllerList();
      setProviders(result);
      return result;
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : t("aiProvider.failedToLoad"),
      );
      return [];
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return { providers, loading, error, refresh };
}
