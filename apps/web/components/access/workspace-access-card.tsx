"use client";

import * as React from "react";
import { HelpCircle, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type GrantDto,
  type RoleDto,
  type TenantGroupDto,
} from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { useMe, Can } from "@/hooks/use-me";
import { useTranslation } from "@/hooks/use-translation";
import { formatDate } from "@/lib/date";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

/**
 * Who has access to this workspace, and why (docs/prd §12.4). Grants made
 * here can be removed here; inherited ones (from the tenant or the group that
 * owns the workspace) are shown read-only, because only a tenant admin can
 * change them.
 */
export function WorkspaceAccessCard() {
  const { t } = useTranslation();
  const [grants, setGrants] = React.useState<GrantDto[] | null>(null);
  const [roles, setRoles] = React.useState<RoleDto[]>([]);
  const [groups, setGroups] = React.useState<TenantGroupDto[]>([]);

  const load = React.useCallback(async () => {
    try {
      const [nextGrants, nextRoles, nextGroups] = await Promise.all([
        api.access.workspaceAccessControllerGrants(),
        api.access.workspaceAccessControllerRoles(),
        api.access.workspaceAccessControllerGroups(),
      ]);
      setGrants(nextGrants);
      setRoles(nextRoles);
      setGroups(nextGroups);
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.loadFailed")));
      setGrants([]);
    }
  }, [t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const roleTitle = (key: string) =>
    roles.find((role) => role.key === key)?.title ?? key;

  const remove = async (grant: GrantDto) => {
    try {
      await api.access.workspaceAccessControllerRemoveGrant({ id: grant.id });
      toast.success(t("access.removed", { subject: grant.subjectLabel }));
      await load();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.removeFailed")));
    }
  };

  return (
    <Card className="panel-card rounded-[6px]">
      <CardContent className="space-y-5 p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          <p className="text-xs font-mono uppercase tracking-[0.14em]">
            {t("access.title")}
          </p>
        </div>
        <p className="-mt-3 text-xs text-muted-foreground">
          {t("access.description")}
        </p>

        <ul className="divide-y divide-border rounded-[4px] border border-border">
          {(grants ?? []).map((grant) => (
            <li
              key={grant.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="font-medium">
                  {grant.subjectLabel}{" "}
                  <span className="text-muted-foreground">
                    · {roleTitle(grant.roleKey)}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {grant.scopeLabel}
                  {grant.expiresAt
                    ? ` · ${t("access.until", { date: formatDate(grant.expiresAt) })}`
                    : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {grant.inherited ? (
                  <Badge variant="outline">{t("access.inherited")}</Badge>
                ) : (
                  <Can capability="access.manage">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t("access.remove")}
                      onClick={() => void remove(grant)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </Can>
                )}
              </div>
            </li>
          ))}
          {grants?.length === 0 && (
            <li className="px-3 py-4 text-center text-sm text-muted-foreground">
              {t("access.none")}
            </li>
          )}
        </ul>

        <Can capability="access.manage">
          <AddGrantForm
            groups={groups}
            roles={roles.filter((role) => role.scopes.includes("workspace"))}
            onAdded={load}
          />
        </Can>

        <WhyCanI />
      </CardContent>
    </Card>
  );
}

function AddGrantForm({
  groups,
  roles,
  onAdded,
}: {
  groups: TenantGroupDto[];
  roles: RoleDto[];
  onAdded: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [groupId, setGroupId] = React.useState("");
  const [roleKey, setRoleKey] = React.useState("viewer");
  const [until, setUntil] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!groupId) return;
    setSaving(true);
    try {
      await api.access.workspaceAccessControllerAddGrant({
        createGrantDto: {
          subjectType: "group",
          subjectId: groupId,
          roleKey,
          expiresAt: until ? new Date(`${until}T23:59:59`) : null,
        },
      });
      toast.success(t("access.added"));
      setGroupId("");
      setUntil("");
      await onAdded();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.addFailed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="grid gap-3 rounded-[4px] border border-dashed border-border p-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end"
    >
      <div className="grid gap-1">
        <Label>{t("access.group")}</Label>
        <Select value={groupId} onValueChange={setGroupId}>
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
            {roles.map((role) => (
              <SelectItem key={role.key} value={role.key}>
                {role.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="access-until">{t("access.untilOptional")}</Label>
        <Input
          id="access-until"
          type="date"
          value={until}
          onChange={(event) => setUntil(event.target.value)}
        />
      </div>
      <Button type="submit" disabled={!groupId || saving}>
        {t("access.add")}
      </Button>
    </form>
  );
}

/** "Why can I…?": the grants that give the current person a capability. */
function WhyCanI() {
  const { t } = useTranslation();
  const me = useMe();
  const [capability, setCapability] = React.useState("");
  const [why, setWhy] = React.useState<GrantDto[] | null>(null);

  React.useEffect(() => {
    if (!capability) return;
    let active = true;
    void api.access
      .workspaceAccessControllerExplain({ capability })
      .then((grants) => active && setWhy(grants))
      .catch(() => active && setWhy([]));
    return () => {
      active = false;
    };
  }, [capability]);

  return (
    <div className="space-y-2 rounded-[4px] bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <HelpCircle className="h-4 w-4" />
        {t("access.whyTitle")}
      </div>
      <Select value={capability} onValueChange={setCapability}>
        <SelectTrigger className="max-w-sm">
          <SelectValue placeholder={t("access.pickCapability")} />
        </SelectTrigger>
        <SelectContent>
          {(me?.capabilities ?? []).map((value) => (
            <SelectItem key={value} value={value}>
              {value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {capability && why && (
        <ul className="text-sm">
          {why.map((grant) => (
            <li key={grant.id}>
              {t("access.becauseOf", {
                subject: grant.subjectLabel,
                role: grant.roleKey,
                scope: grant.scopeLabel,
              })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
