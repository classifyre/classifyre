export interface MockFinding {
  id: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  status: "new" | "open" | "resolved" | "false_positive" | "ignored";
  detectorId: string;
  detectorName: string;
  category: "security" | "privacy" | "compliance" | "content" | "threat";
  message: string;
  filePath: string;
  lineNumber: number;
  columnStart: number;
  columnEnd: number;
  matchedContent: string;
  contextBefore: string;
  contextAfter: string;
  sourceType:
    | "filesystem"
    | "github"
    | "s3"
    | "database"
    | "wordpress"
    | "slack"
    | "postgresql"
    | "mysql";
  sourceName: string;
  confidence: number;
  detectedAt: Date;
  resolvedAt?: Date;
  metadata: Record<string, unknown>;
}

export interface MockSource {
  id: string;
  name: string;
  type:
    | "filesystem"
    | "github"
    | "s3"
    | "database"
    | "wordpress"
    | "slack"
    | "postgresql"
    | "mysql";
  path: string;
  status: "healthy" | "error" | "pending";
  lastScan?: Date;
  fileCount?: number;
  findingCount?: number;
  config: Record<string, unknown>;
}

export interface MockDetector {
  id: string;
  name: string;
  description: string;
  category: "security" | "privacy" | "compliance" | "content" | "threat";
  severity: "critical" | "high" | "medium" | "low" | "info";
  patternCount: number;
  accuracy: number;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface MockScan {
  id: string;
  name: string;
  status: "queued" | "running" | "completed" | "failed";
  sourceId: string;
  sourceName?: string;
  detectorIds: string[];
  detectorNames?: string[];
  startedAt?: Date; // Optional for queued scans
  completedAt?: Date;
  scheduledAt?: Date;
  fileCount: number;
  findingCount: number;
  progress: number;
  currentFile?: string;
  timeElapsed?: number;
  estimatedTimeRemaining?: number;
  scheduleId?: string;
  error?: string;
}

export interface MockScanSchedule {
  id: string;
  name: string;
  sourceId: string;
  sourceName?: string;
  frequency: "once" | "hourly" | "daily" | "weekly" | "monthly";
  time?: string;
  timezone?: string;
  daysOfWeek?: number[];
  dayOfMonth?: number;
  enabled: boolean;
  nextRunAt?: Date;
  lastRunAt?: Date;
  detectorIds: string[];
}

export interface MockNotification {
  id: string;
  type: "FINDING" | "SCAN" | "SOURCE" | "SYSTEM";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  title: string;
  message: string;
  sourceName?: string;
  read: boolean;
  important?: boolean;
  createdAt: Date;
  actionUrl?: string;
}

export interface MockUser {
  id: string;
  email: string;
  name: string;
  role: "security" | "compliance" | "platform" | "admin";
  avatar?: string;
  createdAt: Date;
  lastLoginAt: Date;
}

export interface MockUserPreferences {
  userId: string;
  theme: "light" | "dark" | "system";
  emailNotifications: {
    criticalFindings: boolean;
    highFindings: boolean;
    mediumLowFindings: boolean;
    scanCompletion: boolean;
    sourceFailures: boolean;
    weeklyDigest: boolean;
  };
  slackIntegration: {
    enabled: boolean;
    webhookUrl: string;
    channels: {
      criticalFindings: string;
      dailySummary: string;
    };
  };
}

export interface MockApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt?: Date;
  expiresAt?: Date;
  usageCount: number;
  isActive: boolean;
}

export interface MockReport {
  id: string;
  name: string;
  type: "security" | "compliance" | "summary" | "executive" | "custom";
  format: "pdf" | "csv" | "json";
  generatedAt: Date;
  findings: number;
  sources: number;
  fileSize: number; // bytes
  downloadUrl: string;
}

export interface MockGlossaryTerm {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  category: string;
  filterMapping: Record<string, string[]>;
  color?: string;
  icon?: string;
  isActive: boolean;
  findingCount: number;
  metricCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockMetricDefinition {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  type: "SIMPLE" | "RATIO" | "DERIVED" | "TREND";
  status: "DRAFT" | "ACTIVE" | "DEPRECATED";
  definition: Record<string, unknown>;
  allowedDimensions: string[];
  format: string;
  unit: string;
  owner: string;
  certifiedBy?: string;
  certifiedAt?: Date;
  currentValue: number | null;
  glossaryTermSlug?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockMetricResult {
  metricSlug: string;
  value: number | null;
  breakdown: { dimensionValue: string; value: number }[];
}

export interface MockDashboardPlacement {
  id: string;
  metricSlug: string;
  dashboard: string;
  position: number;
  size: "sm" | "md" | "lg" | "xl";
  chartType: string;
}
