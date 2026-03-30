"use client";

import * as React from "react";
import { api } from "@workspace/api-client";
import type { AiMessageDto } from "@workspace/api-client";

interface AiClientContextValue {
  generateText: (messages: AiMessageDto[]) => Promise<string>;
}

const AiClientContext = React.createContext<AiClientContextValue | null>(null);

export function AssistantModelProvider({
  children,
}: {
  children: React.ReactNode;
  /** @deprecated no longer used — AI runs on the backend */
  aiEnabled?: boolean;
}) {
  const generateText = React.useCallback(
    async (messages: AiMessageDto[]): Promise<string> => {
      const result = await api.aiComplete(messages);
      return result.content;
    },
    [],
  );

  return (
    <AiClientContext.Provider value={{ generateText }}>
      {children}
    </AiClientContext.Provider>
  );
}

export function useAssistantModel() {
  const context = React.useContext(AiClientContext);
  if (!context) {
    throw new Error(
      "useAssistantModel must be used within AssistantModelProvider",
    );
  }
  return context;
}
