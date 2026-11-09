"use client";

import * as React from "react";
import { Bell, X } from "lucide-react";
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

/**
 * Who gets each kind of notification in this workspace (docs/prd/IAM §6.4).
 * Notifications go to groups: by default the workspace's owning group; here
 * someone who manages access picks other groups per kind. A notification
 * keeps the groups it was sent to, so a change applies to new ones.
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

  const pathOf = (id: string) =>
    groups.find((group) => group.id === id)?.path ?? t("notificationAudiences.removedGroup");

  const save = async (type: Kind, groupIds: string[]) => {
    setBusy(type);
    try {
      const saved = await api.notifications.notificationsControllerSetAudience({
        type,
        updateNotificationAudienceDto: { groupIds },
      });
      setAudiences((current) =>
        (current ?? []).map((row) => (row.type === type ? saved : row)),
      );
      toast.success(t("notificationAudiences.saved"));
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
                    <Badge variant="secondary">{t("notificationAudiences.owningGroup")}</Badge>
                  ) : (
                    chosen.map((id) => (
                      <Badge key={id} variant="outline" className="gap-1">
                        {pathOf(id)}
                        {canManage && (
                          <button
                            type="button"
                            aria-label={t("notificationAudiences.remove", { group: pathOf(id) })}
                            disabled={busy === type}
                            onClick={() => void save(type, chosen.filter((g) => g !== id))}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </Badge>
                    ))
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
                          {group.path}
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
