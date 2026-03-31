"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  type NotificationResponseDto,
  NotificationResponseDtoTypeEnum,
} from "@workspace/api-client";
import {
  Badge,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  SeverityBadge,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import {
  ArrowUpRight,
  Bell,
  CheckCheck,
  Clock3,
  Loader2,
  Star,
  StarOff,
  Trash2,
} from "lucide-react";
import { formatRelative } from "@/lib/date";
import { useNotificationsWebSocket } from "@/hooks/use-notifications-websocket";
import { useTranslation } from "@/hooks/use-translation";

type ListNotificationsRequest = NonNullable<
  Parameters<
    typeof api.notifications.notificationsControllerListNotifications
  >[0]
>;

const TAKE = 12;
const TYPE_LABELS: Record<NotificationResponseDto["type"], string> = {
  [NotificationResponseDtoTypeEnum.Scan]: "Scan",
  [NotificationResponseDtoTypeEnum.Finding]: "Finding",
  [NotificationResponseDtoTypeEnum.Source]: "Source",
  [NotificationResponseDtoTypeEnum.System]: "System",
};
const SEVERITY_BADGE_VARIANT: Record<
  NotificationResponseDto["severity"],
  "critical" | "high" | "medium" | "low" | "info"
> = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  INFO: "info",
};

function formatEnumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

