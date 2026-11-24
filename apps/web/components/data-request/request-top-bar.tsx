"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Check,
  CheckCircle2,
  GitFork,
  Hand,
  Link2,
  Loader2,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  TableProperties,
  Undo2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import type {
  DataRequestDetailDto,
  DataRequestOptionsDto,
} from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Label } from "@workspace/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { SeverityBadge } from "@workspace/ui/components/severity-badge";
import { Textarea } from "@workspace/ui/components/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { useNsPath } from "@/lib/ns-path";
import { apiErrorMessage } from "@/lib/data-query";
import { useSharedDatasets } from "@/lib/shared-datasets";
import {
  claimDataRequest,
  declineDataRequest,
  deliverDataRequest,
  fetchDataRequestOptions,
  requestDataRequestChanges,
  rerouteDataRequest,
  submitDataRequest,
  withdrawDataRequest,
} from "@/lib/data-requests";
import { useRequest, useRequestStore } from "./store/request-context";

const STEP_STATES = ["DRAFT", "SUBMITTED", "IN_PROGRESS", "DELIVERED"] as const;

function stepIndexOf(state: string): number {
  switch (state) {
    case "DRAFT":
      return 0;
    case "SUBMITTED":
      return 1;
    case "IN_PROGRESS":
    case "CHANGES_REQUESTED":
      return 2;
    case "DELIVERED":
      return 3;
    default:
      return -1;
  }
}

export interface RequestTopBarProps {
  request: DataRequestDetailDto;
  canPublishNow: boolean;
  onOpenPublish: (mode: "team" | "self_serve") => void;
  onUpdated: (detail: DataRequestDetailDto) => void;
}

