import { type MockScan, type MockScanSchedule } from "./types";

const mockScans: MockScan[] = [
  {
    id: "scan-1",
    name: "Daily Security Scan",
    status: "completed",
    sourceId: "source-1",
    sourceName: "My Project Files",
    detectorIds: ["aws-access-key", "private-key", "credit-card"],
    detectorNames: ["AWS Access Keys", "Private Keys", "Credit Card Numbers"],
    startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    completedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    fileCount: 1240,
    findingCount: 3,
    progress: 100,
    timeElapsed: 3600, // 1 hour in seconds
    scheduleId: "schedule-1",
  },
  {
    id: "scan-2",
    name: "Full Repository Scan",
    status: "running",
    sourceId: "source-2",
    sourceName: "GitHub: company-repo",
    detectorIds: [
      "aws-access-key",
      "private-key",
      "database-credentials",
      "credit-card",
      "us-ssn",
    ],
    detectorNames: [
      "AWS Access Keys",
      "Private Keys",
      "Database Credentials",
      "Credit Card Numbers",
      "US Social Security Numbers",
    ],
    startedAt: new Date(Date.now() - 30 * 60 * 1000),
    fileCount: 856,
    findingCount: 12,
    progress: 65,
    currentFile: "/home/user/projects/src/auth/login.js",
    timeElapsed: 1800, // 30 minutes
    estimatedTimeRemaining: 960, // 16 minutes
  },
  {
    id: "scan-3",
    name: "Weekly Compliance Check",
    status: "queued",
    sourceId: "source-1",
    sourceName: "My Project Files",
    detectorIds: ["credit-card", "us-ssn", "email-address"],
    detectorNames: [
      "Credit Card Numbers",
      "US Social Security Numbers",
      "Email Addresses",
    ],
    scheduledAt: new Date(Date.now() + 5 * 60 * 1000),
    fileCount: 0,
    findingCount: 0,
    progress: 0,
    scheduleId: "schedule-2",
    // startedAt is optional for queued scans
  },
  {
    id: "scan-4",
    name: "WordPress Pages Scan",
    status: "failed",
    sourceId: "source-6",
    sourceName: "WordPress: Engineering Docs",
    detectorIds: ["us-ssn", "email-address"],
    detectorNames: ["US Social Security Numbers", "Email Addresses"],
    startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    completedAt: new Date(Date.now() - 3 * 60 * 60 * 1000 + 5 * 60 * 1000),
    fileCount: 0,
    findingCount: 0,
    progress: 15,
    error: "Authentication failed: Invalid API token",
    timeElapsed: 300, // 5 minutes
  },
  {
    id: "scan-5",
    name: "One-time Security Audit",
    status: "completed",
    sourceId: "source-1",
    sourceName: "My Project Files",
    detectorIds: ["aws-access-key", "private-key"],
    detectorNames: ["AWS Access Keys", "Private Keys"],
    startedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    completedAt: new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000 + 45 * 60 * 1000,
    ),
    fileCount: 1240,
    findingCount: 0,
    progress: 100,
    timeElapsed: 2700, // 45 minutes
  },
];

export const mockSchedules: MockScanSchedule[] = [
  {
    id: "schedule-1",
    name: "Daily Security Scan",
    sourceId: "source-1",
    sourceName: "My Project Files",
    frequency: "daily",
    time: "02:00",
    timezone: "UTC",
    enabled: true,
    nextRunAt: new Date(Date.now() + 8 * 60 * 60 * 1000), // 8 hours from now
    lastRunAt: new Date(Date.now() - 16 * 60 * 60 * 1000), // 16 hours ago
    detectorIds: ["aws-access-key", "private-key", "credit-card"],
  },
  {
    id: "schedule-2",
    name: "Weekly Compliance Check",
    sourceId: "source-1",
    sourceName: "My Project Files",
    frequency: "weekly",
    time: "03:00",
    timezone: "UTC",
    daysOfWeek: [1], // Monday
    enabled: true,
    nextRunAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
    lastRunAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    detectorIds: ["credit-card", "us-ssn", "email-address"],
  },
  {
    id: "schedule-3",
    name: "Hourly Quick Scan",
    sourceId: "source-2",
    sourceName: "GitHub: company-repo",
    frequency: "hourly",
    enabled: false,
    nextRunAt: undefined,
    lastRunAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    detectorIds: ["aws-access-key"],
  },
];

export function getMockScans(filters?: {
  status?: MockScan["status"];
  sourceId?: string;
}): MockScan[] {
  let filtered = [...mockScans];

  if (filters?.status) {
    filtered = filtered.filter((s) => s.status === filters.status);
  }

  if (filters?.sourceId) {
    filtered = filtered.filter((s) => s.sourceId === filters.sourceId);
  }

  return filtered;
}

export function getMockScanById(id: string): MockScan | undefined {
  return mockScans.find((s) => s.id === id);
}

export function getMockSchedules(filters?: {
  enabled?: boolean;
  sourceId?: string;
}): MockScanSchedule[] {
  let filtered = [...mockSchedules];

  if (filters?.enabled !== undefined) {
    filtered = filtered.filter((s) => s.enabled === filters.enabled);
  }

  if (filters?.sourceId) {
    filtered = filtered.filter((s) => s.sourceId === filters.sourceId);
  }

  return filtered;
}

export function getMockScheduleById(id: string): MockScanSchedule | undefined {
  return mockSchedules.find((s) => s.id === id);
}
