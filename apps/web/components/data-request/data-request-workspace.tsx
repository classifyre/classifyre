"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { DataRequestDetailDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable";
import { useTranslation } from "@/hooks/use-translation";
import { apiErrorMessage, fetchCatalog, type QueryCatalog } from "@/lib/data-query";
import {
  describeDataset,
  useSharedDataset,
  type SharedDatasetDto,
} from "@/lib/shared-datasets";
import {
  checkDataRequest,
  deliverDataRequest,
  describeDataRequest,
  getDataRequest,
  updateDataRequestSpec,
  updateDataRequestSql,
  useDataRequestSocket,
} from "@/lib/data-requests";
import {
  ShareDatasetSheet,
  type ShareDatasetPreset,
} from "@/components/shared-datasets/share-dataset-sheet";
import {
  createRequestStore,
  type RequestStoreApi,
} from "./store/request-store";
import { RequestStoreProvider, useRequest } from "./store/request-context";
import { RequestTopBar } from "./request-top-bar";
import { RequestCatalogRail } from "./request-catalog-rail";
import { RequestCanvas } from "./request-canvas";
import { RequestSqlPanel } from "./request-sql-panel";

export interface DataRequestWorkspaceProps {
  caseId: string;
}

export function DataRequestWorkspace({ caseId }: DataRequestWorkspaceProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [catalog, setCatalog] = React.useState<QueryCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = React.useState(true);

  const storeRef = React.useRef<RequestStoreApi | null>(null);
  if (!storeRef.current || storeRef.current.getState().caseId !== caseId) {
    storeRef.current?.getState().dispose();
    storeRef.current = createRequestStore(caseId, {
      saveSpec: (id, payload) =>
        updateDataRequestSpec(id, {
          spec: payload.spec as unknown as Record<string, unknown>,
          baseVersion: payload.baseVersion,
          clientId: payload.clientId,
        }),
      saveSql: (id, payload) => updateDataRequestSql(id, payload),
      check: (id) => checkDataRequest(id),
      describe: (id) => describeDataRequest(id),
      reload: (id) => getDataRequest(id),
      onConflict: () => {
        toast.warning(t("dataRequest.toast.conflictReloaded"));
      },
      onError: async (err) => {
        toast.error(await apiErrorMessage(err));
      },
    });
  }
  const store = storeRef.current;

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
        getDataRequest(caseId),
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

  useDataRequestSocket(
    caseId,
    store.getState().clientId,
    (event) => {
      void store.getState().reloadFromServer();
      toast(
        t("caseBoard.changedBy", {
          name: event.actor || t("caseBoard.someone"),
          summary: event.summary,
        }),
        { id: `dr-changed-${caseId}`, duration: 3000 },
      );
    },
    (others) => {
      store.getState().setPresence(others);
    },
  );

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
  const request = useRequest((s) => s.request);
  const spec = useRequest((s) => s.spec);
  const draftSql = useRequest((s) => s.draftSql);
  const storeRef = React.useRef<RequestStoreApi | null>(null);
  const [publishMode, setPublishMode] = React.useState<
    "team" | "self_serve" | null
  >(null);
  const [canPublishNow, setCanPublishNow] = React.useState(false);

  // Pull live SharedDatasetDto when publishing a new version after changes requested
  const existingDataset = useSharedDataset(
    publishMode === "team" ? request?.dataset?.assetId : null,
  );

  // Check self-serve eligibility when requester has canSelfServe and valid SQL
  React.useEffect(() => {
    if (
      !request ||
      !request.permissions.isRequester ||
      request.permissions.isTeam ||
      !request.permissions.canSelfServe ||
      !draftSql.trim()
    ) {
      setCanPublishNow(false);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      describeDataset(draftSql, request.audienceGroup.id)
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
  }, [request, draftSql]);

  const placedAssetIds = React.useMemo(
    () => new Set(spec.tables.map((tbl) => tbl.assetId)),
    [spec.tables],
  );

  const preset: ShareDatasetPreset | undefined = React.useMemo(() => {
    if (!request || !publishMode) return undefined;
    if (publishMode === "self_serve") {
      return {
        owningGroupId: request.audienceGroup.id,
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
  }, [request, publishMode]);

  const hydrate = useRequest((s) => s.hydrate);
  const addTable = useRequest((s) => s.addTable);
  const triggerDeliverPulse = useRequest((s) => s.triggerDeliverPulse);

  if (!request) return null;

  const canComment =
    request.permissions.isRequester ||
    request.permissions.isTeam ||
    request.permissions.isManager;

  const handleShared = async (saved: SharedDatasetDto) => {
    const mode = publishMode;
    setPublishMode(null);
    try {
      const updated = await deliverDataRequest(request.id, {
        datasetAssetId: saved.assetId,
        mode:
          mode === "self_serve"
            ? "SELF_SERVE"
            : existingDataset.data
              ? "UPDATED"
              : "PUBLISHED",
      });
      hydrate(updated);
      triggerDeliverPulse();
      toast.success(t("dataRequest.toast.delivered"));
    } catch (err) {
      toast.error(await apiErrorMessage(err));
    }
  };

  void storeRef;

  return (
    <div
      className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden bg-background"
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

      <div className="min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
          <ResizablePanel id="rail" defaultSize="20%" minSize="15%" maxSize="32%">
            <RequestCatalogRail
              catalog={catalog}
              loading={catalogLoading}
              canEdit={request.permissions.canEditSpec}
              placedAssetIds={placedAssetIds}
              onAddTable={(tbl) => {
                addTable(tbl);
              }}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel id="canvas" defaultSize="48%" minSize="30%">
            <RequestCanvas
              catalog={catalog}
              canEdit={request.permissions.canEditSpec}
              canComment={canComment}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel id="spec-sheet" defaultSize="32%" minSize="22%" maxSize="48%">
            <RequestSqlPanel request={request} catalog={catalog} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

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
