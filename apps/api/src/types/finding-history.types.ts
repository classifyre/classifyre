import { FindingStatus, Severity } from '@prisma/client';

export enum HistoryEventType {
  DETECTED = 'DETECTED', // First detection
  RE_DETECTED = 'RE_DETECTED', // Found in subsequent scan
  RESOLVED = 'RESOLVED', // No longer present
  STATUS_CHANGED = 'STATUS_CHANGED', // Manual status change
  SEVERITY_CHANGED = 'SEVERITY_CHANGED', // Manual severity change
  RE_OPENED = 'RE_OPENED', // Resolved detection found again
}

export interface FindingHistoryEntry {
  timestamp: Date;
  runnerId: string;
  eventType: HistoryEventType;
  status: FindingStatus;
  severity?: Severity;
  confidence?: number;
  location?: any;
  changedBy?: string;
  changeReason?: string;
}
