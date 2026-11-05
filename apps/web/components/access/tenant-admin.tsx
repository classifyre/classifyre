"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Building2, History, KeyRound, Trash2, Users, UsersRound } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type GrantDto,
  type Namespace,
  type PersonDto,
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { ActorChip } from "@/components/actor-chip";
import { useTranslation } from "@/hooks/use-translation";
import { formatRelative } from "@/lib/date";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import { TenantGroups } from "./tenant-groups";
import { TenantPeople } from "./tenant-people";

type ScopeType = "tenant" | "group" | "workspace";

const TAB_TRIGGER_CLASS =
  "gap-2 px-1 text-xs font-mono uppercase tracking-[0.14em]";

/**
 * The tenant admin's page (docs/prd §12.4, step 8c): the tenant's people and
 * groups, every grant (a role on the tenant, a group's workspaces or one
 * workspace), and the tenant's activity. Everything a tenant admin does
 * happens here; the identity server's own console is for operators.
 */
export function TenantAdmin() {
  const { t } = useTranslation();
  const [tenant, setTenant] = React.useState<TenantDto | null>(null);
  const [grants, setGrants] = React.useState<GrantDto[]>([]);
  const [groups, setGroups] = React.useState<TenantGroupDto[]>([]);
  const [people, setPeople] = React.useState<PersonDto[]>([]);
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
      const managesPeople = current.capabilities.includes("tenant.people.manage");
      const [nextGrants, nextGroups, nextWorkspaces, nextPeople, nextRoles] =
        await Promise.all([
          api.access.tenantAccessControllerGrants(),
          api.access.tenantAccessControllerGroups(),
          api.namespaces.list(),
          managesPeople
            ? api.access.tenantPeopleControllerList()
            : Promise.resolve([] as PersonDto[]),
          api.access.tenantAccessControllerRoles(),
        ]);
      setGrants(nextGrants);
      setGroups(nextGroups);
      setWorkspaces(nextWorkspaces);
      setPeople(nextPeople);
      setRoles(nextRoles);
      if (current.capabilities.includes("tenant.audit.view")) {
        setEvents(await api.access.tenantAccessControllerEvents());
      }
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

  const managesPeople = tenant?.capabilities.includes("tenant.people.manage") ?? false;
  const editable = managesPeople && (tenant?.peopleManagement ?? false);

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
        <Tabs
          defaultValue={managesPeople ? "people" : "access"}
          urlParam="tab"
          className="gap-5"
        >
          <TabsList
            variant="line"
            className="h-auto w-full flex-wrap justify-start gap-x-6 gap-y-1 border-b-2 border-border pb-0"
          >
            {managesPeople && (
              <>
                <TabsTrigger value="people" className={TAB_TRIGGER_CLASS}>
                  <Users className="h-3.5 w-3.5" />
                  {t("access.tabs.people")}
                </TabsTrigger>
                <TabsTrigger value="groups" className={TAB_TRIGGER_CLASS}>
                  <UsersRound className="h-3.5 w-3.5" />
                  {t("access.tabs.groups")}
                </TabsTrigger>
              </>
            )}
            <TabsTrigger value="access" className={TAB_TRIGGER_CLASS}>
              <KeyRound className="h-3.5 w-3.5" />
              {t("access.tabs.access")}
            </TabsTrigger>
            {events.length > 0 && (
              <TabsTrigger value="activity" className={TAB_TRIGGER_CLASS}>
                <History className="h-3.5 w-3.5" />
                {t("access.tabs.activity")}
              </TabsTrigger>
            )}
          </TabsList>

          {managesPeople && (
            <>
              <TabsContent value="people">
                <TenantPeople
                  people={people}
                  groups={groups}
                  editable={editable}
                  onChanged={load}
                />
              </TabsContent>
              <TabsContent value="groups">
                <TenantGroups
                  groups={groups}
                  people={people}
                  editable={editable}
                  onChanged={load}
                />
              </TabsContent>
            </>
          )}

          <TabsContent value="access">
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
          </TabsContent>

          {events.length > 0 && (
            <TabsContent value="activity">
              <ul className="divide-y divide-border rounded-[4px] border border-border text-sm">
                {events.map((event) => (
                  <li
                    key={event.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <ActorChip actorRef={event.actor} />
                      <span className="font-mono text-xs">{event.action}</span>
                      {eventSubject(event) && (
                        <span className="truncate text-xs text-muted-foreground">
                          {eventSubject(event)}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatRelative(event.occurredAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}

/** What an activity entry was about: a group path, an address or a workspace. */
function eventSubject(event: TenantEventDto): string | null {
  const detail = (event.detail ?? {}) as Record<string, unknown>;
  for (const key of ["path", "to", "email", "slug"]) {
    if (typeof detail[key] === "string") return detail[key];
  }
  return null;
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
  const scopes = React.useMemo(
    () => (role?.scopes ?? ["tenant"]) as ScopeType[],
    [role],
  );

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
      <p className="text-xs text-muted-foreground sm:col-span-2">
        {t("access.groupsHint")}
      </p>
    </form>
  );
}