export function NotificationCenter() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationResponseDto[]>(
    [],
  );
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);

      const request: ListNotificationsRequest = {
        skip: 0,
        take: TAKE,
      };

      const response =
        await api.notifications.notificationsControllerListNotifications(
          request,
        );
      setNotifications(response.notifications ?? []);
      setTotal(response.total ?? 0);
      setUnreadCount(response.unreadCount ?? 0);
    } catch (error) {
      console.error("Failed to load notifications", error);
      setNotifications([]);
      setTotal(0);
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  useNotificationsWebSocket({
    onChange: fetchNotifications,
  });

  const handleMarkAsRead = useCallback(
    async (id: string) => {
      try {
        const target = notifications.find((item) => item.id === id);
        if (!target) return;

        await api.notifications.notificationsControllerMarkRead({ id });
        setNotifications((previous) =>
          previous.map((item) =>
            item.id === id ? { ...item, read: true } : item,
          ),
        );

        if (!target.read) {
          setUnreadCount((previous) => Math.max(0, previous - 1));
        }
      } catch (error) {
        console.error("Failed to mark notification as read", error);
      }
    },
    [notifications],
  );

  const handleMarkAllAsRead = useCallback(async () => {
    try {
      await api.notifications.notificationsControllerMarkAllRead({
        markAllReadDto: {},
      });
      setNotifications((previous) =>
        previous.map((item) => ({ ...item, read: true })),
      );
      setUnreadCount(0);
    } catch (error) {
      console.error("Failed to mark all notifications as read", error);
    }
  }, []);

  const handleDismiss = useCallback(
    async (id: string) => {
      try {
        const target = notifications.find((item) => item.id === id);
        await api.notifications.notificationsControllerDeleteNotification({
          id,
        });

        setNotifications((previous) =>
          previous.filter((item) => item.id !== id),
        );
        setTotal((previous) => Math.max(0, previous - 1));

        if (target && !target.read) {
          setUnreadCount((previous) => Math.max(0, previous - 1));
        }
      } catch (error) {
        console.error("Failed to delete notification", error);
      }
    },
    [notifications],
  );

  const handleToggleImportant = useCallback(
    async (notification: NotificationResponseDto) => {
      try {
        await api.notifications.notificationsControllerSetImportant({
          id: notification.id,
          updateNotificationImportanceDto: {
            important: !notification.important,
          },
        });

        setNotifications((previous) =>
          previous.map((item) =>
            item.id === notification.id
              ? { ...item, important: !item.important }
              : item,
          ),
        );
      } catch (error) {
        console.error("Failed to update notification importance", error);
      }
    },
    [],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-[4px] border-2 border-transparent hover:border-border"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge className="absolute -right-2 -top-2 min-w-5 rounded-[3px] border border-border bg-accent px-1.5 text-[10px] font-mono text-accent-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
          <span className="sr-only">{t("notifications.title")}</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="flex h-[min(70vh,560px)] w-[min(420px,calc(100vw-1rem))] flex-col overflow-hidden rounded-[6px] border-2 border-border bg-card p-0 shadow-[6px_6px_0_var(--color-border)]"
      >
        <div className="shrink-0 flex items-center justify-between gap-2 border-b-2 border-border bg-foreground px-4 py-3 text-primary-foreground">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-primary-foreground/70">
              Signal Feed
            </p>
            <h3 className="text-sm font-semibold uppercase tracking-[0.08em]">
              {t("notifications.title")}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Badge className="rounded-[3px] border border-primary-foreground bg-accent px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.12em] text-accent-foreground">
                {unreadCount} unread
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 rounded-[4px] border border-primary-foreground/40 px-2 text-[10px] font-mono uppercase tracking-[0.12em] hover:bg-primary-foreground/10"
              onClick={() => void handleMarkAllAsRead()}
              disabled={unreadCount === 0}
            >
              <CheckCheck className="mr-1 h-3.5 w-3.5" />
              Mark all
            </Button>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {loading ? (
            <div className="flex items-center justify-center p-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="ml-2 text-sm">{t("notifications.loading")}</span>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
              <Bell className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium">
                {t("notifications.noNotifications")}
              </p>
              <p className="text-xs text-muted-foreground">
                You are fully caught up.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {notifications.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "space-y-2 overflow-hidden p-3 transition-colors hover:bg-muted/40",
                    !item.read && "bg-muted/20",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <SeverityBadge
                          severity={SEVERITY_BADGE_VARIANT[item.severity]}
                        >
                          {formatEnumLabel(item.severity)}
                        </SeverityBadge>
                        <Badge
                          variant="outline"
                          className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.12em]"
                        >
                          {TYPE_LABELS[item.type]}
                        </Badge>
                        {!item.read && (
                          <Badge className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.12em]">
                            Unread
                          </Badge>
                        )}
                      </div>

                      <p className="break-words text-sm font-semibold leading-tight">
                        {item.title}
                      </p>
                      <p className="break-words text-xs text-muted-foreground">
                        {item.message}
                      </p>

                      <div className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Clock3 className="h-3.5 w-3.5" />
                        {formatRelative(item.createdAt)}
                        {item.sourceName ? ` · ${item.sourceName}` : ""}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      {!item.read && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 rounded-[4px] border-2 border-border px-2 text-[10px] font-mono uppercase tracking-[0.12em]"
                          onClick={() => void handleMarkAsRead(item.id)}
                        >
                          Read
                        </Button>
                      )}

                      <Button
                        size="icon"
                        variant="outline"
                        className="h-7 w-7 rounded-[4px] border-2 border-border"
                        onClick={() => void handleToggleImportant(item)}
                        aria-label={
                          item.important ? "Remove important" : "Mark important"
                        }
                      >
                        {item.important ? (
                          <StarOff className="h-3.5 w-3.5" />
                        ) : (
                          <Star className="h-3.5 w-3.5" />
                        )}
                      </Button>

                      {item.actionUrl ? (
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7 rounded-[4px] border-2 border-border"
                          onClick={() => {
                            window.location.href = item.actionUrl ?? "/";
                          }}
                          aria-label={t("notifications.openAction")}
                        >
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}

                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 rounded-[4px]"
                        onClick={() => void handleDismiss(item.id)}
                        aria-label={t("notifications.dismiss")}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="shrink-0 flex items-center justify-between border-t-2 border-border px-3 py-2">
          <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
            Showing {Math.min(notifications.length, total)} of {total}
          </p>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 rounded-[4px] border-2 border-border px-3"
          >
            <Link href="/notifications" onClick={() => setOpen(false)}>
              Go to notifications center
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
