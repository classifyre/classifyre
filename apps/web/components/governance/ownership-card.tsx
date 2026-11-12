"use client";

import { useState } from "react";
import { toast } from "sonner";
import { History, Plus, User, Users, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import { ActorChip } from "@/components/actor-chip";
import {
  GOVERNANCE_ROLE_KINDS,
  principalKindsFor,
  rolesOf,
  type GovernancePrincipalDto,
  type GovernanceRoleDto,
  type GovernanceRoleKind,
} from "@/lib/governance";
import { PrincipalPicker } from "./principal-picker";

function PrincipalLine({ role }: { role: GovernanceRoleDto }) {
  const Icon = role.principal.kind === "group" ? Users : User;
  const detail = role.principal.email ?? role.principal.path;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">
          {role.principal.displayName}
        </span>
        {detail && (
          <span className="block truncate text-xs text-muted-foreground">
            {detail}
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * Owner, stewards and custodian of an asset or a source (GOV §5.7). Roles a
 * source gives its assets show as inherited here and are changed on the
 * source; people who may govern assign and end roles in place, and ended
 * roles stay listed under History.
 */
export function OwnershipCard({
  scope,
  roles,
  history,
  canGovern,
  onAssign,
  onRemove,
  sourceHref,
}: {
  scope: "asset" | "source";
  roles: GovernanceRoleDto[];
  history: GovernanceRoleDto[];
  canGovern: boolean;
  onAssign: (role: GovernanceRoleKind, principalRef: string) => Promise<void>;
  onRemove: (roleId: string) => Promise<void>;
  /** Where inherited roles are changed. */
  sourceHref?: string;
}) {
  const { t } = useTranslation();
  const [assigning, setAssigning] = useState<GovernanceRoleKind | null>(null);
  const [picked, setPicked] = useState<GovernancePrincipalDto | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!assigning || !picked) return;
    setBusy(true);
    try {
      await onAssign(assigning, picked.ref);
      toast.success(
        t("governance.ownership.assigned", {
          name: picked.displayName,
          role: t(`governance.role.${assigning}`),
        }),
      );
      setAssigning(null);
      setPicked(null);
    } catch (error) {
      toast.error(
        await extractApiErrorMessage(error, t("governance.ownership.failed")),
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (role: GovernanceRoleDto) => {
    try {
      await onRemove(role.id);
      toast.success(
        t("governance.ownership.removed", {
          name: role.principal.displayName,
          role: t(`governance.role.${role.role}` as TranslationKey),
        }),
      );
    } catch (error) {
      toast.error(
        await extractApiErrorMessage(error, t("governance.ownership.failed")),
      );
    }
  };

  return (
    <Card data-testid={`${scope}-ownership-card`}>
      <CardHeader>
        <CardTitle>{t("governance.ownership.title")}</CardTitle>
        <CardDescription>
          {t(`governance.ownership.description.${scope}`)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {GOVERNANCE_ROLE_KINDS.map((kind) => {
          const held = rolesOf(roles, kind);
          const inherited = held.some((role) => role.inherited);
          // An owner is replaced, not added to; a steward or custodian adds.
          const canAdd = canGovern && (kind !== "OWNER" || held.length <= 1);
          return (
            <div key={kind} className="space-y-2" data-testid={`role-${kind}`}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">
                    {t(`governance.role.${kind}`)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t(`governance.roleHint.${kind}`)}
                  </div>
                </div>
                {canAdd && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPicked(null);
                      setAssigning(kind);
                    }}
                    data-testid={`assign-${kind}`}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    {kind === "OWNER" && held.length > 0 && !inherited
                      ? t("governance.ownership.change")
                      : t("governance.ownership.assign")}
                  </Button>
                )}
              </div>
              {held.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("governance.ownership.nobody")}
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {held.map((role) => (
                    <li
                      key={role.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2"
                    >
                      <PrincipalLine role={role} />
                      <span className="flex shrink-0 items-center gap-2">
                        {role.inherited && (
                          <Badge variant="outline" className="text-xs">
                            {sourceHref ? (
                              <a href={sourceHref} className="hover:underline">
                                {t("governance.ownership.inherited")}
                              </a>
                            ) : (
                              t("governance.ownership.inherited")
                            )}
                          </Badge>
                        )}
                        {canGovern && !role.inherited && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            aria-label={t("governance.ownership.end", {
                              name: role.principal.displayName,
                            })}
                            onClick={() => void remove(role)}
                          >
                            <X className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        {history.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="px-0">
                <History className="h-3.5 w-3.5" aria-hidden />
                {t("governance.ownership.history", { count: history.length })}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="space-y-1.5 pt-2">
                {history.map((role) => (
                  <li
                    key={role.id}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
                  >
                    <span className="font-medium text-foreground">
                      {role.principal.displayName}
                    </span>
                    <span>
                      {t(`governance.role.${role.role}` as TranslationKey)}
                    </span>
                    <span>
                      {new Date(role.dateIn).toLocaleDateString()} –{" "}
                      {role.dateOut
                        ? new Date(role.dateOut).toLocaleDateString()
                        : ""}
                    </span>
                    {role.removedBy && (
                      <span className="inline-flex items-center gap-1">
                        {t("governance.ownership.endedBy")}
                        <ActorChip actorRef={role.removedBy} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>

      <Dialog
        open={assigning !== null}
        onOpenChange={(open) => !open && setAssigning(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {assigning &&
                t("governance.ownership.dialogTitle", {
                  role: t(`governance.role.${assigning}`),
                })}
            </DialogTitle>
            <DialogDescription>
              {assigning && t(`governance.roleHint.${assigning}`)}
              {assigning === "OWNER" &&
                rolesOf(roles, "OWNER").some((role) => !role.inherited) &&
                ` ${t("governance.ownership.replaces")}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="governance-principal">
              {assigning === "OWNER"
                ? t("governance.picker.person")
                : assigning === "CUSTODIAN"
                  ? t("governance.picker.group")
                  : t("governance.picker.personOrGroup")}
            </Label>
            {assigning && (
              <PrincipalPicker
                id="governance-principal"
                kinds={principalKindsFor(assigning)}
                value={picked}
                onChange={setPicked}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssigning(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => void confirm()}
              disabled={!picked || busy}
              data-testid="confirm-assign"
            >
              {t("governance.ownership.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
