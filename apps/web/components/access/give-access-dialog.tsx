"use client";

import * as React from "react";
import { Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "@workspace/api-client";
import type {
  Namespace,
  RoleDto,
  TenantDto,
  TenantGroupDto,
} from "@workspace/api-client";
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
  MultiSelect,
  MultiSelectContent,
  MultiSelectItem,
  MultiSelectTrigger,
  MultiSelectValue,
} from "@workspace/ui/components/multi-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { useTranslation } from "@/hooks/use-translation";
import { fetchCatalog, type QueryCatalog } from "@/lib/data-query";
import { lacksOpeningRole } from "@/lib/access-grants";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

/** What a grant made in a workspace applies to: the workspace, one source, one table. */
export type GrantTarget =
  | { kind: "workspace" }
  | { kind: "source"; id: string; name: string }
  | { kind: "asset"; id: string; name: string };

/**
 * Where the dialog gives access:
 * - `workspace`: the current workspace, one of its sources or one of its
 *   tables (Settings → Access, a Data tab);
 * - `tenant`: the whole tenant, a group's workspaces or one workspace (the
 *   tenant page).
 */
export type GiveAccessWhere =
  | { kind: "workspace" }
  | { kind: "tenant"; tenant: TenantDto; workspaces: Namespace[] };

type TargetKind = "tenant" | "group" | "workspace" | "source" | "asset";

const KINDS: Record<GiveAccessWhere["kind"], readonly TargetKind[]> = {
  workspace: ["workspace", "source", "asset"],
  tenant: ["tenant", "group", "workspace"],
};

/** The kind that needs nothing picked: all of it. */
const WHOLE: Record<GiveAccessWhere["kind"], TargetKind> = {
  workspace: "workspace",
  tenant: "tenant",
};

/** Where the dialog starts: the tenant page asks which group's workspaces. */
const START: Record<GiveAccessWhere["kind"], TargetKind> = {
  workspace: "workspace",
  tenant: "group",
};

/**
 * The one "Give access" dialog: Settings → Access, a source's or table's Data
 * tab and the tenant page all open this. Group, roles, what it applies to, and
 * an optional end date — the same fields everywhere.
 *
 * - Several roles can be picked at once (Viewer and Data reader, say); each is
 *   given as its own grant. "Applies to" offers what every picked role can be
 *   given on: a role that can be given on single sources and tables (Data
 *   reader) also asks which, once every picked role can go there.
 * - Roles that do not open the workspace (Data reader) say so, so the group is
 *   not left with access nobody can reach.
 * - From a Data tab the role and target are predefined (`fixed`): shown but
 *   not editable, so the dialog reads the same and only the group and date
 *   are left to choose.
 */
