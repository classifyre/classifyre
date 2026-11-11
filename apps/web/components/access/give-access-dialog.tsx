"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@workspace/api-client";
import type { RoleDto, TenantGroupDto } from "@workspace/api-client";
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
import { useTranslation } from "@/hooks/use-translation";
import { fetchCatalog, type QueryCatalog } from "@/lib/data-query";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

/** What a grant made here applies to: the workspace, one source, one table. */
export type GrantTarget =
  | { kind: "workspace" }
  | { kind: "source"; id: string; name: string }
  | { kind: "asset"; id: string; name: string };

type TargetKind = GrantTarget["kind"];

/**
 * The one "Give access" dialog: Settings → Access, a source's Data tab and a
 * table's Data tab all open this. Group, role, what it applies to, and an
 * optional end date — the same fields everywhere.
 *
 * - From Settings every role can be picked; a role that can be given on
 *   single sources and tables (Data reader) also asks which: the whole
 *   workspace, one source, or one table.
 * - From a Data tab the role and target are fixed (`fixed`): shown, not
 *   picked, so the dialog reads the same and only the group and date are
 *   left to choose.
 */
export function GiveAccessDialog({
  open,
  onOpenChange,
  groups,
  roles,
  fixed,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: TenantGroupDto[];
  /** Roles that can be given in this workspace. */
  roles: RoleDto[];
  /** A Data tab's role and target, not to be changed here. */
  fixed?: { roleKey: string; target: GrantTarget };
  onAdded: () => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [groupId, setGroupId] = React.useState("");
  const [roleKey, setRoleKey] = React.useState(fixed?.roleKey ?? "viewer");
  const [targetKind, setTargetKind] = React.useState<TargetKind>(
    fixed?.target.kind ?? "workspace",
  );
  const [resourceId, setResourceId] = React.useState("");
  const [until, setUntil] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [catalog, setCatalog] = React.useState<QueryCatalog | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setGroupId("");
    setRoleKey(fixed?.roleKey ?? "viewer");
    setTargetKind(fixed?.target.kind ?? "workspace");
    setResourceId("");
    setUntil("");
  }, [open, fixed?.roleKey, fixed?.target.kind]);

  const role = roles.find((candidate) => candidate.key === roleKey);
  const targetKinds = (["workspace", "source", "asset"] as const).filter(
    (kind) => role?.scopes.includes(kind) ?? kind === "workspace",
  );
  const picksResource = !fixed && targetKind !== "workspace";

  // Sources and tables to pick from, loaded once a single one is asked for.
  React.useEffect(() => {
    if (!open || !picksResource || catalog) return;
    fetchCatalog()
      .then(setCatalog)
      .catch(() => setCatalog({ sources: [] } as unknown as QueryCatalog));
  }, [open, picksResource, catalog]);

  const resources = React.useMemo(() => {
    const sources = catalog?.sources ?? [];
    return targetKind === "source"
      ? sources.map((source) => ({ id: source.id, name: source.name }))
      : sources.flatMap((source) =>
          source.tables.map((table) => ({
            id: table.assetId,
            name: `${source.name} · ${table.schema}.${table.table}`,
          })),
        );
  }, [catalog, targetKind]);

  const target: GrantTarget | null = fixed
    ? fixed.target
    : targetKind === "workspace"
      ? { kind: "workspace" }
      : resourceId
        ? {
            kind: targetKind,
            id: resourceId,
            name: resources.find((r) => r.id === resourceId)?.name ?? "",
          }
        : null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!groupId || !target) return;
    setSaving(true);
    try {
      await api.access.workspaceAccessControllerAddGrant({
        createGrantDto: {
          subjectType: "group",
          subjectId: groupId,
          roleKey,
          ...(target.kind === "workspace"
            ? { scopeType: "workspace" }
            : { scopeType: target.kind, resourceId: target.id }),
          expiresAt: until ? new Date(`${until}T23:59:59`) : null,
        },
      });
      toast.success(t("access.added"));
      onOpenChange(false);
      await onAdded();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.addFailed")));
    } finally {
      setSaving(false);
    }
  };

  const targetLabel = (kind: TargetKind) =>
    kind === "workspace"
      ? t("access.appliesTo.workspace")
      : kind === "source"
        ? t("access.appliesTo.source")
        : t("access.appliesTo.asset");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="give-access-dialog">
        <DialogHeader>
          <DialogTitle>{t("access.giveAccessTitle")}</DialogTitle>
          <DialogDescription>
            {t("access.giveAccessDescription")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="give-access-group">{t("access.group")}</Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger
                id="give-access-group"
                data-testid="give-access-group"
                className="w-full"
              >
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
            <Label htmlFor="give-access-role">{t("access.role")}</Label>
            <Select
              value={roleKey}
              onValueChange={(next) => {
                setRoleKey(next);
                setTargetKind("workspace");
                setResourceId("");
              }}
              disabled={Boolean(fixed)}
            >
              <SelectTrigger
                id="give-access-role"
                data-testid="give-access-role"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(fixed && !role
                  ? [{ key: fixed.roleKey, title: fixed.roleKey }]
                  : roles
                ).map((candidate) => (
                  <SelectItem key={candidate.key} value={candidate.key}>
                    {candidate.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="give-access-target">
              {t("access.appliesTo.label")}
            </Label>
            {fixed ? (
              <Input
                id="give-access-target"
                data-testid="give-access-target-fixed"
                value={
                  fixed.target.kind === "workspace"
                    ? targetLabel("workspace")
                    : `${targetLabel(fixed.target.kind)}: ${fixed.target.name}`
                }
                disabled
              />
            ) : (
              <Select
                value={targetKind}
                onValueChange={(next) => {
                  setTargetKind(next as TargetKind);
                  setResourceId("");
                }}
                disabled={targetKinds.length < 2}
              >
                <SelectTrigger
                  id="give-access-target"
                  data-testid="give-access-target"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {targetKinds.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {targetLabel(kind)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {picksResource && (
            <div className="grid gap-1">
              <Label htmlFor="give-access-resource">
                {targetKind === "source"
                  ? t("access.appliesTo.pickSource")
                  : t("access.appliesTo.pickTable")}
              </Label>
              <Select value={resourceId} onValueChange={setResourceId}>
                <SelectTrigger
                  id="give-access-resource"
                  data-testid="give-access-resource"
                  className="w-full"
                >
                  <SelectValue
                    placeholder={
                      catalog === null
                        ? t("common.loading")
                        : resources.length
                          ? t("access.appliesTo.choose")
                          : t("access.appliesTo.none")
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {resources.map((resource) => (
                    <SelectItem key={resource.id} value={resource.id}>
                      {resource.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-1">
            <Label htmlFor="give-access-until">
              {t("access.untilOptional")}
            </Label>
            <Input
              id="give-access-until"
              data-testid="give-access-until"
              type="date"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t("access.groupsHint")}
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              {t("access.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!groupId || !target || saving}
              data-testid="give-access-submit"
            >
              <Plus className="h-4 w-4" />
              {t("access.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
