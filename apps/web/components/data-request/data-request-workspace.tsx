"use client";

import * as React from "react";
import { Loader2, MessageSquarePlus, Redo2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { api, type DataRequestDetailDto } from "@workspace/api-client";
import {
  DATA_REQUEST_MAX_TABLES,
  type DataRequestPinAnchor,
} from "@workspace/schemas/data-request";
import { Button } from "@workspace/ui/components/button";
import { useTranslation } from "@/hooks/use-translation";
import { apiErrorMessage, fetchCatalog, type QueryCatalog } from "@/lib/data-query";
import {
  describeDataset,
  useSharedDataset,
  useSharedDatasetOptions,
  type SharedDatasetDto,
} from "@/lib/shared-datasets";
import { useCaseRoomSocket } from "@/components/case-board/hooks/use-board-socket";
import { CommentComposerPopover } from "@/components/case-board/ui/composer-popover";
import {
  ShareDatasetSheet,
  type ShareDatasetPreset,
} from "@/components/shared-datasets/share-dataset-sheet";
import type { VisualSchemaAdapter } from "@/components/visual-schema/types";
import { VisualSchemaWorkspace } from "@/components/visual-schema/visual-schema-workspace";
import {
  createRequestStore,
  snapToGrid,
  type RequestStoreApi,
} from "./store/request-store";
import {
  RequestStoreProvider,
  useRequest,
  useRequestStore,
} from "./store/request-context";
import {
  RequestCommentPin,
  type RequestCommentPinNode,
} from "./nodes/request-comment-pin";
import { RequestTopBar } from "./request-top-bar";
import { RequestSqlPanel } from "./request-sql-panel";

const EXTRA_NODE_TYPES = {
  "request-comment": RequestCommentPin,
};

export interface DataRequestWorkspaceProps {
  caseId: string;
}

/**
 * Keying the inner loader by `caseId` gives each case a fresh store created
 * once in `useState` and disposed in `useEffect` cleanup — no render-phase ref
 * mutation or disposal.
 */
export function DataRequestWorkspace({ caseId }: DataRequestWorkspaceProps) {
  return <DataRequestWorkspaceLoader key={caseId} caseId={caseId} />;
}

function DataRequestWorkspaceLoader({ caseId }: DataRequestWorkspaceProps) {
  const { t } = useTranslation();
  const tRef = React.useRef(t);
  tRef.current = t;
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [catalog, setCatalog] = React.useState<QueryCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = React.useState(true);

  const [store] = React.useState<RequestStoreApi>(() =>
    createRequestStore(caseId, {
      saveSpec: (id, payload) =>
        api.dataRequests.dataRequestsControllerUpdateSpec({
          id,
          updateDataRequestSpecDto: {
            spec: payload.spec as unknown as Record<string, unknown>,
            baseVersion: payload.baseVersion,
            clientId: payload.clientId,
          },
        }),
      saveSql: (id, payload) =>
        api.dataRequests.dataRequestsControllerUpdateSql({
          id,
          updateDataRequestSqlDto: payload,
        }),
      check: (id) => api.dataRequests.dataRequestsControllerCheck({ id }),
      describe: (id) => api.dataRequests.dataRequestsControllerDescribe({ id }),
      reload: (id) => api.dataRequests.dataRequestsControllerGet({ id }),
      onConflict: () => {
        toast.warning(tRef.current("dataRequest.toast.conflictReloaded"));
      },
      onError: async (err) => {
        toast.error(await apiErrorMessage(err));
      },
    }),
  );

  React.useEffect(() => {
    return () => {
      store.getState().dispose();
    };
  }, [store]);

  const loadAll = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detail, cat] = await Promise.all([
        api.dataRequests.dataRequestsControllerGet({ id: caseId }),
        fetchCatalog().catch(() => null),
      ]);
      setCatalog(cat);
      setCatalogLoading(false);
      store.getState().hydrate(detail, cat);
      if (detail.draftSql.trim()) {
        void store.getState().runCheck();
      }
    } catch (caught) {
      setError(await apiErrorMessage(caught));
    } finally {
      setLoading(false);
      setCatalogLoading(false);
    }
  }, [caseId, store]);

  React.useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useCaseRoomSocket(caseId, store.getState().clientId, {
    onChanged: (event) => {
      void store.getState().reloadFromServer();
      toast(
        tRef.current("caseBoard.changedBy", {
          name: event.actor || tRef.current("caseBoard.someone"),
          summary: event.summary,
        }),
        { id: `dr-changed-${caseId}`, duration: 3000 },
      );
    },
    onPresence: (others) => {
      store.getState().setPresence(others);
    },
  });

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] flex-col items-center justify-center gap-3 p-6 text-center text-sm">
        <p className="text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => void loadAll()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  return (
    <RequestStoreProvider store={store}>
      <DataRequestWorkspaceInner
        catalog={catalog}
        catalogLoading={catalogLoading}
      />
    </RequestStoreProvider>
  );
}