export function GiveAccessDialog({
  open,
  onOpenChange,
  groups,
  roles,
  where = { kind: "workspace" },
  fixed,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: TenantGroupDto[];
  /** Roles that can be given here. */
  roles: RoleDto[];
  where?: GiveAccessWhere;
  /** A Data tab's role and target, predefined and not to be changed here. */
  fixed?: { roleKey: string; target: GrantTarget };
  onAdded: () => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const mode = where.kind;
  const whole = WHOLE[mode];
  const [groupId, setGroupId] = React.useState("");
  const [roleKeys, setRoleKeys] = React.useState<string[]>([
    fixed?.roleKey ?? "viewer",
  ]);
  const [targetKind, setTargetKind] = React.useState<TargetKind>(
    fixed?.target.kind ?? START[mode],
  );
  const [pickedId, setPickedId] = React.useState("");
  const [until, setUntil] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [catalog, setCatalog] = React.useState<QueryCatalog | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setGroupId("");
    setRoleKeys([fixed?.roleKey ?? "viewer"]);
    setTargetKind(fixed?.target.kind ?? START[mode]);
    setPickedId("");
    setUntil("");
  }, [open, mode, fixed?.roleKey, fixed?.target.kind]);

  const picked = roles.filter((candidate) => roleKeys.includes(candidate.key));
  const roleTitle = (key: string) =>
    roles.find((candidate) => candidate.key === key)?.title ?? key;
  // What every picked role can be given on.
  const targetKinds = KINDS[mode].filter(
    (kind) =>
      picked.length === 0 || picked.every((role) => role.scopes.includes(kind)),
  );
  const opensNothing = !fixed && lacksOpeningRole(roles, roleKeys);
  const picks = !fixed && targetKind !== whole;

  // A kind the picked roles cannot all be given on is dropped.
  React.useEffect(() => {
    if (fixed || targetKinds.length === 0 || targetKinds.includes(targetKind))
      return;
    setTargetKind(targetKinds[0]!);
    setPickedId("");
  }, [fixed, targetKinds, targetKind]);

  // Sources and tables to pick from, loaded once a single one is asked for.
  const picksCatalog =
    picks && (targetKind === "source" || targetKind === "asset");
  React.useEffect(() => {
    if (!open || !picksCatalog || catalog) return;
    fetchCatalog()
      .then(setCatalog)
      .catch(() => setCatalog({ sources: [] } as unknown as QueryCatalog));
  }, [open, picksCatalog, catalog]);

  const options = React.useMemo(() => {
    if (targetKind === "group")
      return groups.map((group) => ({ id: group.id, name: group.path }));
    if (targetKind === "workspace" && where.kind === "tenant")
      return where.workspaces.map((ws) => ({ id: ws.id, name: ws.name }));
    const sources = catalog?.sources ?? [];
    return targetKind === "source"
      ? sources.map((source) => ({ id: source.id, name: source.name }))
      : sources.flatMap((source) =>
          source.tables.map((table) => ({
            id: table.assetId,
            name: `${source.name} · ${table.schema}.${table.table}`,
          })),
        );
  }, [catalog, targetKind, groups, where]);

  const target: { kind: TargetKind; id?: string; name?: string } | null = fixed
    ? fixed.target
    : targetKind === whole
      ? { kind: whole }
      : pickedId
        ? {
            kind: targetKind,
            id: pickedId,
            name: options.find((option) => option.id === pickedId)?.name ?? "",
          }
        : null;

  /** One grant of `roleKey`, on the target, to the chosen group. */
  const give = (roleKey: string) => {
    const base = {
      subjectType: "group" as const,
      subjectId: groupId,
      roleKey,
      expiresAt: until ? new Date(`${until}T23:59:59`) : null,
    };
    if (where.kind === "tenant") {
      return api.access.tenantAccessControllerAddGrant({
        createGrantDto: {
          ...base,
          scopeType: target!.kind as "tenant" | "group" | "workspace",
          scopeId: target!.kind === "tenant" ? where.tenant.id : target!.id,
        },
      });
    }
    return api.access.workspaceAccessControllerAddGrant({
      createGrantDto: {
        ...base,
        ...(target!.kind === "workspace"
          ? { scopeType: "workspace" as const }
          : {
              scopeType: target!.kind as "source" | "asset",
              resourceId: target!.id,
            }),
      },
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!groupId || !target || roleKeys.length === 0) return;
    setSaving(true);
    // One grant per role, in the order picked; one that fails does not stop
    // the others, and stays picked so it can be tried again.
    const given: string[] = [];
    const failed: string[] = [];
    let lastError: unknown;
    for (const key of roleKeys) {
      try {
        await give(key);
        given.push(key);
      } catch (error) {
        failed.push(key);
        lastError = error;
      }
    }
    try {
      if (failed.length === 0) {
        toast.success(t("access.added"));
        onOpenChange(false);
      } else {
        setRoleKeys(failed);
        const reason = await extractApiErrorMessage(
          lastError,
          t("access.addFailed"),
        );
        toast.error(
          given.length === 0
            ? reason
            : t("access.addedPartial", {
                done: given.length,
                total: roleKeys.length,
                failed: failed.map(roleTitle).join(", "),
                reason,
              }),
        );
      }
      if (given.length > 0) await onAdded();
    } finally {
      setSaving(false);
    }
  };

  const targetLabel = (kind: TargetKind) =>
    mode === "tenant"
      ? t(`access.scopes.${kind as "tenant" | "group" | "workspace"}`)
      : t(`access.appliesTo.${kind as "workspace" | "source" | "asset"}`);

  const pickLabel =
    targetKind === "group"
      ? t("access.ownedBy")
      : targetKind === "workspace"
        ? t("access.workspace")
        : targetKind === "source"
          ? t("access.appliesTo.pickSource")
          : t("access.appliesTo.pickTable");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="give-access-dialog">
        <DialogHeader>
          <DialogTitle>{t("access.giveAccessTitle")}</DialogTitle>
          <DialogDescription>
            {mode === "tenant"
              ? t("access.groupsHint")
              : t("access.giveAccessDescription")}
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
            <Label htmlFor="give-access-role">{t("access.roles")}</Label>
            {fixed ? (
              <Input
                id="give-access-role"
                data-testid="give-access-role"
                value={roleTitle(fixed.roleKey)}
                disabled
              />
            ) : (
              <MultiSelect values={roleKeys} onValuesChange={setRoleKeys}>
                <MultiSelectTrigger
                  id="give-access-role"
                  data-testid="give-access-role"
                  className="w-full"
                >
                  <MultiSelectValue
                    placeholder={t("access.pickRoles")}
                    overflowBehavior="wrap-when-open"
                  />
                </MultiSelectTrigger>
                <MultiSelectContent
                  search={{
                    placeholder: t("access.searchRoles"),
                    emptyMessage: t("access.noRoles"),
                  }}
                >
                  {roles.map((candidate) => (
                    <MultiSelectItem
                      key={candidate.key}
                      value={candidate.key}
                      data-testid={`give-access-role-${candidate.key}`}
                    >
                      {candidate.title}
                    </MultiSelectItem>
                  ))}
                </MultiSelectContent>
              </MultiSelect>
            )}
            {opensNothing && (
              <p
                role="alert"
                data-testid="give-access-opens-nothing"
                className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300"
              >
                <TriangleAlert
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  aria-hidden
                />
                {t("access.opensNothing", {
                  roles: roleKeys.map(roleTitle).join(", "),
                })}
              </p>
            )}
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
                  setPickedId("");
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

          {picks && (
            <div className="grid gap-1">
              <Label htmlFor="give-access-resource">{pickLabel}</Label>
              <Select value={pickedId} onValueChange={setPickedId}>
                <SelectTrigger
                  id="give-access-resource"
                  data-testid="give-access-resource"
                  className="w-full"
                >
                  <SelectValue
                    placeholder={
                      picksCatalog && catalog === null
                        ? t("common.loading")
                        : options.length
                          ? t("access.appliesTo.choose")
                          : t("access.appliesTo.none")
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
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
          {mode === "workspace" && (
            <p className="text-xs text-muted-foreground">
              {t("access.groupsHint")}
            </p>
          )}
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
              disabled={
                !groupId || !target || roleKeys.length === 0 || saving
              }
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
