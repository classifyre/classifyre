import { getActorName, getNamespacedApiBaseUrl } from "@workspace/api-client";
import { request, type EntityType, type Term, type TermStatus } from "./semantic-api";

/**
 * Entities (docs/prd/G5-entities.md): the named things findings refer to. An
 * entity is an ENTITY-kind glossary term, so renaming, approving and
 * deprecating one is `semantic-api.ts`; this file is what only entities have —
 * values, mentions, the candidate review and merging.
 *
 * Hand-written fetches over the same transport, for the same reason: the
 * controller returns service objects, not Swagger DTOs.
 */

export type EntityValueMethod =
  | "EXACT_ALIAS"
  | "IDENTIFIER"
  | "CONNECTOR"
  | "PHONETIC"
  | "FUZZY"
  | "MANUAL";

export interface EntityRef {
  id: string;
  term: string;
  key: string;
}

export interface EntityValue {
  id: string;
  termId: string;
  label: string;
  value: string;
  normalizedValue: string;
  valueHash: string;
  method: EntityValueMethod;
  verdict: "CONFIRMED" | "PROPOSED" | "REJECTED";
  score: number | null;
  /** `name` for name labels, `identifier` for everything else. */
  family: "name" | "identifier";
  conflictTermId: string | null;
  agentVerdict: string | null;
  agentNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  /** Assets that carry the value. */
  occurrences: number;
  /** Other entities that hold the same value (a name two entities share). */
  sharedWith: EntityRef[];
}

export interface EntityListRow extends Term {
  pendingCandidates: number;
}

export interface EntityDetail extends Term {
  /** Mentions link (and count as meaning) only while approved and switched on. */
  linking: boolean;
  featureEnabled: boolean;
  anchor: {
    urn: string;
    asset: { id: string; name: string; sourceId: string; externalUrl: string } | null;
  } | null;
  mergedInto: EntityRef | null;
  values: EntityValue[];
  candidates: EntityValue[];
  rejected: EntityValue[];
  ambiguous: boolean;
}

export interface FindingSnippet {
  before: string;
  matched: string;
  after: string;
  location: string | null;
}

export interface EntityMention {
  assetId: string;
  assetName: string;
  assetType: string;
  externalUrl: string;
  sourceId: string;
  sourceName: string;
  findingId: string | null;
  findingType: string | null;
  detectorType: string;
  severity: string | null;
  label: string;
  value: string;
  method: EntityValueMethod;
  seenAt: string | null;
  snippet: FindingSnippet | null;
}

export interface EntityOverview {
  timeline: Array<{ week: string; mentions: number }>;
  sources: Array<{
    sourceId: string;
    name: string;
    type: string;
    mentions: number;
    assets: number;
    lastSeenAt: string | null;
  }>;
  coMentions: Array<{
    id: string;
    term: string;
    key: string;
    entityType: EntityType;
    sharedAssets: number;
  }>;
}

export interface EntityCandidate {
  id: string;
  kind: "mention" | "conflict";
  term: {
    id: string;
    key: string;
    term: string;
    entityType: EntityType;
    status: TermStatus;
  };
  label: string;
  value: string;
  method: EntityValueMethod;
  score: number | null;
  resembles: string | null;
  occurrences: number;
  samples: Array<{
    assetId: string;
    assetName: string;
    sourceName: string;
    findingId: string | null;
    snippet: FindingSnippet | null;
  }>;
  conflictWith: EntityRef | null;
  agentVerdict: string | null;
  agentNote: string | null;
  createdAt: string;
}

export interface EntityConfig {
  enabled: boolean;
  disabledMode: "kept" | "deleted" | null;
  nameLabels: Record<string, string>;
  identifierLabels: string[];
  shippedIdentifierLabels: string[];
  activeNameLabels: string[];
  observedLabels: string[];
}

export interface CreateEntityInput {
  name?: string;
  entityType?: EntityType;
  aliases?: string[];
  identifiers?: Array<{ label: string; value: string }>;
  definition?: string;
  findingId?: string;
  value?: { label: string; value: string };
  createNew?: boolean;
}

export type CreatedEntity = EntityDetail & {
  /** The request landed on an entity that already had this name. */
  merged: boolean;
  conflicts: Array<{ label: string; value: string; heldBy: EntityRef }>;
};

export const getEntityConfig = () => request<EntityConfig>("GET", "/entities/config");

export function searchEntities(params: {
  query?: string;
  entityType?: EntityType;
  sort?: "mentions" | "name" | "lastSeen";
  take?: number;
  skip?: number;
}) {
  return request<{ entities: EntityListRow[]; total: number }>("GET", "/entities", {
    query: params,
  });
}

export const getEntity = (idOrKey: string) =>
  request<EntityDetail>("GET", `/entities/${encodeURIComponent(idOrKey)}`);

export const createEntity = (input: CreateEntityInput) =>
  request<CreatedEntity>("POST", "/entities", { body: input });

export const getEntityOverview = (idOrKey: string) =>
  request<EntityOverview>("GET", `/entities/${encodeURIComponent(idOrKey)}/overview`);

export const getEntityMentions = (
  idOrKey: string,
  params: { after?: string | null; limit?: number; sourceId?: string } = {},
) =>
  request<{ mentions: EntityMention[]; next: string | null }>(
    "GET",
    `/entities/${encodeURIComponent(idOrKey)}/mentions`,
    { query: params },
  );

export const addEntityValue = (idOrKey: string, input: { label: string; value: string }) =>
  request<{ value: EntityValue; conflict: EntityRef | null }>(
    "POST",
    `/entities/${encodeURIComponent(idOrKey)}/values`,
    { body: input },
  );

export const removeEntityValue = (valueId: string) =>
  request<{ removed: boolean }>("DELETE", `/entities/values/${encodeURIComponent(valueId)}`);

export const mergeEntity = (fromIdOrKey: string, into: string) =>
  request<{ merged: boolean; into: EntityRef }>(
    "POST",
    `/entities/${encodeURIComponent(fromIdOrKey)}/merge`,
    { body: { into } },
  );

export function listEntityCandidates(params: {
  termId?: string;
  kind?: "mention" | "conflict";
  take?: number;
  skip?: number;
}) {
  return request<{
    items: EntityCandidate[];
    total: number;
    counts: { mention: number; conflict: number };
  }>("GET", "/entities/candidates", { query: params });
}

export const reviewEntityCandidates = (
  decisions: Array<{ id: string; decision: "accept" | "reject" | "move" }>,
) =>
  request<{ accepted: number; rejected: number; moved: number }>(
    "POST",
    "/entities/candidates/review",
    { body: { decisions } },
  );

export const resolveEntities = () =>
  request<{ queued: boolean }>("POST", "/entities/resolve", { body: {} });

/**
 * Download an entity's mentions (the access-request export). Fetched rather
 * than linked, so the request carries the actor like every other call.
 */
export async function downloadEntityMentions(
  idOrKey: string,
  format: "csv" | "json",
): Promise<void> {
  const headers: Record<string, string> = {};
  const actor = getActorName();
  if (actor) headers["X-Actor-Name"] = encodeURIComponent(actor);
  const response = await fetch(
    `${getNamespacedApiBaseUrl()}/entities/${encodeURIComponent(idOrKey)}/export?format=${format}`,
    { headers },
  );
  if (!response.ok) throw new Error(`Export failed (${response.status})`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${idOrKey}-mentions.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
