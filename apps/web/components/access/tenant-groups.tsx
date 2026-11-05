"use client";

import * as React from "react";
import { FolderPlus, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type PersonDto,
  type TenantGroupDto,
} from "@workspace/api-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { useTranslation } from "@/hooks/use-translation";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import { personName } from "./tenant-people";

/** The top-level group every tenant finds its first admins in; fixed. */
function isAdmins(group: TenantGroupDto): boolean {
  return group.parentId === null && group.name === "admins";
}

/** Groups in tree order, each with its depth. */
function inTreeOrder(groups: TenantGroupDto[]): { group: TenantGroupDto; depth: number }[] {
  const out: { group: TenantGroupDto; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number) => {
    groups
      .filter((group) => group.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((group) => {
        out.push({ group, depth });
        visit(group.id, depth + 1);
      });
  };
  visit(null, 0);
  return out;
}

type Editing =
  | { kind: "create"; parent: TenantGroupDto | null }
  | { kind: "rename"; group: TenantGroupDto };

/**
 * The tenant's groups, nested (docs/prd step 8c). Who is in a group is
 * changed on the People tab; what a group may do, on the Access tab.
 */
export function TenantGroups({
  groups,
  people,
  editable,
  onChanged,
}: {
  groups: TenantGroupDto[];
  people: PersonDto[];
  editable: boolean;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = React.useState<Editing | null>(null);
  const [deleting, setDeleting] = React.useState<TenantGroupDto | null>(null);
  const membersOf = (groupId: string) =>
    people.filter((person) => person.groupIds.includes(groupId));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs text-muted-foreground">
          {editable ? t("access.groups.description") : t("access.groups.readOnly")}
        </p>
        {editable && (
          <Button size="sm" onClick={() => setEditing({ kind: "create", parent: null })}>
            <Plus className="h-4 w-4" />
            {t("access.groups.new")}
          </Button>
        )}
      </div>

      <ul className="divide-y divide-border rounded-[4px] border border-border">
        {inTreeOrder(groups).map(({ group, depth }) => {
          const members = membersOf(group.id);
          return (
            <li
              key={group.id}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              style={{ paddingLeft: `${0.75 + depth * 1.5}rem` }}
            >
              <div className="min-w-0 space-y-0.5">
                <p className="font-medium">
                  {group.name}
                  {isAdmins(group) && (
                    <Badge variant="outline" className="ml-2">
                      {t("access.groups.adminsBadge")}
                    </Badge>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {members.length === 0
                    ? t("access.groups.empty")
                    : members.map(personName).join(", ")}
                </p>
              </div>
              {editable && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t("access.groups.actions", { name: group.path })}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => setEditing({ kind: "create", parent: group })}
                    >
                      <FolderPlus className="h-4 w-4" />
                      {t("access.groups.newInside")}
                    </DropdownMenuItem>
                    {!isAdmins(group) && (
                      <>
                        <DropdownMenuItem
                          onSelect={() => setEditing({ kind: "rename", group })}
                        >
                          <Pencil className="h-4 w-4" />
                          {t("access.groups.rename")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setDeleting(group)}
                        >
                          <Trash2 className="h-4 w-4" />
                          {t("access.groups.delete")}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          );
        })}
        {groups.length === 0 && (
          <li className="px-3 py-4 text-center text-sm text-muted-foreground">
            {t("access.groups.none")}
          </li>
        )}
      </ul>

      <GroupNameDialog editing={editing} onClose={() => setEditing(null)} onSaved={onChanged} />
      <DeleteGroupDialog group={deleting} onClose={() => setDeleting(null)} onDeleted={onChanged} />
    </div>
  );
}

function GroupNameDialog({
  editing,
  onClose,
  onSaved,
}: {
  editing: Editing | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setName(editing?.kind === "rename" ? editing.group.name : "");
  }, [editing]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      if (editing.kind === "create") {
        await api.access.tenantPeopleControllerCreateGroup({
          createGroupDto: { name, parentId: editing.parent?.id ?? null },
        });
        toast.success(t("access.groups.created", { name }));
      } else {
        await api.access.tenantPeopleControllerRenameGroup({
          groupId: editing.group.id,
          renameGroupDto: { name },
        });
        toast.success(t("access.groups.renamed", { name }));
      }
      onClose();
      await onSaved();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.groups.failed")));
    } finally {
      setSaving(false);
    }
  };

  const title =
    editing?.kind === "rename"
      ? t("access.groups.renameTitle", { name: editing.group.path })
      : editing?.parent
        ? t("access.groups.newInsideTitle", { name: editing.parent.path })
        : t("access.groups.newTitle");

  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rounded-[6px] border-2 border-border">
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{t("access.groups.nameHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1">
            <Label htmlFor="group-name">{t("access.groups.name")}</Label>
            <Input
              id="group-name"
              required
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteGroupDialog({
  group,
  onClose,
  onDeleted,
}: {
  group: TenantGroupDto | null;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = React.useState(false);

  const remove = async () => {
    if (!group) return;
    setBusy(true);
    try {
      await api.access.tenantPeopleControllerDeleteGroup({ groupId: group.id });
      toast.success(t("access.groups.deleted", { name: group.path }));
      onClose();
      await onDeleted();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.groups.failed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={group !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="rounded-[6px] border-2 border-border">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {group ? t("access.groups.deleteTitle", { name: group.path }) : ""}
          </AlertDialogTitle>
          <AlertDialogDescription>{t("access.groups.deleteDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              void remove();
            }}
          >
            {t("access.groups.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
