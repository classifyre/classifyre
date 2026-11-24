export enum NotificationType {
  SCAN = 'SCAN',
  FINDING = 'FINDING',
  SOURCE = 'SOURCE',
  SYSTEM = 'SYSTEM',
  GOVERNANCE = 'GOVERNANCE',
}

export enum NotificationEvent {
  SCAN_FAILED = 'scan.failed',
  SCAN_RECOVERED = 'scan.recovered',
  FINDINGS_SPIKE = 'findings.spike',
  FINDINGS_MASS_RESOLVED = 'findings.mass_resolved',
  SOURCE_FIRST_SCAN = 'source.first_scan',
  CASE_ESCALATED = 'case.escalated',
  // A case's escalation rules marked findings a watch brought in by itself.
  // Distinct from CASE_ESCALATED, which the autopilot's escalation agent
  // raises and deduplicates on: a rule firing must not mute the agent.
  CASE_FINDINGS_ESCALATED = 'case.findings_escalated',
  // Autopilot changed a source's editable (detector/sampling/…) config.
  SOURCE_CONFIG_CHANGED = 'source.config_changed',
  // A standing inquiry gained unseen matches after a run.
  INQUIRY_NEW_MATCHES = 'inquiry.new_matches',
  // Autopilot triggered a re-scan of a source (e.g. to apply a config change).
  SOURCE_AUTOPILOT_RESCAN = 'source.autopilot_rescan',
  // The adaptive scheduler stopped running a source after repeated failures.
  SOURCE_SCHEDULE_PAUSED = 'source.schedule_paused',
  // The adaptive scheduler's cadence for a source changed materially (e.g. a
  // sweep finished, or an agent pinned a different interval).
  SOURCE_SCHEDULE_CHANGED = 'source.schedule_changed',
  // Governance (GOV G-5): to the person or group named, or to an asset's
  // owner and stewards.
  GOVERNANCE_ROLE_ASSIGNED = 'governance.role_assigned',
  GOVERNANCE_QUALITY_FAILING = 'governance.quality_failing',
  GOVERNANCE_STATUS_CHANGED = 'governance.status_changed',
  // SQL connections (docs/prd/DQ-data-query.md §5.7): to the connection's person.
  GOVERNANCE_CONNECTION_ISSUED = 'governance.connection_issued',
  GOVERNANCE_CONNECTION_REVOKED = 'governance.connection_revoked',
  GOVERNANCE_CONNECTION_BLOCKED = 'governance.connection_blocked',
  // Access requests (DQ §5.9): to whoever decides, then to the requester.
  GOVERNANCE_ACCESS_REQUESTED = 'governance.access_requested',
  GOVERNANCE_ACCESS_DECIDED = 'governance.access_decided',
  // Shared datasets (DQ §5.12): to the owners and stewards of the tables a
  // dataset reads, and to the dataset's own owner and stewards.
  GOVERNANCE_DATASET_SHARED = 'governance.dataset_shared',
  GOVERNANCE_DATASET_BLOCKED = 'governance.dataset_blocked',
  GOVERNANCE_DATASET_UNBLOCKED = 'governance.dataset_unblocked',
  GOVERNANCE_DATASET_UNAVAILABLE = 'governance.dataset_unavailable',
  // Data requests (docs/prd/DR-data-requests.md): to the routed data-team group
  // or the requester as the request progresses.
  GOVERNANCE_DATA_REQUEST_SUBMITTED = 'governance.data_request_submitted',
  GOVERNANCE_DATA_REQUEST_ASSIGNED = 'governance.data_request_assigned',
  GOVERNANCE_DATA_REQUEST_DELIVERED = 'governance.data_request_delivered',
  GOVERNANCE_DATA_REQUEST_CHANGES_REQUESTED = 'governance.data_request_changes_requested',
  GOVERNANCE_DATA_REQUEST_DECLINED = 'governance.data_request_declined',
  GOVERNANCE_DATA_REQUEST_WITHDRAWN = 'governance.data_request_withdrawn',
  GOVERNANCE_DATA_REQUEST_DATASET_UNAVAILABLE = 'governance.data_request_dataset_unavailable',
}