export function RequestTopBar({
  request,
  canPublishNow,
  onOpenPublish,
  onUpdated,
}: RequestTopBarProps) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const store = useRequestStore();
  const presence = useRequest((s) => s.presence);
  const deliverPulse = useRequest((s) => s.deliverPulse);

  const [busy, setBusy] = React.useState<string | null>(null);
  const [rerouteOpen, setRerouteOpen] = React.useState(false);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [declineOpen, setDeclineOpen] = React.useState(false);
  const [changesOpen, setChangesOpen] = React.useState(false);

  const [options, setOptions] = React.useState<DataRequestOptionsDto | null>(
    null,
  );
  const [rerouteGroupId, setRerouteGroupId] = React.useState("");
  const [linkDatasetId, setLinkDatasetId] = React.useState("");
  const [linkNote, setLinkNote] = React.useState("");
  const [reason, setReason] = React.useState("");

  const datasets = useSharedDatasets();

  React.useEffect(() => {
    if (!rerouteOpen) return;
    fetchDataRequestOptions()
      .then((res) => {
        setOptions(res);
        const alt = res.routeGroups.find(
          (g) => g.id !== request.routeGroup.id,
        );
        setRerouteGroupId(alt?.id ?? res.routeGroups[0]?.id ?? "");
      })
      .catch(() => undefined);
  }, [rerouteOpen, request.routeGroup.id]);

  const actions = new Set(request.permissions.allowedActions);
  const activeStep = stepIndexOf(request.state);
  const isChangesRequested = request.state === "CHANGES_REQUESTED";
  const isClosedTerminal =
    request.state === "DECLINED" || request.state === "WITHDRAWN";

  const runAction = async (
    key: string,
    fn: () => Promise<DataRequestDetailDto>,
    successMsg: string,
    pulseDeliver = false,
  ) => {
    setBusy(key);
    try {
      await store.getState().flushSave();
      const updated = await fn();
      onUpdated(updated);
      if (pulseDeliver) store.getState().triggerDeliverPulse();
      toast.success(successMsg);
    } catch (err) {
      toast.error(await apiErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <header
      className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2"
      data-testid="request-top-bar"
    >
      {/* Back + Kind chip + Title */}
      <Button variant="ghost" size="sm" className="h-7 px-2" asChild>
        <Link href={nsPath("/cases")} aria-label={t("common.back")}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
      </Button>

      <Badge
        variant="outline"
        className="gap-1 border-sky-500/40 bg-sky-500/10 font-mono text-[10px] uppercase tracking-wider text-sky-700 dark:text-sky-300"
      >
        <TableProperties className="h-3 w-3" />
        {t("dataRequest.kindLabel")}
      </Badge>

      <h1 className="max-w-[260px] truncate text-sm font-semibold sm:max-w-xs">
        {request.title}
      </h1>

      {request.priority !== "INFO" && (
        <SeverityBadge
          severity={
            request.priority.toLowerCase() as
              | "critical"
              | "high"
              | "medium"
              | "low"
          }
        />
      )}

      {/* Route & audience chips */}
      <div className="hidden items-center gap-1.5 text-xs text-muted-foreground lg:flex">
        <ArrowRight className="h-3 w-3" />
        <Badge
          variant="secondary"
          className="gap-1 font-normal"
          data-testid="request-route-group"
        >
          <Users className="h-3 w-3" />
          {request.routeGroup.name}
        </Badge>
        <span className="text-[11px] text-muted-foreground">
          {t("dataRequest.topBar.forAudience", {
            group: request.audienceGroup.name,
          })}
        </span>
      </div>

      {/* Status stepper */}
      <div
        className="mx-auto flex items-center gap-1 rounded-xs border bg-muted/30 px-2 py-1"
        data-testid="request-stepper"
        data-state={request.state}
      >
        {isClosedTerminal ? (
          <Badge variant="destructive" className="text-[10px]">
            {t(`cases.requestStates.${request.state}`)}
          </Badge>
        ) : (
          STEP_STATES.map((step, idx) => {
            const done = activeStep > idx;
            const current = activeStep === idx;
            const isDeliverStep = step === "DELIVERED";
            return (
              <React.Fragment key={step}>
                {idx > 0 && (
                  <span
                    className={cn(
                      "h-px w-3 transition-colors duration-500",
                      done || current ? "bg-sky-500" : "bg-border",
                    )}
                  />
                )}
                <span
                  key={isDeliverStep ? `${step}-${deliverPulse}` : step}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 font-mono text-[10px] transition-all duration-300",
                    current &&
                      "bg-sky-500/15 font-semibold text-sky-700 dark:text-sky-300",
                    done && "text-foreground/80",
                    !done && !current && "text-muted-foreground",
                    isDeliverStep &&
                      current &&
                      deliverPulse > 0 &&
                      "scale-105 ring-2 ring-emerald-500/60 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                  )}
                >
                  {done || (isDeliverStep && current) ? (
                    <Check className="h-3 w-3 text-emerald-600" />
                  ) : isChangesRequested && idx === 2 ? (
                    <RefreshCw className="h-3 w-3 text-amber-500" />
                  ) : null}
                  {isChangesRequested && idx === 2
                    ? t("cases.requestStates.CHANGES_REQUESTED")
                    : t(`cases.requestStates.${step}`)}
                  {isDeliverStep && request.deliveredVersion && (
                    <span className="font-semibold">
                      v{request.deliveredVersion}
                    </span>
                  )}
                </span>
              </React.Fragment>
            );
          })
        )}
      </div>

      {/* Presence avatars */}
      {presence.length > 0 && (
        <div className="flex items-center" data-testid="request-presence">
          {presence.slice(0, 3).map((person, i) => (
            <Tooltip key={`${person}-${i}`}>
              <TooltipTrigger asChild>
                <span className="-mr-1.5 flex size-6 items-center justify-center rounded-full border-2 border-background bg-muted font-mono text-[10px] font-bold">
                  {person.slice(0, 2).toUpperCase()}
                </span>
              </TooltipTrigger>
              <TooltipContent>{person}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}

      {/* Role-aware actions */}
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {/* Self-serve Publish now */}
        {canPublishNow &&
          actions.has("deliver_self_serve") &&
          !request.permissions.isTeam && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 gap-1 text-xs"
              disabled={Boolean(busy)}
              onClick={() => onOpenPublish("self_serve")}
              data-testid="request-publish-now-btn"
            >
              <Sparkles className="h-3.5 w-3.5 text-sky-600" />
              {t("dataRequest.actions.publishNow")}
            </Button>
          )}

        {/* Requester Submit */}
        {actions.has("submit") && (
          <Button
            type="button"
            size="sm"
            className="h-7 gap-1 text-xs"
            disabled={Boolean(busy)}
            onClick={() =>
              void runAction(
                "submit",
                () => submitDataRequest(request.id),
                t("dataRequest.toast.submitted"),
              )
            }
            data-testid="request-submit-btn"
          >
            {busy === "submit" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {t("dataRequest.actions.submit")}
          </Button>
        )}

        {/* Team Claim */}
        {actions.has("claim") && request.state !== "IN_PROGRESS" && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 gap-1 text-xs"
            disabled={Boolean(busy)}
            onClick={() =>
              void runAction(
                "claim",
                () => claimDataRequest(request.id),
                t("dataRequest.toast.claimed"),
              )
            }
            data-testid="request-claim-btn"
          >
            {busy === "claim" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Hand className="h-3.5 w-3.5" />
            )}
            {t("dataRequest.actions.claim")}
          </Button>
        )}

        {/* Team Publish dataset (creates or updates shared dataset then calls deliver) */}
        {actions.has("deliver") && (
          <>
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={Boolean(busy)}
              onClick={() => onOpenPublish("team")}
              data-testid="request-publish-btn"
            >
              <Share2 className="h-3.5 w-3.5" />
              {request.dataset?.assetId
                ? t("dataRequest.actions.publishNewVersion")
                : t("dataRequest.actions.publishDataset")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs"
              disabled={Boolean(busy)}
              onClick={() => {
                setLinkDatasetId(datasets.data?.[0]?.assetId ?? "");
                setLinkNote("");
                setLinkOpen(true);
              }}
              data-testid="request-link-btn"
            >
              <Link2 className="h-3.5 w-3.5" />
              {t("dataRequest.actions.linkExisting")}
            </Button>
          </>
        )}

        {/* Team Reroute */}
        {actions.has("reroute") && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            disabled={Boolean(busy)}
            onClick={() => setRerouteOpen(true)}
            data-testid="request-reroute-btn"
          >
            <GitFork className="h-3.5 w-3.5" />
            {t("dataRequest.actions.reroute")}
          </Button>
        )}

        {/* Team Decline */}
        {actions.has("decline") && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
            disabled={Boolean(busy)}
            onClick={() => {
              setReason("");
              setDeclineOpen(true);
            }}
            data-testid="request-decline-btn"
          >
            <Ban className="h-3.5 w-3.5" />
            {t("dataRequest.actions.decline")}
          </Button>
        )}

        {/* Requester Request changes */}
        {actions.has("request_changes") && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            disabled={Boolean(busy)}
            onClick={() => {
              setReason("");
              setChangesOpen(true);
            }}
            data-testid="request-changes-btn"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("dataRequest.actions.requestChanges")}
          </Button>
        )}

        {/* Requester Withdraw */}
        {actions.has("withdraw") && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-xs text-muted-foreground"
            disabled={Boolean(busy)}
            onClick={() =>
              void runAction(
                "withdraw",
                () => withdrawDataRequest(request.id),
                t("dataRequest.toast.withdrawn"),
              )
            }
            data-testid="request-withdraw-btn"
          >
            <Undo2 className="h-3.5 w-3.5" />
            {t("dataRequest.actions.withdraw")}
          </Button>
        )}

        {/* Delivered dataset quick link */}
        {request.state === "DELIVERED" && request.dataset?.assetId && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 gap-1 text-xs"
            asChild
            data-testid="request-open-dataset-btn"
          >
            <Link href={nsPath(`/assets/${request.dataset.assetId}?tab=data`)}>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              {request.dataset.sqlName}
            </Link>
          </Button>
        )}
      </div>

      {/* Reroute dialog */}
      <Dialog open={rerouteOpen} onOpenChange={setRerouteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dataRequest.dialogs.rerouteTitle")}</DialogTitle>
            <DialogDescription>
              {t("dataRequest.dialogs.rerouteBody")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>{t("dataRequest.form.routeGroupLabel")}</Label>
            <Select value={rerouteGroupId} onValueChange={setRerouteGroupId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(options?.routeGroups ?? []).map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRerouteOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!rerouteGroupId || Boolean(busy)}
              onClick={() => {
                setRerouteOpen(false);
                void runAction(
                  "reroute",
                  () => rerouteDataRequest(request.id, rerouteGroupId),
                  t("dataRequest.toast.rerouted"),
                );
              }}
            >
              {t("dataRequest.actions.reroute")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link existing shared dataset dialog */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dataRequest.dialogs.linkTitle")}</DialogTitle>
            <DialogDescription>
              {t("dataRequest.dialogs.linkBody", {
                group: request.audienceGroup.name,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>{t("dataRequest.dialogs.datasetLabel")}</Label>
              <Select value={linkDatasetId} onValueChange={setLinkDatasetId}>
                <SelectTrigger data-testid="link-dataset-select">
                  <SelectValue
                    placeholder={t("dataRequest.dialogs.datasetPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(datasets.data ?? []).map((ds) => (
                    <SelectItem key={ds.assetId} value={ds.assetId}>
                      {ds.sqlName} (v{ds.version})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("dataRequest.dialogs.noteLabel")}</Label>
              <Textarea
                value={linkNote}
                onChange={(e) => setLinkNote(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!linkDatasetId || Boolean(busy)}
              onClick={() => {
                setLinkOpen(false);
                void runAction(
                  "deliver",
                  () =>
                    deliverDataRequest(request.id, {
                      datasetAssetId: linkDatasetId,
                      note: linkNote.trim() || undefined,
                      mode: "LINKED",
                    }),
                  t("dataRequest.toast.delivered"),
                  true,
                );
              }}
            >
              {t("dataRequest.actions.deliver")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decline dialog */}
      <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dataRequest.dialogs.declineTitle")}</DialogTitle>
            <DialogDescription>
              {t("dataRequest.dialogs.declineBody")}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("dataRequest.dialogs.reasonPlaceholder")}
            rows={3}
            data-testid="decline-reason-input"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclineOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={!reason.trim() || Boolean(busy)}
              onClick={() => {
                setDeclineOpen(false);
                void runAction(
                  "decline",
                  () => declineDataRequest(request.id, reason.trim()),
                  t("dataRequest.toast.declined"),
                );
              }}
              data-testid="decline-confirm-btn"
            >
              {t("dataRequest.actions.decline")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request changes dialog */}
      <Dialog open={changesOpen} onOpenChange={setChangesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dataRequest.dialogs.changesTitle")}</DialogTitle>
            <DialogDescription>
              {t("dataRequest.dialogs.changesBody")}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("dataRequest.dialogs.changesPlaceholder")}
            rows={3}
            data-testid="changes-reason-input"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangesOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!reason.trim() || Boolean(busy)}
              onClick={() => {
                setChangesOpen(false);
                void runAction(
                  "changes",
                  () => requestDataRequestChanges(request.id, reason.trim()),
                  t("dataRequest.toast.changesRequested"),
                );
              }}
              data-testid="changes-confirm-btn"
            >
              {t("dataRequest.actions.requestChanges")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
