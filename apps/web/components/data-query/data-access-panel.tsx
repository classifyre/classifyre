"use client";

import * as React from "react";
import { Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@workspace/api-client";
import type { GrantDto, TenantGroupDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { useTranslation } from "@/hooks/use-translation";
import { apiErrorMessage } from "@/lib/data-query";

/**
 * Who may read this table's rows, and a way to give a group that access
 * (docs/prd/DQ-data-query.md §4). Access goes to groups, as everywhere: the
 * Data reader role on this table, or on its whole source.
 */
export function DataAccessPanel({
  workspaceId,
  assetId,
  sourceId,
}: {
  workspaceId: string;
  assetId: string;
  sourceId: string;
}) {
  const { t } = useTranslation();
  const [grants, setGrants] = React.useState<GrantDto[] | null>(null);
  const [groups, setGroups] = React.useState<TenantGroupDto[]>([]);
  const [groupId, setGroupId] = React.useState<string>("");
  const [scope, setScope] = React.useState<"asset" | "source">("asset");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const [all, tenantGroups] = await Promise.all([
      api.access.workspaceAccessControllerGrants(),
      api.access.workspaceAccessControllerGroups(),
    ]);
    setGroups(tenantGroups);
    setGrants(
      all.filter(
        (grant) =>
          (grant.scopeType === "asset" &&
            grant.scopeId === `${workspaceId}/${assetId}`) ||
          (grant.scopeType === "source" &&
            grant.scopeId === `${workspaceId}/${sourceId}`) ||
          (grant.roleKey === "data-reader" &&
            grant.scopeType !== "asset" &&
            grant.scopeType !== "source"),
      ),
    );
  }, [workspaceId, assetId, sourceId]);

  React.useEffect(() => {
    load().catch(() => setGrants([]));
  }, [load]);

  const add = async () => {
    if (!groupId) return;
    setBusy(true);
    try {
      await api.access.workspaceAccessControllerAddGrant({
        createGrantDto: {
          subjectType: "group",
          subjectId: groupId,
          roleKey: "data-reader",
          scopeType: scope,
          resourceId: scope === "asset" ? assetId : sourceId,
        },
      });
      setGroupId("");
      await load();
      toast.success(t("dataQuery.access.added"));
    } catch (error) {
      toast.error(await apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (grant: GrantDto) => {
    try {
      await api.access.workspaceAccessControllerRemoveGrant({ id: grant.id });
      await load();
    } catch (error) {
      toast.error(await apiErrorMessage(error));
    }
  };

  return (
    <div
      className="space-y-3 rounded-md border p-4"
      data-testid="data-access-panel"
    >
      <div>
        <h3 className="text-sm font-medium">{t("dataQuery.access.title")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("dataQuery.access.description")}
        </p>
      </div>
      <ul className="space-y-1 text-sm">
        {grants?.length === 0 && (
          <li className="text-xs text-muted-foreground">
            {t("dataQuery.access.none")}
          </li>
        )}
        {grants?.map((grant) => (
          <li key={grant.id} className="flex items-center gap-2">
            <span className="font-medium">{grant.subjectLabel}</span>
            <span className="text-xs text-muted-foreground">
              {grant.scopeType === "asset"
                ? t("dataQuery.access.thisTable")
                : grant.scopeType === "source"
                  ? t("dataQuery.access.wholeSource")
                  : grant.scopeLabel}
            </span>
            {(grant.scopeType === "asset" || grant.scopeType === "source") && (
              <Button
                size="icon"
                variant="ghost"
                className="ml-auto h-7 w-7"
                onClick={() => void remove(grant)}
                aria-label={t("dataQuery.access.remove")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={groupId} onValueChange={setGroupId}>
          <SelectTrigger className="h-8 w-56 text-sm">
            <SelectValue placeholder={t("dataQuery.access.pickGroup")} />
          </SelectTrigger>
          <SelectContent>
            {groups.map((group) => (
              <SelectItem key={group.id} value={group.id}>
                {group.path}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={scope}
          onValueChange={(value) => setScope(value as "asset" | "source")}
        >
          <SelectTrigger className="h-8 w-44 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="asset">
              {t("dataQuery.access.thisTable")}
            </SelectItem>
            <SelectItem value="source">
              {t("dataQuery.access.wholeSource")}
            </SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={() => void add()}
          disabled={!groupId || busy}
        >
          <UserPlus className="mr-1.5 h-3.5 w-3.5" />
          {t("dataQuery.access.give")}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t("dataQuery.access.viewerNote")}
      </p>
    </div>
  );
}
