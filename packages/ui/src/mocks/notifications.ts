import type { MockNotification } from "./types";

export function getMockNotifications(): MockNotification[] {
  return [
    {
      id: "1",
      type: "SCAN",
      severity: "HIGH",
      title: "Confluence scan failed (3rd consecutive failure)",
      message: "Authentication failed — check the source credentials.",
      sourceName: "Confluence: Engineering Docs",
      important: true,
      read: false,
      createdAt: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago
      actionUrl: "/scans/runner-abc-1",
    },
    {
      id: "2",
      type: "FINDING",
      severity: "HIGH",
      title: "Unusual spike in findings for Jira",
      message: "87 findings detected — 4.3× more than usual (avg: 20).",
      sourceName: "Jira: Product Board",
      important: true,
      read: false,
      createdAt: new Date(Date.now() - 45 * 60 * 1000), // 45 minutes ago
      actionUrl: "/scans/runner-abc-2",
    },
    {
      id: "3",
      type: "SCAN",
      severity: "INFO",
      title: "SharePoint is back online",
      message: "Recovered after 2 failed scans.",
      sourceName: "SharePoint: HR Portal",
      read: false,
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      actionUrl: "/scans/runner-abc-3",
    },
    {
      id: "4",
      type: "SOURCE",
      severity: "INFO",
      title: "First scan complete for Google Drive",
      message: "312 assets indexed.",
      sourceName: "Google Drive: Design Assets",
      read: false,
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago
      actionUrl: "/sources/source-xyz-1",
    },
    {
      id: "5",
      type: "FINDING",
      severity: "MEDIUM",
      title: "Large drop in findings for Confluence",
      message: "65 fewer findings than last scan — verify this is expected.",
      sourceName: "Confluence: Engineering Docs",
      important: true,
      read: false,
      createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
      actionUrl: "/findings?source=source-xyz-2&status=RESOLVED",
    },
    {
      id: "6",
      type: "SCAN",
      severity: "HIGH",
      title: "Jira scan failed",
      message: "Could not reach the source — check network connectivity.",
      sourceName: "Jira: Product Board",
      important: true,
      read: true,
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
      actionUrl: "/scans/runner-abc-4",
    },
  ];
}

export function getUnreadNotificationCount(): number {
  return getMockNotifications().filter((n) => !n.read).length;
}
