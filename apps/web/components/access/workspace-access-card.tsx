"use client";

import * as React from "react";
import { ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { GiveAccessDialog } from "@/components/access/give-access-dialog";
import { GrantsByGroup } from "@/components/access/grants-by-group";
import {
  api,
  type GrantDto,
  type RoleDto,
  type TenantGroupDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";




import { useMe, useCan, Can } from "@/hooks/use-me";
import { useTranslation } from "@/hooks/use-translation";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

/**
 * Who has access to this workspace, and why (docs/prd §12.4). Grants made
 * here can be removed here; inherited ones (from the tenant or the group that
 * owns the workspace) are shown read-only, because only a tenant admin can
 * change them. Giving access lives in a dialog opened from the card header;
 * "What I can do" lists every capability the caller holds with the group,
 * role, tenant and scope that give it.
 */
export function WorkspaceAccessCard() {
  const { t } = useTranslation();
  const [grants, setGrants] = React.useState<GrantDto[] | null>(null);
  const [roles, setRoles] = React.useState<RoleDto[]>([]);
  const [groups, setGroups] = React.useState<TenantGroupDto[]>([]);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const canManage = useCan("access.manage");

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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            <p className="text-xs font-mono uppercase tracking-[0.14em]">
              {t("access.title")}
            </p>
          </div>
          <Can capability="access.manage">
            <Button
              size="sm"
              onClick={() => setDialogOpen(true)}
              data-testid="workspace-give-access"
            >
              <UserPlus className="h-4 w-4" />
              {t("access.add")}
            </Button>
          </Can>
        </div>
        <p className="-mt-3 text-xs text-muted-foreground">
          {t("access.description")}
        </p>

        <div data-testid="workspace-grants">
          <GrantsByGroup
            grants={grants ?? []}
            roles={roles}
            groupLabel={(grant) => grant.subjectLabel}
            scopeLabel={(grant) => grant.scopeLabel}
            showOrigin
            canRemove={(grant) => !grant.inherited && canManage}
            onRemove={remove}
          />
        </div>

        <Can capability="access.manage">
          <GiveAccessDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            groups={groups}
            roles={roles.filter((role) => role.scopes.includes("workspace"))}
            onAdded={load}
          />
        </Can>

        <WhatICanDo roles={roles} />
      </CardContent>
    </Card>
  );
}

/**
 * "What I can do": the grants that give the caller access here, as the same
 * grouped table as above — the group, the role with what it lets them do, and
 * where it applies. Found by asking, for each capability the caller holds,
 * which grants give it; a grant that gives several shows once.
 */
function WhatICanDo({ roles }: { roles: RoleDto[] }) {
  const { t } = useTranslation();
  const me = useMe();
  const [grants, setGrants] = React.useState<GrantDto[] | null>(null);

  const capabilities = React.useMemo(
    () => [...(me?.capabilities ?? [])].sort(),
    [me],
  );

  React.useEffect(() => {
    let active = true;
    if (capabilities.length === 0) {
      setGrants([]);
      return;
    }
    void Promise.all(
      capabilities.map((capability) =>
        api.access
          .workspaceAccessControllerExplain({ capability })
          .catch(() => [] as GrantDto[]),
      ),
    ).then((all) => {
      if (!active) return;
      const byId = new Map<string, GrantDto>();
      for (const grant of all.flat()) byId.set(grant.id, grant);
      setGrants([...byId.values()]);
    });
    return () => {
      active = false;
    };
  }, [capabilities]);

  return (
    <div className="space-y-2 rounded-[4px] bg-muted/30 p-3">
      <p className="text-sm font-medium">{t("access.whyTitle")}</p>
      <p className="text-xs text-muted-foreground">
        {t("access.whyDescription")}
      </p>
      {grants === null ? (
        <p className="py-2 text-center text-sm text-muted-foreground">
          {t("common.loading")}
        </p>
      ) : (
        <div data-testid="what-i-can-do">
          <GrantsByGroup
            grants={grants}
            roles={roles}
            groupLabel={(grant) => grant.subjectLabel}
            scopeLabel={(grant) => grant.scopeLabel}
            showOrigin
            canRemove={() => false}
            onRemove={() => undefined}
            emptyLabel={t("access.canDo.none")}
          />
        </div>
      )}
    </div>
  );
}
