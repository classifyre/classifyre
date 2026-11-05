"use client";

import * as React from "react";
import { Copy, KeyRound, MoreHorizontal, UserMinus, UserPlus, Users } from "lucide-react";
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
import { Checkbox } from "@workspace/ui/components/checkbox";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import { useTranslation } from "@/hooks/use-translation";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

export function personName(person: PersonDto): string {
  const full = [person.firstName, person.lastName].filter(Boolean).join(" ");
  return full || person.email || person.username;
}

/**
 * Everyone in the tenant (docs/prd step 8c): add people, put them in groups,
 * give an account made here a new temporary password, remove them. With
 * `editable` off (a company directory owns membership) it only lists.
 */
export function TenantPeople({
  people,
  groups,
  editable,
  onChanged,
}: {
  people: PersonDto[];
  groups: TenantGroupDto[];
  editable: boolean;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState<PersonDto | null>(null);
  const [removing, setRemoving] = React.useState<PersonDto | null>(null);
  const [password, setPassword] = React.useState<{
    person: string;
    value: string;
  } | null>(null);
  const groupPath = (id: string) =>
    groups.find((group) => group.id === id)?.path ?? id;

  const resetPassword = async (person: PersonDto) => {
    try {
      const { temporaryPassword } =
        await api.access.tenantPeopleControllerResetPassword({ userId: person.id });
      setPassword({ person: personName(person), value: temporaryPassword });
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.people.failed")));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs text-muted-foreground">
          {editable ? t("access.people.description") : t("access.people.readOnly")}
        </p>
        {editable && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <UserPlus className="h-4 w-4" />
            {t("access.people.add")}
          </Button>
        )}
      </div>

      <div className="rounded-[4px] border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("access.people.name")}</TableHead>
              <TableHead>{t("access.people.groups")}</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.map((person) => (
              <TableRow key={person.id}>
                <TableCell>
                  <p className="font-medium">
                    {personName(person)}
                    {person.isYou && (
                      <span className="text-muted-foreground"> · {t("access.people.you")}</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {person.email ?? person.username}
                    {person.fromDirectory && ` · ${t("access.people.fromDirectory")}`}
                    {!person.enabled && ` · ${t("access.people.disabled")}`}
                  </p>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {person.groupIds.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        {t("access.people.noGroups")}
                      </span>
                    ) : (
                      person.groupIds.map((id) => (
                        <Badge key={id} variant="outline">
                          {groupPath(id)}
                        </Badge>
                      ))
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {editable && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t("access.people.actions", { name: personName(person) })}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing(person)}>
                          <Users className="h-4 w-4" />
                          {t("access.people.editGroups")}
                        </DropdownMenuItem>
                        {person.createdHere && !person.isYou && (
                          <DropdownMenuItem onSelect={() => void resetPassword(person)}>
                            <KeyRound className="h-4 w-4" />
                            {t("access.people.newPassword")}
                          </DropdownMenuItem>
                        )}
                        {!person.isYou && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setRemoving(person)}
                            >
                              <UserMinus className="h-4 w-4" />
                              {t("access.people.remove")}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AddPersonDialog
        open={adding}
        onOpenChange={setAdding}
        onAdded={async (person, temporaryPassword) => {
          await onChanged();
          if (temporaryPassword) {
            setPassword({ person: personName(person), value: temporaryPassword });
          } else {
            toast.success(t("access.people.addedExisting", { name: personName(person) }));
          }
        }}
      />
      <EditGroupsDialog
        person={editing}
        groups={groups}
        onClose={() => setEditing(null)}
        onSaved={onChanged}
      />
      <RemovePersonDialog
        person={removing}
        onClose={() => setRemoving(null)}
        onRemoved={onChanged}
      />
      <PasswordDialog password={password} onClose={() => setPassword(null)} />
    </div>
  );
}

function AddPersonDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (person: PersonDto, temporaryPassword: string | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = React.useState("");
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setEmail("");
      setFirstName("");
      setLastName("");
    }
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const added = await api.access.tenantPeopleControllerAdd({
        addPersonDto: { email, firstName, lastName },
      });
      onOpenChange(false);
      await onAdded(added.person, added.temporaryPassword ?? null);
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.people.addFailed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[6px] border-2 border-border">
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("access.people.addTitle")}</DialogTitle>
            <DialogDescription>{t("access.people.addDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1">
            <Label htmlFor="person-email">{t("access.people.email")}</Label>
            <Input
              id="person-email"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="person-first">{t("access.people.firstName")}</Label>
              <Input
                id="person-first"
                required
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="person-last">{t("access.people.lastName")}</Label>
              <Input
                id="person-last"
                required
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {t("access.people.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Ticks the groups a person should be in; saving adds and removes the difference. */
function EditGroupsDialog({
  person,
  groups,
  onClose,
  onSaved,
}: {
  person: PersonDto | null;
  groups: TenantGroupDto[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setChosen(new Set(person?.groupIds ?? []));
  }, [person]);

  const save = async () => {
    if (!person) return;
    setSaving(true);
    const before = new Set(person.groupIds);
    try {
      for (const group of groups) {
        if (chosen.has(group.id) && !before.has(group.id)) {
          await api.access.tenantPeopleControllerAddMember({
            groupId: group.id,
            userId: person.id,
          });
        } else if (!chosen.has(group.id) && before.has(group.id)) {
          await api.access.tenantPeopleControllerRemoveMember({
            groupId: group.id,
            userId: person.id,
          });
        }
      }
      toast.success(t("access.people.groupsSaved", { name: personName(person) }));
      onClose();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.people.failed")));
    } finally {
      setSaving(false);
      await onSaved();
    }
  };

  return (
    <Dialog open={person !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rounded-[6px] border-2 border-border">
        <DialogHeader>
          <DialogTitle>
            {person ? t("access.people.groupsOf", { name: personName(person) }) : ""}
          </DialogTitle>
          <DialogDescription>{t("access.people.groupsDescription")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {groups.map((group) => (
            <label
              key={group.id}
              className="flex cursor-pointer items-center gap-3 rounded-[4px] px-2 py-1.5 text-sm hover:bg-muted/40"
            >
              <Checkbox
                checked={chosen.has(group.id)}
                onCheckedChange={(checked) =>
                  setChosen((current) => {
                    const next = new Set(current);
                    if (checked === true) next.add(group.id);
                    else next.delete(group.id);
                    return next;
                  })
                }
              />
              <span className="font-mono text-xs">{group.path}</span>
            </label>
          ))}
          {groups.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("access.groups.none")}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemovePersonDialog({
  person,
  onClose,
  onRemoved,
}: {
  person: PersonDto | null;
  onClose: () => void;
  onRemoved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = React.useState(false);

  const remove = async () => {
    if (!person) return;
    setBusy(true);
    try {
      const { accountDeleted } = await api.access.tenantPeopleControllerRemove({
        userId: person.id,
      });
      toast.success(
        t(accountDeleted ? "access.people.removedDeleted" : "access.people.removed", {
          name: personName(person),
        }),
      );
      onClose();
      await onRemoved();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.people.failed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={person !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="rounded-[6px] border-2 border-border">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {person ? t("access.people.removeTitle", { name: personName(person) }) : ""}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {person?.createdHere
              ? t("access.people.removeCreatedHere")
              : t("access.people.removeDescription")}
          </AlertDialogDescription>
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
            {t("access.people.remove")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** A temporary password, shown once: Classifyre does not keep it. */
function PasswordDialog({
  password,
  onClose,
}: {
  password: { person: string; value: string } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={password !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rounded-[6px] border-2 border-border">
        <DialogHeader>
          <DialogTitle>{t("access.people.passwordTitle")}</DialogTitle>
          <DialogDescription>
            {password ? t("access.people.passwordDescription", { name: password.person }) : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input readOnly value={password?.value ?? ""} className="font-mono" aria-label={t("access.people.passwordTitle")} />
          <Button
            variant="outline"
            aria-label={t("access.people.copy")}
            onClick={() => {
              if (!password) return;
              void navigator.clipboard
                .writeText(password.value)
                .then(() => toast.success(t("access.people.copied")));
            }}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t("common.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
