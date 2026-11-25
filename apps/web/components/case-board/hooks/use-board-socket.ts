"use client";

import * as React from "react";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";
import { useNamespace } from "@/components/namespace-provider";
import { getWebSocketUrl } from "@/lib/websocket-url";
import { useTranslation } from "@/hooks/use-translation";
import { useBoardStore } from "../store/board-context";

export interface CaseRoomChangedEvent {
  caseId: string;
  version: number;
  actor: string | null;
  clientId: string;
  summary: string;
}

interface PresenceMember {
  socketId: string;
  name: string;
}

/**
 * Shared `/case-board` room hook used by both investigation boards and data
 * request workspaces for live change sync and presence-lite.
 */
export function useCaseRoomSocket(
  caseId: string,
  clientId: string,
  handlers: {
    onChanged: (event: CaseRoomChangedEvent) => void;
    onPresence: (others: string[]) => void;
  },
): void {
  const { t } = useTranslation();
  const { slug } = useNamespace();
  const tRef = React.useRef(t);
  tRef.current = t;
  const handlersRef = React.useRef(handlers);
  handlersRef.current = handlers;

  React.useEffect(() => {
    if (!caseId || !slug) return;
    const socket: Socket = io(`${getWebSocketUrl()}/case-board`, {
      auth: { namespaceSlug: slug },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 20,
    });
    const subscribe = () => socket.emit("subscribe", { caseId });

    socket.on("connect", subscribe);
    socket.on("changed", (event: CaseRoomChangedEvent) => {
      if (event.caseId !== caseId || event.clientId === clientId) return;
      handlersRef.current.onChanged(event);
    });
    socket.on("presence", (members: PresenceMember[]) => {
      const others = members
        .filter((m) => m.socketId !== socket.id)
        .map((m) => m.name || tRef.current("caseBoard.someone"));
      handlersRef.current.onPresence(others);
    });
    return () => {
      socket.emit("unsubscribe");
      socket.disconnect();
    };
  }, [caseId, clientId, slug]);
}

/**
 * Async collaboration (PRD §5.12, D1): after another tab writes, the API
 * pushes `changed`; this board refetches and merges, keeping its own
 * unflushed ops on top, and says who changed what. Presence-lite lists the
 * other people with the board open. No live cursors — that is Phase 8.
 */
export function useBoardSocket(caseId: string): void {
  const store = useBoardStore();
  const { t } = useTranslation();
  const tRef = React.useRef(t);
  tRef.current = t;

  useCaseRoomSocket(caseId, store.getState().clientId, {
    onChanged: (event) => {
      store.getState().refetch();
      const who = event.actor || tRef.current("caseBoard.someone");
      toast(
        tRef.current("caseBoard.changedBy", {
          name: who,
          summary: event.summary,
        }),
        {
          id: `case-board-changed-${caseId}`,
          duration: 3000,
        },
      );
    },
    onPresence: (others) => {
      store.getState().setPresence(others);
    },
  });
}
