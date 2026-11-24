"use client";

import * as React from "react";
import { io, type Socket } from "socket.io-client";
import { api } from "@workspace/api-client";
import type {
  AddDataRequestCommentDto,
  CreateDataRequestDto,
  DataRequestCheckResultDto,
  DataRequestDescribeResultDto,
  DataRequestDetailDto,
  DataRequestListItemDto,
  DataRequestListResponseDto,
  DataRequestOptionsDto,
  DeliverDataRequestDto,
  ThreadEntriesResponseDto,
  UpdateDataRequestSpecDto,
  UpdateDataRequestSqlDto,
} from "@workspace/api-client";
import { useNamespace } from "@/components/namespace-provider";
import { getWebSocketUrl } from "@/lib/websocket-url";

export type {
  DataRequestCheckResultDto,
  DataRequestDescribeResultDto,
  DataRequestDetailDto,
  DataRequestListItemDto,
  DataRequestListResponseDto,
  DataRequestOptionsDto,
};

export function fetchDataRequestOptions(): Promise<DataRequestOptionsDto> {
  return api.dataRequests.dataRequestsControllerOptions();
}

export function listDataRequests(
  scope: "mine" | "team" | "all" = "mine",
): Promise<DataRequestListResponseDto> {
  return api.dataRequests.dataRequestsControllerList({ scope });
}

export function createDataRequest(
  dto: CreateDataRequestDto,
): Promise<DataRequestDetailDto> {
  return api.dataRequests.dataRequestsControllerCreate({
    createDataRequestDto: dto,
  });
}

export function getDataRequest(id: string): Promise<DataRequestDetailDto> {
  return api.dataRequests.dataRequestsControllerGet({ id });
}

export function updateDataRequestSpec(
  id: string,
  dto: UpdateDataRequestSpecDto,
): Promise<DataRequestDetailDto> {
  return api.dataRequests.dataRequestsControllerUpdateSpec({
    id,
    updateDataRequestSpecDto: dto,
  });
}

export function updateDataRequestSql(
  id: string,
  dto: UpdateDataRequestSqlDto,
): Promise<DataRequestDetailDto> {
  return api.dataRequests.dataRequestsControllerUpdateSql({
    id,
    updateDataRequestSqlDto: dto,
  });
}

export function checkDataRequest(
  id: string,
): Promise<DataRequestCheckResultDto> {
  return api.dataRequests.dataRequestsControllerCheck({ id });
}

export function describeDataRequest(
  id: string,
): Promise<DataRequestDescribeResultDto> {
  return api.dataRequests.dataRequestsControllerDescribe({ id });
}

export function submitDataRequest(id: string): Promise<DataRequestDetailDto> {
  return api.dataRequests.dataRequestsControllerSubmit({ id });
}

export function withdrawDataRequest(id: string): Promise<DataRequestDetailDto> {
  return api.dataRequests.dataRequestsControllerWithdraw({ id });
}

export function claimDataRequest(
  id: string,
  assigneeRef?: string,
): Promise<DataRequestDetailDto> {
  return api.dataRequests.dataRequestsControllerClaim({
    id,
    claimDataRequestDto: assigneeRef ? { assigneeRef } : {},
  });
}

export function rerouteDataRequest(
  id: string,
  groupId: string,
): Promise<DataRequestDetailDto> {
  return api.dataRequests.dataRequestsControllerReroute({
    id,
    rerouteDataRequestDto: { groupId },
  });
}

export function deliverDataRequest(
  id: string,
  dto: DeliverDataRequestDto,
): Promise<DataRequestDetailDto> {
  return api.dataRequests.dataRequestsControllerDeliver({
    id,
    deliverDataRequestDto: dto,
  });
}

export function requestDataRequestChanges(
  id: string,
  reason: string,
): Promise<DataRequestDetailDto> {
  return api.dataRequests.dataRequestsControllerRequestChanges({
    id,
    requestChangesDto: { reason },
  });
}

export function declineDataRequest(
  id: string,
  reason: string,
): Promise<DataRequestDetailDto> {
  return api.dataRequests.dataRequestsControllerDecline({
    id,
    declineDataRequestDto: { reason },
  });
}

export function addDataRequestComment(
  id: string,
  dto: AddDataRequestCommentDto,
) {
  return api.dataRequests.dataRequestsControllerAddComment({
    id,
    addDataRequestCommentDto: dto,
  });
}

export async function getDataRequestCommentEntries(
  id: string,
  threadId: string,
): Promise<ThreadEntriesResponseDto> {
  const res =
    await api.dataRequests.dataRequestsControllerGetCommentEntriesRaw({
      id,
      threadId,
    });
  return (await res.raw.json()) as ThreadEntriesResponseDto;
}

export function replyDataRequestComment(
  id: string,
  threadId: string,
  body: string,
) {
  return api.dataRequests.dataRequestsControllerReplyComment({
    id,
    threadId,
    addDataRequestCommentReplyDto: { body },
  });
}

export function resolveDataRequestComment(
  id: string,
  threadId: string,
  resolved: boolean,
) {
  return api.dataRequests.dataRequestsControllerResolveComment({
    id,
    threadId,
    resolveDataRequestCommentDto: { resolved },
  });
}

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
 * Reuse the `/case-board` socket room for presence and live reload on data requests.
 */
export function useDataRequestSocket(
  caseId: string,
  clientId: string,
  onChanged: (event: BoardChangedEvent) => void,
  onPresence: (others: string[]) => void,
): void {
  const { slug } = useNamespace();
  const changedRef = React.useRef(onChanged);
  changedRef.current = onChanged;
  const presenceRef = React.useRef(onPresence);
  presenceRef.current = onPresence;

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
    socket.on("changed", (event: BoardChangedEvent) => {
      if (event.caseId !== caseId || event.clientId === clientId) return;
      changedRef.current(event);
    });
    socket.on("presence", (members: PresenceMember[]) => {
      const others = members
        .filter((m) => m.socketId !== socket.id)
        .map((m) => m.name || "Someone");
      presenceRef.current(others);
    });
    return () => {
      socket.emit("unsubscribe");
      socket.disconnect();
    };
  }, [caseId, clientId, slug]);
}
