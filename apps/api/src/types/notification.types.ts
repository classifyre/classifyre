export enum NotificationType {
  SCAN = 'SCAN',
  FINDING = 'FINDING',
  SOURCE = 'SOURCE',
  SYSTEM = 'SYSTEM',
}

export enum NotificationEvent {
  SCAN_FAILED = 'scan.failed',
  SCAN_RECOVERED = 'scan.recovered',
  FINDINGS_SPIKE = 'findings.spike',
  FINDINGS_MASS_RESOLVED = 'findings.mass_resolved',
  SOURCE_FIRST_SCAN = 'source.first_scan',
}
