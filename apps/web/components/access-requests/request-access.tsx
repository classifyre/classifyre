"use client";

import * as React from "react";
import { Hourglass, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { api } from "@workspace/api-client";
import type { AccessRequestOptionsDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Textarea } from "@workspace/ui/components/textarea";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { DATA_READER, DATA_READER_UNMASKED } from "@/lib/column-access";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

export interface RequestTarget {
  scopeType: "asset" | "source";
  scopeId: string;
}

/** Who decides, as one phrase: the owner by name, the stewards, or the admins. */
export function decidersPhrase(
  deciders: AccessRequestOptionsDto["deciders"],
  t: (key: TranslationKey, values?: Record<string, string | number>) => string,
): string {
  if (!deciders.length) return t("accessRequests.admins");
  return deciders.map((decider) => decider.displayName).join(", ");
}

/**
 * Asking for data access (DQ §5.9) where it is missing: on a locked Data tab,
 * or to read masked columns in clear. Shows the caller's request still
 * waiting (with Withdraw), or a button that opens the request form.
 */
export function RequestAccess({
  target,
  unmasked = false,
  compact = false,
  onChanged,
}: {
  target: RequestTarget;
  /** Ask for the unmasked role: the caller already queries it, masked. */
  unmasked?: boolean;
  /** A small button only, for a toolbar. */
  compact?: boolean;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [options, setOptions] = React.useState<AccessRequestOptionsDto | null>(
    null,
  );
  const [open, setOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setOptions(
        await api.accessRequests.accessRequestsControllerOptions({
          scopeType: target.scopeType,
          scopeId: target.scopeId,
        }),
      );
    } catch {
      setOptions(null);
    }
  }, [target.scopeType, target.scopeId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (!options) return null;
  if (unmasked && (options.readsInClear || !options.canQuery)) return null;
  if (!unmasked && options.canQuery) return null;

  const pending = options.pending;
  if (pending) {
    const withdraw = async () => {
      try {
        await api.accessRequests.accessRequestsControllerWithdraw({
          id: pending.id,
        });
        toast.success(t("accessRequests.withdrawn"));
        await load();
        onChanged?.();
      } catch (error) {
        toast.error(
          await extractApiErrorMessage(error, t("accessRequests.sendFailed")),
        );
      }
    };
    return (
      <div
        className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
        data-testid="access-request-pending"
      >
        <Hourglass className="h-3.5 w-3.5" aria-hidden />
        <span>
          {t("accessRequests.pending", {
            date: new Date(pending.createdAt).toLocaleDateString(),
            who: decidersPhrase(options.deciders, t),
          })}
        </span>
        <Button size="sm" variant="ghost" onClick={() => void withdraw()}>
          {t("accessRequests.withdraw")}
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button
        size="sm"
        variant={compact ? "ghost" : "default"}
        onClick={() => setOpen(true)}
        data-testid={unmasked ? "request-unmasked" : "request-access"}
      >
        <KeyRound className="mr-1.5 h-3.5 w-3.5" />
        {t(
          unmasked
            ? "accessRequests.requestUnmasked"
            : "accessRequests.request",
        )}
      </Button>
      <RequestAccessDialog
        open={open}
        onOpenChange={setOpen}
        options={options}
        unmasked={unmasked}
        onSent={async () => {
          await load();
          onChanged?.();
        }}
      />
    </>
  );
}

function RequestAccessDialog({
  open,
  onOpenChange,
  options,
  unmasked,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: AccessRequestOptionsDto;
  unmasked: boolean;
  onSent: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [groupId, setGroupId] = React.useState(options.groups[0]?.id ?? "");
  const [roleKey, setRoleKey] = React.useState(
    unmasked ? DATA_READER_UNMASKED : DATA_READER,
  );
  const [days, setDays] = React.useState(String(options.defaultDays));
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const who = decidersPhrase(options.deciders, t);
  const valid =
    groupId &&
    reason.trim().length >= 10 &&
    Number(days) >= 1 &&
    Number(days) <= options.maxDays;

  const send = async () => {
    setBusy(true);
    try {
      await api.accessRequests.accessRequestsControllerCreate({
        createAccessRequestDto: {
          scopeType: options.target.scopeType,
          scopeId: options.target.id,
          groupId,
          roleKey: roleKey as "data-reader" | "data-reader-unmasked",
          reason: reason.trim(),
          durationDays: Number(days),
        },
      });
      toast.success(t("accessRequests.sent", { who }));
      onOpenChange(false);
      await onSent();
    } catch (error) {
      toast.error(
        await extractApiErrorMessage(error, t("accessRequests.sendFailed")),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="access-request-dialog">
        <DialogHeader>
          <DialogTitle>
            {t("accessRequests.title", { name: options.target.name })}
          </DialogTitle>
          <DialogDescription>
            {t("accessRequests.lead", { who })}
          </DialogDescription>
        </DialogHeader>
        {options.groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("accessRequests.noGroups")}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("accessRequests.group")}</Label>
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger data-testid="access-request-group">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.groups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.path ?? group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {t("accessRequests.groupHint")}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("accessRequests.role")}</Label>
              <Select value={roleKey} onValueChange={setRoleKey}>
                <SelectTrigger data-testid="access-request-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.roles
                    .filter(
                      (role) => !(options.canQuery && role === DATA_READER),
                    )
                    .map((role) => (
                      <SelectItem key={role} value={role}>
                        {t(`accessRequests.roles.${role}` as TranslationKey)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="access-request-days">
                {t("accessRequests.days")}
              </Label>
              <Input
                id="access-request-days"
                type="number"
                min={1}
                max={options.maxDays}
                value={days}
                onChange={(event) => setDays(event.target.value)}
                className="w-32"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="access-request-reason">
                {t("accessRequests.reason")}
              </Label>
              <Textarea
                id="access-request-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={4}
                maxLength={2000}
                data-testid="access-request-reason"
              />
              <p className="text-[11px] text-muted-foreground">
                {t("accessRequests.reasonHint")}
              </p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => void send()}
            disabled={!valid || busy}
            data-testid="access-request-send"
          >
            {t("accessRequests.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
