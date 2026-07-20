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
  CASE_ESCALATED = 'case.escalated',
  // Autopilot changed a source's editable (detector/sampling/…) config.
  SOURCE_CONFIG_CHANGED = 'source.config_changed',
  // Autopilot triggered a re-scan of a source (e.g. to apply a config change).
  SOURCE_AUTOPILOT_RESCAN = 'source.autopilot_rescan',
}