/**
 * Pure presentation wrapper usable both in production and in Playwright
 * component test harnesses with a pre-hydrated store.
 */
export function DataRequestWorkspaceView({
  store,
  catalog,
  catalogLoading = false,
}: {
  store: RequestStoreApi;
  catalog: QueryCatalog | null;
  catalogLoading?: boolean;
}) {
  return (
    <RequestStoreProvider store={store}>
      <DataRequestWorkspaceInner
        catalog={catalog}
        catalogLoading={catalogLoading}
      />
    </RequestStoreProvider>
  );
}

function DataRequestWorkspaceInner({
  catalog,
  catalogLoading,
}: {
  catalog: QueryCatalog | null;
  catalogLoading: boolean;
}) {
  const { t } = useTranslation();
  const store = useRequestStore();
  const caseId = useRequest((s) => s.caseId);
  const request = useRequest((s) => s.request);
  const spec = useRequest((s) => s.spec);
  const draftSql = useRequest((s) => s.draftSql);
  const diagnostics = useRequest((s) => s.diagnostics);
  const saving = useRequest((s) => s.saving);
  const dirty = useRequest((s) => s.dirty);
  const undoCount = useRequest((s) => s.undoStack.length);
  const redoCount = useRequest((s) => s.redoStack.length);
  const commentToolActive = useRequest((s) => s.commentToolActive);

  const [publishMode, setPublishMode] = React.useState<
    "team" | "self_serve" | null
  >(null);
  const [canPublishNow, setCanPublishNow] = React.useState(false);
  const [composer, setComposer] = React.useState<{
    x: number;
    y: number;
    screen: { x: number; y: number };
    anchor: DataRequestPinAnchor | null;
    anchorLabel: string | null;
  } | null>(null);
  const [postingComment, setPostingComment] = React.useState(false);

  // Pull live SharedDatasetDto when publishing a new version after changes requested
  const existingDataset = useSharedDataset(
    publishMode === "team" ? request?.dataset?.assetId : null,
  );

  // Load requester's publish-capable groups so self-serve uses an owning group
  // the requester can actually publish under (not blindly request.audienceGroup.id).
  const publishOptions = useSharedDatasetOptions();
  const selfServeOwnerId = React.useMemo(() => {
    const groups = publishOptions.data?.groups ?? [];
    if (!groups.length || !request) return null;
    return (
      groups.find((g) => g.id === request.audienceGroup.id)?.id ??
      groups[0]?.id ??
      null
    );
  }, [publishOptions.data?.groups, request]);

  // Check self-serve eligibility when requester has canSelfServe and valid SQL
  React.useEffect(() => {
    if (
      !request ||
      !request.permissions.isRequester ||
      request.permissions.isTeam ||
      !request.permissions.canSelfServe ||
      !selfServeOwnerId ||
      !draftSql.trim()
    ) {
      setCanPublishNow(false);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      describeDataset(draftSql, selfServeOwnerId)
        .then((res) => {
          if (active) setCanPublishNow(Boolean(res.canShare));
        })
        .catch(() => {
          if (active) setCanPublishNow(false);
        });
    }, 900);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [request, selfServeOwnerId, draftSql]);

  const preset: ShareDatasetPreset | undefined = React.useMemo(() => {
    if (!request || !publishMode) return undefined;
    if (publishMode === "self_serve") {
      return {
        owningGroupId: selfServeOwnerId ?? request.audienceGroup.id,
        audienceGroupIds: [request.audienceGroup.id],
        lockOwner: false,
        name: request.title,
        description: request.description ?? undefined,
      };
    }
    return {
      owningGroupId: request.routeGroup.id,
      audienceGroupIds: [request.audienceGroup.id],
      lockOwner: true,
      name: request.title,
      description: request.description ?? undefined,
    };
  }, [request, publishMode, selfServeOwnerId]);

  const hydrate = useRequest((s) => s.hydrate);
  const triggerDeliverPulse = useRequest((s) => s.triggerDeliverPulse);

  const tablesById = React.useMemo(
    () => new Map(spec.tables.map((tbl) => [tbl.id, tbl])),
    [spec.tables],
  );

  const threadsById = React.useMemo(() => {
    const map = new Map<
      string,
      NonNullable<typeof request>["threads"][number]
    >();
    for (const th of request?.threads ?? []) map.set(th.id, th);
    return map;
  }, [request?.threads]);

  const canComment = Boolean(
    request &&
      (request.permissions.isRequester ||
        request.permissions.isTeam ||
        request.permissions.isManager),
  );
  const canEdit = Boolean(request?.permissions.canEditSpec);

  const pinNodes: RequestCommentPinNode[] = React.useMemo(
    () =>
      spec.pins.map((pin) => {
        const anchoredTable = pin.anchor?.tableId
          ? tablesById.get(pin.anchor.tableId)
          : undefined;
        const anchorLabel = anchoredTable
          ? pin.anchor?.column
            ? `${anchoredTable.alias}.${pin.anchor.column}`
            : anchoredTable.sqlName.split(".").pop() ?? anchoredTable.alias
          : null;
        return {
          id: `pin:${pin.threadId}`,
          type: "request-comment",
          position: { x: pin.x, y: pin.y },
          draggable: false,
          data: {
            pin,
            thread: threadsById.get(pin.threadId) ?? null,
            anchorLabel,
            canComment,
          },
        };
      }),
    [spec.pins, tablesById, threadsById, canComment],
  );

  const handleAnchorComment = React.useCallback(
    (
      anchor: { tableId: string; column?: string },
      screen: { x: number; y: number },
    ) => {
      if (!canComment) return;
      const tbl = tablesById.get(anchor.tableId);
      const anchorLabel = tbl
        ? anchor.column
          ? `${tbl.alias}.${anchor.column}`
          : tbl.sqlName.split(".").pop() ?? tbl.alias
        : null;
      setComposer({
        x: snapToGrid(tbl ? tbl.x + 276 : 120),
        y: snapToGrid(tbl ? tbl.y : 120),
        screen,
        anchor,
        anchorLabel,
      });
    },
    [canComment, tablesById],
  );

  const submitComment = async (body: string) => {
    if (!composer || postingComment) return;
    setPostingComment(true);
    try {
      await store.getState().flushSave();
      const created = await api.dataRequests.dataRequestsControllerAddComment({
        id: caseId,
        addDataRequestCommentDto: {
          body,
          anchor: composer.anchor
            ? {
                tableId: composer.anchor.tableId,
                ...(composer.anchor.column
                  ? { column: composer.anchor.column }
                  : {}),
              }
            : null,
          x: composer.x,
          y: composer.y,
        },
      });
      store.getState().appendPin(
        {
          threadId: created.pin.threadId,
          anchor: created.pin.anchor
            ? {
                tableId: created.pin.anchor.tableId,
                ...(created.pin.anchor.column
                  ? { column: created.pin.anchor.column }
                  : {}),
              }
            : null,
          x: created.pin.x,
          y: created.pin.y,
        },
        created.specVersion,
      );
      await store.getState().reloadFromServer();
      setComposer(null);
      store.getState().setCommentToolActive(false);
    } catch (err) {
      toast.error(await apiErrorMessage(err));
    } finally {
      setPostingComment(false);
    }
  };

  const adapter: VisualSchemaAdapter = React.useMemo(
    () => ({
      mode: "data-request",
      capabilities: {
        canEdit,
        showColumnSelection: true,
        showFilters: true,
        showComments: canComment,
        maxTables: DATA_REQUEST_MAX_TABLES,
        hideSharedDatasets: true,
        allowLockedTables: false,
      },
      spec,
      catalog,
      catalogLoading,
      diagnostics,
      saving,
      dirty,
      canUndo: undoCount > 0,
      canRedo: redoCount > 0,
      addTables: (tables, positions) =>
        store.getState().addTables(tables, positions),
      removeTables: (ids) => store.getState().removeTables(ids),
      moveTables: (updates) => store.getState().moveTables(updates),
      resizeTable: (id, h) => store.getState().resizeTable(id, h),
      setTableColor: (ids, color) => store.getState().setTableColor(ids, color),
      toggleTableCollapsed: (id) => store.getState().toggleTableCollapsed(id),
      setTablesHidden: (ids, hidden) =>
        store.getState().setTablesHidden(ids, hidden),
      renameAlias: (id, alias) => store.getState().renameTableAlias(id, alias),
      toggleColumn: (id, col) => store.getState().toggleColumn(id, col),
      setTableColumns: (id, cols) => store.getState().setTableColumns(id, cols),
      addFilter: (id, filter) => store.getState().addFilter(id, filter),
      removeFilter: (id, idx) => store.getState().removeFilter(id, idx),
      addJoin: (l, r, opts) => store.getState().addJoin(l, r, opts),
      addJoins: (batch) => store.getState().addJoins(batch),
      updateJoin: (id, patch) => store.getState().updateJoin(id, patch),
      removeJoin: (id) => store.getState().removeJoin(id),
      removeTableJoins: (ids) => store.getState().removeTableJoins(ids),
      applyLayout: (pos) => store.getState().moveTables(pos),
      clearCanvas: () => store.getState().clearCanvas(),
      importSpec: (next) => store.getState().importSpec(next),
      undo: () => store.getState().undo(),
      redo: () => store.getState().redo(),
    }),
    [
      canEdit,
      canComment,
      spec,
      catalog,
      catalogLoading,
      diagnostics,
      saving,
      dirty,
      undoCount,
      redoCount,
      store,
    ],
  );

  if (!request) return null;

  const handleShared = async (saved: SharedDatasetDto) => {
    setPublishMode(null);
    try {
      const updated = await api.dataRequests.dataRequestsControllerDeliver({
        id: request.id,
        deliverDataRequestDto: {
          datasetAssetId: saved.assetId,
        },
      });
      hydrate(updated);
      triggerDeliverPulse();
      toast.success(t("dataRequest.toast.delivered"));
    } catch (err) {
      toast.error(await apiErrorMessage(err));
    }
  };

  const topLeftSlot = (
    <div className="flex items-center gap-1 rounded-[6px] border-2 border-border bg-card p-1">
      {canEdit && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            disabled={undoCount === 0}
            onClick={() => store.getState().undo()}
            title={t("dataRequest.canvas.undo")}
            data-testid="request-undo"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            disabled={redoCount === 0}
            onClick={() => store.getState().redo()}
            title={t("dataRequest.canvas.redo")}
            data-testid="request-redo"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
      {canComment && (
        <Button
          type="button"
          variant={commentToolActive ? "default" : "ghost"}
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() =>
            store.getState().setCommentToolActive(!commentToolActive)
          }
          data-testid="request-comment-tool"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">
            {t("dataRequest.canvas.pinComment")}
          </span>
        </Button>
      )}
      <span
        className="px-2 font-mono text-[10px] text-muted-foreground"
        data-testid="request-save-status"
      >
        {saving
          ? t("dataRequest.canvas.saving")
          : dirty
            ? t("dataRequest.canvas.unsaved")
            : t("dataRequest.canvas.saved")}
      </span>
    </div>
  );

  return (
    <div
      className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden bg-background"
      style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 3.5rem)" }}
      data-testid="data-request-workspace"
    >
      <RequestTopBar
        request={request}
        canPublishNow={canPublishNow}
        onOpenPublish={(mode) => setPublishMode(mode)}
        onUpdated={(detail: DataRequestDetailDto) => hydrate(detail)}
      />

      {request.declineReason && request.state === "DECLINED" && (
        <div
          className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive"
          data-testid="request-decline-banner"
        >
          <strong>{t("dataRequest.topBar.declinedReason")}:</strong>{" "}
          {request.declineReason}
        </div>
      )}

      <div className="min-h-0 flex-1" style={{ minHeight: 0, flex: "1 1 0%" }}>
        <VisualSchemaWorkspace
          adapter={adapter}
          extensions={{
            extraNodes: pinNodes,
            extraNodeTypes: EXTRA_NODE_TYPES,
            topLeftSlot,
            paneClassName: commentToolActive ? "cursor-crosshair" : undefined,
            onPinComment: handleAnchorComment,
            onPaneClick: (event, flowPos) => {
              if (!commentToolActive || !canComment) return;
              setComposer({
                x: snapToGrid(flowPos.x),
                y: snapToGrid(flowPos.y),
                screen: { x: event.clientX, y: event.clientY },
                anchor: null,
                anchorLabel: null,
              });
            },
          }}
          customRightPanel={({ propertiesPanel, relationsPanel }) => (
            <RequestSqlPanel
              request={request}
              catalog={catalog}
              propertiesPanel={propertiesPanel}
              relationsPanel={relationsPanel}
            />
          )}
        />
      </div>

      {/* Reuses case-board CommentComposerPopover with brutalist tokens */}
      <CommentComposerPopover
        open={Boolean(composer)}
        screen={composer?.screen ?? null}
        placeholder={t("dataRequest.canvas.commentPlaceholder")}
        submitLabel={t("dataRequest.canvas.postComment")}
        cancelLabel={t("common.cancel")}
        busy={postingComment}
        testId="request-comment-composer"
        header={
          composer?.anchorLabel ? (
            <div className="flex items-center gap-1.5 font-mono text-[10px] text-foreground">
              <span className="rounded-xs border border-border bg-muted px-1.5 py-0.5">
                {composer.anchorLabel}
              </span>
            </div>
          ) : undefined
        }
        onClose={() => setComposer(null)}
        onSubmit={submitComment}
      />

      <ShareDatasetSheet
        open={Boolean(publishMode)}
        sql={draftSql}
        dataset={publishMode === "team" ? existingDataset.data : null}
        preset={preset}
        onClose={() => setPublishMode(null)}
        onShared={handleShared}
      />
    </div>
  );
}
