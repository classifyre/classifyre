"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Repeat, User, Users, X } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
import {
  GOVERNANCE_ROLE_KINDS,
  principalKindsFor,
  rolesOf,
  type GovernancePrincipalDto,
  type GovernanceRoleDto,
  type GovernanceRoleKind,
} from "@/lib/governance";
import { PrincipalPicker } from "./principal-picker";
import { RoleIcon } from "./role-style";

function Holder({
  role,
  canEnd,
  onEnd,
  sourceHref,
}: {
  role: GovernanceRoleDto;
  canEnd: boolean;
  onEnd: () => void;
  sourceHref?: string;
}) {
  const { t } = useTranslation();
  const Icon = role.principal.kind === "group" ? Users : User;
  const detail = role.principal.email ?? role.principal.path;
  return (
    <li
      className="group flex min-w-0 items-center gap-1.5 rounded-[4px] border border-border/50 bg-background px-2 py-1"
      title={detail ?? undefined}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate text-sm font-medium">
        {role.principal.displayName}
      </span>
      {role.inherited &&
        (sourceHref ? (
          <a
            href={sourceHref}
            className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-muted-foreground hover:underline"
          >
            {t("governance.ownership.inherited")}
          </a>
        ) : (
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            {t("governance.ownership.inherited")}
          </span>
        ))}
      {canEnd && (
        <button
          type="button"
          className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label={t("governance.ownership.end", {
            name: role.principal.displayName,
          })}
          onClick={onEnd}
        >
          <X className="h-3 w-3" aria-hidden />
        </button>
      )}
    </li>
  );
}

/**
 * Owner, stewards and custodian of an asset or a source (GOV §5.7), as three
 * tiles side by side. Roles a source gives its assets show as inherited and
 * are changed on the source. Who changed what is in Activity.
 */
export function OwnershipCard({
  scope,
  roles,
  canGovern,
  onAssign,
  onRemove,
  sourceHref,
}: {
  scope: "asset" | "source";
  roles: GovernanceRoleDto[];
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
      <CardHeader className="pb-3">
        <CardTitle>{t("governance.ownership.title")}</CardTitle>
        <CardDescription>
          {t(`governance.ownership.description.${scope}`)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-3">
          {GOVERNANCE_ROLE_KINDS.map((kind) => {
            const held = rolesOf(roles, kind);
            const inherited = held.some((role) => role.inherited);
            // An owner is replaced, not added to; a steward or custodian adds.
            const canAdd = canGovern && (kind !== "OWNER" || held.length <= 1);
            const replacing = kind === "OWNER" && held.length > 0 && !inherited;
            return (
              <div
                key={kind}
                className="flex flex-col gap-2 rounded-[4px] border border-border/60 bg-muted/30 p-3"
                data-testid={`role-${kind}`}
              >
                <div className="flex items-start gap-2">
                  <RoleIcon role={kind} />
                  <div className="min-w-0 flex-1">
                    <div className="font-serif text-sm font-black uppercase tracking-[0.08em]">
                      {t(`governance.role.${kind}`)}
                    </div>
                    <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground" title={t(`governance.roleHint.${kind}`)}>
                      {t(`governance.roleHint.${kind}`)}
                    </p>
                  </div>
                  {canAdd && (
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7 shrink-0"
                      onClick={() => {
                        setPicked(null);
                        setAssigning(kind);
                      }}
                      aria-label={
                        replacing
                          ? t("governance.ownership.change")
                          : t("governance.ownership.assign")
                      }
                      title={
                        replacing
                          ? t("governance.ownership.change")
                          : t("governance.ownership.assign")
                      }
                      data-testid={`assign-${kind}`}
                    >
                      {replacing ? (
                        <Repeat className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                      )}
                    </Button>
                  )}
                </div>
                {held.length === 0 ? (
                  <p className="text-xs italic text-muted-foreground">
                    {t("governance.ownership.nobody")}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {held.map((role) => (
                      <Holder
                        key={role.id}
                        role={role}
                        canEnd={canGovern && !role.inherited}
                        onEnd={() => void remove(role)}
                        sourceHref={sourceHref}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>

      <Dialog
        open={assigning !== null}
        onOpenChange={(open) => !open && setAssigning(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {assigning && <RoleIcon role={assigning} size="sm" />}
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
