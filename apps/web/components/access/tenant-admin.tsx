"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Building2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type GrantDto,
  type Namespace,
  type RoleDto,
  type TenantDto,
  type TenantEventDto,
  type TenantGroupDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Label } from "@workspace/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { ActorChip } from "@/components/actor-chip";
import { useTranslation } from "@/hooks/use-translation";
import { formatRelative } from "@/lib/date";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

type ScopeType = "tenant" | "group" | "workspace";

/**
 * The tenant admin's page (docs/prd §12.4): every grant of the tenant, giving
 * a role on the tenant, a group's workspaces or one workspace, and the
 * tenant's audit trail. Groups and their members are managed in the identity
 * server, not here.
 */
export function TenantAdmin() {
  const { t } = useTranslation();
  const [tenant, setTenant] = React.useState<TenantDto | null>(null);
  const [grants, setGrants] = React.useState<GrantDto[]>([]);
  const [groups, setGroups] = React.useState<TenantGroupDto[]>([]);
  const [roles, setRoles] = React.useState<RoleDto[]>([]);
  const [workspaces, setWorkspaces] = React.useState<Namespace[]>([]);
  const [events, setEvents] = React.useState<TenantEventDto[]>([]);
  const [denied, setDenied] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const current = await api.access.tenantAccessControllerTenant();
      setTenant(current);
      if (!current.capabilities.includes("tenant.access.manage")) {
        setDenied(true);
        return;
      }
      const [nextGrants, nextGroups, nextWorkspaces] = await Promise.all([
        api.access.tenantAccessControllerGrants(),
        api.access.tenantAccessControllerGroups(),
        api.namespaces.list(),
      ]);
      setGrants(nextGrants);
      setGroups(nextGroups);
      setWorkspaces(nextWorkspaces);
      if (current.capabilities.includes("tenant.audit.view")) {
        setEvents(await api.access.tenantAccessControllerEvents());
      }
      setRoles(await api.access.tenantAccessControllerRoles());
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.loadFailed")));
    }
  }, [t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const remove = async (grant: GrantDto) => {
    try {
      await api.access.tenantAccessControllerRemoveGrant({ id: grant.id });
      toast.success(t("access.removed", { subject: grant.subjectLabel }));
      await load();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.removeFailed")));
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-8">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/">
          <ArrowLeft className="h-4 w-4" /> {t("access.allWorkspaces")}
        </Link>
      </Button>
      <div className="flex items-center gap-3">
        <Building2 className="h-6 w-6" />
        <h1 className="font-serif text-3xl font-black uppercase tracking-[0.06em]">
          {tenant?.name ?? t("access.tenantTitle")}
        </h1>
      </div>

      {denied ? (
        <p className="text-sm text-muted-foreground">{t("access.tenantDenied")}</p>
      ) : (
        <>
          <Card className="panel-card rounded-[6px]">
            <CardContent className="space-y-4 p-5">
              <p className="text-xs font-mono uppercase tracking-[0.14em]">
                {t("access.tenantGrants")}
              </p>
              <ul className="divide-y divide-border rounded-[4px] border border-border">
                {grants.map((grant) => (
                  <li
                    key={grant.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium">
                        {grant.subjectLabel}{" "}
                        <span className="text-muted-foreground">
                          ·{" "}
                          {roles.find((role) => role.key === grant.roleKey)?.title ??
                            grant.roleKey}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {grant.scopeType === "workspace"
                          ? (workspaces.find((ws) => ws.id === grant.scopeId)?.name ??
                            grant.scopeLabel)
                          : grant.scopeLabel}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t("access.remove")}
                      onClick={() => void remove(grant)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
              {tenant && (
                <TenantGrantForm
                  tenant={tenant}
                  groups={groups}
                  roles={roles}
                  workspaces={workspaces}
                  onAdded={load}
                />
              )}
            </CardContent>
          </Card>

          {events.length > 0 && (
            <Card className="panel-card rounded-[6px]">
              <CardContent className="space-y-3 p-5">
                <p className="text-xs font-mono uppercase tracking-[0.14em]">
                  {t("access.tenantActivity")}
                </p>
                <ul className="divide-y divide-border text-sm">
                  {events.map((event) => (
                    <li
                      key={event.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <span className="flex items-center gap-2">
                        <ActorChip actorRef={event.actor} />
                        <span className="font-mono text-xs">{event.action}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatRelative(event.occurredAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function TenantGrantForm({
  tenant,
  groups,
  roles,
  workspaces,
  onAdded,
}: {
  tenant: TenantDto;
  groups: TenantGroupDto[];
  roles: RoleDto[];
  workspaces: Namespace[];
  onAdded: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [subjectId, setSubjectId] = React.useState("");
  const [roleKey, setRoleKey] = React.useState("viewer");
  const [scopeType, setScopeType] = React.useState<ScopeType>("group");
  const [scopeId, setScopeId] = React.useState("");
  const role = roles.find((candidate) => candidate.key === roleKey);
  const scopes = (role?.scopes ?? ["tenant"]) as ScopeType[];

  React.useEffect(() => {
    if (!scopes.includes(scopeType)) setScopeType(scopes[0] ?? "tenant");
  }, [scopes, scopeType]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api.access.tenantAccessControllerAddGrant({
        createGrantDto: {
          subjectType: "group",
          subjectId,
          roleKey,
          scopeType,
          scopeId: scopeType === "tenant" ? tenant.id : scopeId,
        },
      });
      toast.success(t("access.added"));
      setSubjectId("");
      await onAdded();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.addFailed")));
    }
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="grid gap-3 rounded-[4px] border border-dashed border-border p-3 sm:grid-cols-2"
    >
      <div className="grid gap-1">
        <Label>{t("access.group")}</Label>
        <Select value={subjectId} onValueChange={setSubjectId}>
          <SelectTrigger>
            <SelectValue placeholder={t("access.pickGroup")} />
          </SelectTrigger>
          <SelectContent>
            {groups.map((group) => (
              <SelectItem key={group.id} value={group.id}>
                {group.path}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1">
        <Label>{t("access.role")}</Label>
        <Select value={roleKey} onValueChange={setRoleKey}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roles.map((candidate) => (
              <SelectItem key={candidate.key} value={candidate.key}>
                {candidate.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1">
        <Label>{t("access.scope")}</Label>
        <Select
          value={scopeType}
          onValueChange={(value) => {
            setScopeType(value as ScopeType);
            setScopeId("");
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {scopes.map((scope) => (
              <SelectItem key={scope} value={scope}>
                {t(`access.scopes.${scope}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {scopeType !== "tenant" && (
        <div className="grid gap-1">
          <Label>
            {scopeType === "group" ? t("access.ownedBy") : t("access.workspace")}
          </Label>
          <Select value={scopeId} onValueChange={setScopeId}>
            <SelectTrigger>
              <SelectValue placeholder={t("access.pickScope")} />
            </SelectTrigger>
            <SelectContent>
              {(scopeType === "group"
                ? groups.map((group) => ({ id: group.id, label: group.path }))
                : workspaces.map((ws) => ({ id: ws.id, label: ws.name }))
              ).map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="sm:col-span-2">
        <Button
          type="submit"
          disabled={!subjectId || (scopeType !== "tenant" && !scopeId)}
        >
          {t("access.add")}
        </Button>
      </div>
    </form>
  );
}
