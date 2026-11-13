/**
 * How an audited action came (apps/api identity/audit-trail.service.ts
 * `AUDIT_CHANNELS`): the app or API, an MCP token, a SQL connection.
 */
export const AUDIT_CHANNELS = ["rest", "mcp", "sql"] as const;
export type AuditChannel = (typeof AUDIT_CHANNELS)[number];

/** A stored channel value as a known channel (`rest` for anything else). */
export function asAuditChannel(value: string | null | undefined): AuditChannel {
  return AUDIT_CHANNELS.find((channel) => channel === value) ?? "rest";
}
