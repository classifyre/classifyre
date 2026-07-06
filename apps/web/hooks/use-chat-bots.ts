"use client";

import * as React from "react";
import { api, type ChatBotResponseDto } from "@workspace/api-client";
import { useTranslation } from "@/hooks/use-translation";

export type UseChatBots = {
  bots: ChatBotResponseDto[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<ChatBotResponseDto[]>;
};

/** Loads the configured Telegram/Slack chat bots (Settings → Chat). */
export function useChatBots(): UseChatBots {
  const { t } = useTranslation();
  const [bots, setBots] = React.useState<ChatBotResponseDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await api.chatBots.chatBotsControllerList();
      setBots(result);
      return result;
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : t("chatBots.failedToLoad"),
      );
      return [];
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return { bots, loading, error, refresh };
}
