"use client";

import * as React from "react";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";
import { useNamespace } from "@/components/namespace-provider";
import { getWebSocketUrl } from "@/hooks/use-notifications-websocket";
import { useTranslation } from "@/hooks/use-translation";
import { useBoardStore } from "../store/board-context";
import { useActorName } from "./use-actor-name";

interface BoardChangedEvent {
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
 * Async collaboration (PRD §5.12, D1): after another tab writes, the API
 * pushes `changed`; this board refetches and merges, keeping its own
 * unflushed ops on top, and says who changed what. Presence-lite lists the
 * other people with the board open. No live cursors — that is Phase 8.
 */
export function useBoardSocket(caseId: string): void {
  const store = useBoardStore();
  const { t } = useTranslation();
  const { slug } = useNamespace();
  const [actor] = useActorName();
  const socketRef = React.useRef<Socket | null>(null);
  const tRef = React.useRef(t);
  tRef.current = t;

  React.useEffect(() => {
    const socket = io(`${getWebSocketUrl()}/case-board`, {
      auth: { namespaceSlug: slug },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 20,
    });
    socketRef.current = socket;
    const subscribe = () =>
      socket.emit("subscribe", { caseId, actor: actor ? encodeURIComponent(actor) : undefined });

    socket.on("connect", subscribe);
    socket.on("changed", (event: BoardChangedEvent) => {
      if (event.caseId !== caseId || event.clientId === store.getState().clientId) return;
      store.getState().refetch();
      const who = event.actor || tRef.current("caseBoard.someone");
      toast(tRef.current("caseBoard.changedBy", { name: who, summary: event.summary }), {
        id: `case-board-changed-${caseId}`,
        duration: 3000,
      });
    });
    socket.on("presence", (members: PresenceMember[]) => {
      const others = members
        .filter((m) => m.socketId !== socket.id)
        .map((m) => m.name || tRef.current("caseBoard.someone"));
      store.getState().setPresence(others);
    });
    return () => {
      socket.emit("unsubscribe");
      socket.disconnect();
      socketRef.current = null;
    };
  }, [caseId, slug, store, actor]);
}
