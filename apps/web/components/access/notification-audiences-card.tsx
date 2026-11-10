"use client";

import * as React from "react";
import { Bell, Plus, UsersRound, X } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type NotificationAudienceDto,
  type TenantGroupDto,
} from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { useCan } from "@/hooks/use-me";
import { useTranslation } from "@/hooks/use-translation";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

const TYPES = ["SCAN", "FINDING", "SOURCE", "SYSTEM"] as const;
type Kind = (typeof TYPES)[number];

/** Initials for a group badge, from the last segment of its path. */
function groupInitials(path: string): string {
  const tail = path.split("/").filter(Boolean).pop() ?? path;
  const words = tail.split(/[-_\s]+/).filter(Boolean);
  const letters = (words.length > 1
    ? words.slice(0, 2).map((w) => w[0])
    : [tail[0], tail[1]]
  )
    .filter(Boolean)
    .join("");
  return (letters || "?").toUpperCase();
}

/**
 * Who gets each kind of notification in this workspace (docs/prd/IAM §6.4).
 * Notifications go to groups: by default the workspace's owning group; here
 * someone who manages access picks other groups per kind. Each kind shows its
 * groups as user badges — an icon plus the group path, one badge per group —
 * and a removed group keeps its badge marked as removed.
 */
export function NotificationAudiencesCard() {
  const { t } = useTranslation();
  const canManage = useCan("access.manage");
  const [audiences, setAudiences] = React.useState<NotificationAudienceDto[] | null>(null);
  const [groups, setGroups] = React.useState<TenantGroupDto[]>([]);
  const [busy, setBusy] = React.useState<Kind | null>(null);

  const load = React.useCallback(async () => {
    try {
      const [nextAudiences, nextGroups] = await Promise.all([
        api.notifications.notificationsControllerAudiences(),
        api.access.workspaceAccessControllerGroups(),
      ]);
      setAudiences(nextAudiences);
      setGroups(nextGroups);
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("notificationAudiences.loadFailed")));
      setAudiences([]);
    }
  }, [t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const known = (id: string) => groups.some((group) => group.id === id);
  const pathOf = (id: string) =>
    groups.find((group) => group.id === id)?.path ?? t("notificationAudiences.removedGroup");

  const save = async (type: Kind, groupIds: string[]) => {
    setBusy(type);
    try {
      const saved = await api.notifications.notificationsControllerSetAudience({
        type,
        updateNotificationAudienceDto: { groupIds },
      });
      // Re-read from the server rather than trusting the echo: the audience
      // is also recorded in the tenant audit trail, and a re-read keeps the
      // badges in sync with what new notifications will actually use.
      const [nextAudiences] = await Promise.all([
        api.notifications.notificationsControllerAudiences(),
      ]);
      setAudiences(nextAudiences);
      toast.success(t("notificationAudiences.saved"));
      void saved;
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("notificationAudiences.saveFailed")));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="panel-card rounded-[6px]" data-testid="notification-audiences">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4" />
          <p className="text-xs font-mono uppercase tracking-[0.14em]">
            {t("notificationAudiences.title")}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("notificationAudiences.description")}
        </p>
        <ul className="divide-y divide-border rounded-[4px] border border-border">
          {TYPES.map((type) => {
            const chosen = audiences?.find((row) => row.type === type)?.groupIds ?? [];
            const left = groups.filter((group) => !chosen.includes(group.id));
            return (
              <li
                key={type}
                className="flex flex-wrap items-center gap-2 px-3 py-2"
                data-testid={`notification-audience-${type}`}
              >
                <span className="w-24 shrink-0 text-sm font-medium">
                  {t(`notificationAudiences.types.${type}`)}
                </span>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  {chosen.length === 0 ? (
                    <Badge variant="secondary" className="gap-1.5 py-1">
                      <UsersRound className="h-3 w-3" aria-hidden />
                      {t("notificationAudiences.owningGroup")}
                    </Badge>
                  ) : (
                    chosen.map((id) => {
                      const removed = !known(id);
                      return (
                        <Badge
                          key={id}
                          variant={removed ? "destructive" : "outline"}
                          className="gap-1.5 py-1"
                          title={removed ? t("notificationAudiences.removedGroup") : pathOf(id)}
                        >
                          {removed ? (
                            <X className="h-3 w-3" aria-hidden />
                          ) : (
                            <span
                              aria-hidden
                              className="flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground"
                            >
                              {groupInitials(pathOf(id))}
                            </span>
                          )}
                          <UsersRound className="h-3 w-3 text-muted-foreground" aria-hidden />
                          <span className="max-w-[220px] truncate">{pathOf(id)}</span>
                          {canManage && (
                            <button
                              type="button"
                              aria-label={t("notificationAudiences.remove", { group: pathOf(id) })}
                              disabled={busy === type}
                              onClick={() => void save(type, chosen.filter((g) => g !== id))}
                              className="rounded-sm transition-colors hover:text-destructive"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </Badge>
                      );
                    })
                  )}
                </div>
                {canManage && left.length > 0 && (
                  <Select
                    value=""
                    disabled={busy === type || !audiences}
                    onValueChange={(id) => void save(type, [...chosen, id])}
                  >
                    <SelectTrigger
                      className="h-8 w-44"
                      data-testid={`notification-audience-add-${type}`}
                    >
                      <SelectValue placeholder={t("notificationAudiences.add")} />
                    </SelectTrigger>
                    <SelectContent>
                      {left.map((group) => (
                        <SelectItem key={group.id} value={group.id}>
                          <span className="flex items-center gap-2">
                            <span
                              aria-hidden
                              className="flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground"
                            >
                              {groupInitials(group.path)}
                            </span>
                            {group.path}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {canManage && chosen.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === type}
                    onClick={() => void save(type, [])}
                  >
                    <Plus className="h-3 w-3 rotate-45" aria-hidden />
                    {t("notificationAudiences.reset")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
