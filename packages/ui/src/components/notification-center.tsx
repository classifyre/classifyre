"use client";

import * as React from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Bell,
  CheckCheck,
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  X,
} from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import { Badge } from "@workspace/ui/components/badge";
import { getMockNotifications } from "@workspace/ui/mocks/notifications";
import type { MockNotification } from "@workspace/ui/mocks/types";

const severityIcons = {
  CRITICAL: AlertCircle,
  HIGH: AlertTriangle,
  MEDIUM: AlertTriangle,
  LOW: Info,
  INFO: CheckCircle2,
};

const severityColors = {
  CRITICAL: "text-red-600 dark:text-red-400",
  HIGH: "text-orange-600 dark:text-orange-400",
  MEDIUM: "text-yellow-600 dark:text-yellow-400",
  LOW: "text-blue-600 dark:text-blue-400",
  INFO: "text-gray-600 dark:text-gray-400",
};

const severityBgColors = {
  CRITICAL: "bg-red-50 dark:bg-red-950/20",
  HIGH: "bg-orange-50 dark:bg-orange-950/20",
  MEDIUM: "bg-yellow-50 dark:bg-yellow-950/20",
  LOW: "bg-blue-50 dark:bg-blue-950/20",
  INFO: "bg-gray-50 dark:bg-gray-950/20",
};

function NotificationItem({
  notification,
  onRead,
  onDismiss,
}: {
  notification: MockNotification;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const Icon = severityIcons[notification.severity];
  const timeAgo = formatDistanceToNow(notification.createdAt, {
    addSuffix: true,
  });

  return (
    <div
      className={cn(
        "group relative flex gap-3 p-3 transition-colors hover:bg-sidebar-accent",
        !notification.read && severityBgColors[notification.severity],
      )}
    >
      <div className="flex-shrink-0 pt-0.5">
        <Icon
          className={cn("h-5 w-5", severityColors[notification.severity])}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p
              className={cn(
                "text-sm font-medium",
                !notification.read && "font-semibold",
              )}
            >
              {notification.title}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {notification.message}
            </p>
            {notification.sourceName && (
              <p className="text-xs text-muted-foreground mt-1">
                {notification.sourceName}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1">{timeAgo}</p>
          </div>
          {!notification.read && (
            <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mt-1" />
          )}
        </div>
        {notification.actionUrl && (
          <div className="mt-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                onRead(notification.id);
                // Navigate to action URL
                window.location.href = notification.actionUrl!;
              }}
            >
              View
            </Button>
          </div>
        )}
      </div>
      <button
        onClick={() => onDismiss(notification.id)}
        className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-2 right-2 p-1 hover:bg-sidebar-accent rounded"
      >
        <X className="h-4 w-4 text-muted-foreground" />
      </button>
    </div>
  );
}

function groupNotificationsByDate(
  notifications: MockNotification[],
): Array<[string, MockNotification[]]> {
  const groups: Record<string, MockNotification[]> = {
    Today: [],
    Yesterday: [],
    "This Week": [],
    Older: [],
  };

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  notifications.forEach((notification) => {
    const date = notification.createdAt;
    if (date >= today) {
      groups.Today!.push(notification);
    } else if (date >= yesterday) {
      groups.Yesterday!.push(notification);
    } else if (date >= weekAgo) {
      groups["This Week"]!.push(notification);
    } else {
      groups.Older!.push(notification);
    }
  });

  return Object.entries(groups).filter(
    ([, notifications]) => notifications && notifications.length > 0,
  ) as Array<[string, MockNotification[]]>;
}

interface NotificationCenterProps {
  className?: string;
  notifications?: MockNotification[];
  loading?: boolean;
  onMarkAsRead?: (id: string) => void;
  onMarkAllAsRead?: () => void;
  onDismiss?: (id: string) => void;
}

export function NotificationCenter({
  className,
  notifications: notificationsProp,
  loading = false,
  onMarkAsRead,
  onMarkAllAsRead,
  onDismiss,
}: NotificationCenterProps) {
  const [internalNotifications, setInternalNotifications] = React.useState(
    getMockNotifications(),
  );
  const [open, setOpen] = React.useState(false);
  const notifications = notificationsProp ?? internalNotifications;
  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleMarkAsRead = (id: string) => {
    if (onMarkAsRead) {
      onMarkAsRead(id);
      return;
    }
    setInternalNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
  };

  const handleMarkAllAsRead = () => {
    if (onMarkAllAsRead) {
      onMarkAllAsRead();
      return;
    }
    setInternalNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const handleDismiss = (id: string) => {
    if (onDismiss) {
      onDismiss(id);
      return;
    }
    setInternalNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const groupedNotifications = groupNotificationsByDate(notifications);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("relative", className)}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 min-w-5 px-1.5 flex items-center justify-center text-xs"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
          <span className="sr-only">Notifications</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="end">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Notifications</h3>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                {unreadCount} unread
              </Badge>
            )}
          </div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMarkAllAsRead}
              className="h-8 text-xs"
            >
              <CheckCheck className="h-3 w-3 mr-1" />
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-[500px]">
          {loading ? (
            <div className="flex items-center justify-center p-8">
              <span className="text-sm text-muted-foreground">Loading...</span>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <Bell className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-sm font-medium">No notifications</p>
              <p className="text-xs text-muted-foreground mt-1">
                You&apos;re all caught up!
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {groupedNotifications.map(([groupName, groupNotifications]) => (
                <div key={groupName}>
                  <div className="px-4 py-2 bg-sidebar-accent/50">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {groupName}
                    </p>
                  </div>
                  {groupNotifications.map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onRead={handleMarkAsRead}
                      onDismiss={handleDismiss}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
        {notifications.length > 0 && (
          <div className="p-2 border-t">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs"
              onClick={() => {
                // Navigate to full notifications page
                window.location.href = "/notifications";
              }}
            >
              View all notifications
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
