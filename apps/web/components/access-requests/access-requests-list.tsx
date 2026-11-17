"use client";

import * as React from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@workspace/api-client";
import type { AccessRequestDto } from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Textarea } from "@workspace/ui/components/textarea";
import { useNamespace } from "@/components/namespace-provider";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { DATA_READER, DATA_READER_UNMASKED } from "@/lib/column-access";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

export type RequestsFilter =
  | { view: "decide" }
  | { scopeType: "asset" | "source"; scopeId: string };

const STATUS_TONE: Record<string, "default" | "secondary" | "outline"> = {
  PENDING: "default",
  APPROVED: "secondary",
  DENIED: "outline",
  WITHDRAWN: "outline",
};

/**
 * Access requests for whoever decides them (DQ §5.9): on a table's or
 * source's Governance tab, every request on it; in Settings → Access, the
 * ones waiting across the workspace. Approve gives the requester's group an
 * expiring Data reader grant; Decline says why.
 */
export function AccessRequestsList({
  filter,
  showTarget = false,
  emptyText,
  onDecided,
}: {
  filter: RequestsFilter;
  /** Name the table or source on each row (a workspace-wide list). */
  showTarget?: boolean;
  emptyText?: string;
  /** After a request was approved or declined here. */
  onDecided?: () => void;
}) {
  const { t } = useTranslation();
  const [requests, setRequests] = React.useState<AccessRequestDto[] | null>(
    null,
  );
  const [deciding, setDeciding] = React.useState<{
    request: AccessRequestDto;
    approve: boolean;
  } | null>(null);
  const key = JSON.stringify(filter);

  const load = React.useCallback(async () => {
    const current = JSON.parse(key) as RequestsFilter;
    try {
      setRequests(
        await api.accessRequests.accessRequestsControllerList(
          "view" in current
            ? { view: current.view }
            : { scopeType: current.scopeType, scopeId: current.scopeId },
        ),
      );
    } catch {
      setRequests([]);
    }
  }, [key]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (requests === null) return null;
  if (!requests.length) {
    return (
      <p
        className="rounded-[4px] border border-dashed p-4 text-sm text-muted-foreground"
        data-testid="access-requests-none"
      >
        {emptyText ?? t("accessRequests.none")}
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="access-requests">
      {requests.map((request) => (
        <RequestRow
          key={request.id}
          request={request}
          showTarget={showTarget}
          onApprove={() => setDeciding({ request, approve: true })}
          onDeny={() => setDeciding({ request, approve: false })}
        />
      ))}
      {deciding && (
        <DecideDialog
          request={deciding.request}
          approve={deciding.approve}
          onClose={() => setDeciding(null)}
          onDone={async () => {
            setDeciding(null);
            await load();
            onDecided?.();
          }}
        />
      )}
    </div>
  );
}

function RequestRow({
  request,
  showTarget,
  onApprove,
  onDeny,
}: {
  request: AccessRequestDto;
  showTarget: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const { t } = useTranslation();
  const { nsHref } = useNamespace();
  const date = (value: Date | string | null | undefined) =>
    value ? new Date(value).toLocaleDateString() : "";
  const role = t(`accessRequests.roles.${request.roleKey}` as TranslationKey);
  return (
    <div
      className="rounded-[4px] border border-border p-3 text-sm"
      data-testid="access-request-row"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_TONE[request.status] ?? "outline"}>
          {t(`accessRequests.status.${request.status}` as TranslationKey)}
        </Badge>
        <span className="font-medium">
          {t("accessRequests.asks", {
            who: request.requesterName,
            group: request.groupPath ?? request.groupName,
          })}
        </span>
        {showTarget && (
          <Link
            href={nsHref(
              `/${request.scopeType === "asset" ? "assets" : "sources"}/${request.scopeId}?tab=governance`,
            )}
            className="font-mono text-xs underline-offset-2 hover:underline"
          >
            {request.sqlName ?? request.targetName}
          </Link>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {date(request.createdAt)}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("accessRequests.forDays", { role, days: request.durationDays })}
      </p>
      <p className="mt-2 whitespace-pre-wrap">{request.reason}</p>
      {request.status !== "PENDING" && request.decidedByName && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("accessRequests.decidedBy", {
            who: request.decidedByName,
            date: date(request.decidedAt),
          })}
          {request.grantExpiresAt &&
            ` · ${t("accessRequests.until", { date: date(request.grantExpiresAt) })}`}
          {request.decisionNote && ` · ${request.decisionNote}`}
        </p>
      )}
      {request.canDecide && (
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            onClick={onApprove}
            data-testid="access-request-approve"
          >
            <Check className="mr-1.5 h-3.5 w-3.5" />
            {t("accessRequests.approve")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onDeny}
            data-testid="access-request-deny"
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            {t("accessRequests.deny")}
          </Button>
        </div>
      )}
    </div>
  );
}

function DecideDialog({
  request,
  approve,
  onClose,
  onDone,
}: {
  request: AccessRequestDto;
  approve: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [days, setDays] = React.useState(String(request.durationDays));
  const [masked, setMasked] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const roleKey =
    masked && request.roleKey === DATA_READER_UNMASKED
      ? DATA_READER
      : request.roleKey;
  const until = new Date(Date.now() + Number(days || 0) * 86_400_000);
  const group = request.groupPath ?? request.groupName;

  const decide = async () => {
    setBusy(true);
    try {
      if (approve) {
        await api.accessRequests.accessRequestsControllerApprove({
          id: request.id,
          approveAccessRequestDto: {
            durationDays: Number(days),
            ...(roleKey !== request.roleKey
              ? { roleKey: "data-reader" as const }
              : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        });
        toast.success(
          t("accessRequests.approved", { date: until.toLocaleDateString() }),
        );
      } else {
        await api.accessRequests.accessRequestsControllerDeny({
          id: request.id,
          denyAccessRequestDto: note.trim() ? { note: note.trim() } : {},
        });
        toast.success(t("accessRequests.denied"));
      }
      await onDone();
    } catch (error) {
      toast.error(
        await extractApiErrorMessage(error, t("accessRequests.decideFailed")),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="access-request-decide">
        <DialogHeader>
          <DialogTitle>
            {approve
              ? t("accessRequests.approveTitle", { group })
              : t("accessRequests.denyTitle")}
          </DialogTitle>
          {approve && (
            <DialogDescription>
              {t("accessRequests.approveLead", {
                group,
                role: t(`accessRequests.roles.${roleKey}` as TranslationKey),
                name: request.sqlName ?? request.targetName,
                date: until.toLocaleDateString(),
              })}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-4">
          {approve && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="decide-days">{t("accessRequests.days")}</Label>
                <Input
                  id="decide-days"
                  type="number"
                  min={1}
                  max={365}
                  value={days}
                  onChange={(event) => setDays(event.target.value)}
                  className="w-32"
                />
              </div>
              {request.roleKey === DATA_READER_UNMASKED && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={masked}
                    onCheckedChange={(value) => setMasked(value === true)}
                  />
                  {t("accessRequests.giveMasked")}
                </label>
              )}
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="decide-note">
              {approve
                ? t("accessRequests.note")
                : t("accessRequests.denyNote")}
            </Label>
            <Textarea
              id="decide-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={2000}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => void decide()}
            disabled={
              busy || (approve && !(Number(days) >= 1 && Number(days) <= 365))
            }
            variant={approve ? "default" : "destructive"}
            data-testid="access-request-confirm"
          >
            {approve ? t("accessRequests.approve") : t("accessRequests.deny")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
