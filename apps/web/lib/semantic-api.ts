import { getActorName, getNamespacedApiBaseUrl } from "@workspace/api-client";

/**
 * The glossary's semantic layer (docs/prd/SL1–SL5): terms with kinds, keys and
 * schemes; relations; bindings; meaning; the review queue; the semantic map.
 *
 * Hand-written fetches, like `data-transfer-api.ts`: these controllers return
 * service objects rather than Swagger DTOs, so the generated client has no
 * response types for them. The types below mirror the API services.
 */

// ── Transport ────────────────────────────────────────────────────────────────

export class SemanticApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | string[] | null | undefined>;

function queryString(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(","));
    } else {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export async function request<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  options: { query?: Query; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const actor = getActorName();
  if (actor) headers["X-Actor-Name"] = encodeURIComponent(actor);
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(
    `${getNamespacedApiBaseUrl()}${path}${queryString(options.query)}`,
    {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    },
  );
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? Array.isArray((body as { message: unknown }).message)
          ? ((body as { message: string[] }).message.join("; "))
          : String((body as { message: unknown }).message)
        : `Request failed (${response.status})`;
    throw new SemanticApiError(message, response.status, body);
  }
  return body as T;
}

/** A readable message for a failed call. */
export function semanticErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof SemanticApiError) return error.message || fallback;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

// ── Terms, schemes, relations (SL1) ──────────────────────────────────────────

export type TermKind = "CONCEPT" | "ENTITY";
export type TermStatus = "DRAFT" | "APPROVED" | "DEPRECATED";
export type EntityType =
  | "PERSON"
  | "ORGANIZATION"
  | "LOCATION"
  | "REFERENCE"
  | "TERM"
  | "OTHER";
export type RelationType =
  | "BROADER"
  | "RELATED"
  | "PART_OF"
  | "INSTANCE_OF"
  | "CUSTOM";

export interface SchemeRef {
  id: string;
  key: string;
  name: string;
  color: string | null;
}

export interface TermSummary {
  id: string;
  key: string;
  term: string;
  kind: TermKind;
  status: TermStatus;
  scheme: SchemeRef | null;
}

/** Assets currently linked to a term, and the bindings that link them. */
export interface TermUsageCounts {
  assets: number;
  bindings: number;
}

export interface Term {
  id: string;
  key: string;
  previousKeys: string[];
  term: string;
  kind: TermKind;
  status: TermStatus;
  aliases: string[];
  codes: string[];
  hiddenAliases: string[];
  proposedAliases: string[];
  definition: string | null;
  entityType: EntityType;
  notes: string | null;
  steward: string | null;
  schemeId: string | null;
  scheme: SchemeRef | null;
  replacedById: string | null;
  deprecatedAt: string | null;
  packKey: string | null;
  origin: string;
  approvedBy: string | null;
  approvedAt: string | null;
  /** Present on list rows: where the term is used. */
  usage?: TermUsageCounts;
  createdAt: string;
  updatedAt: string;
  // Entities (G5). Zero and null for concepts.
  anchorUrn: string | null;
  attributes: Record<string, unknown> | null;
  mentionCount: number;
  assetCount: number;
  sourceCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  /** Set when the entity was merged into `replacedById`. */
  mergedAt: string | null;
}

export interface TermRelation {
  id: string;
  type: RelationType;
  label: string;
  status: TermStatus;
  origin: string;
  note: string | null;
  direction: "out" | "in";
  approvedBy: string | null;
  createdBy: string | null;
  term: TermSummary;
}

export interface TermDetail extends Term {
  replacedBy: TermSummary | null;
  relations: TermRelation[];
  broaderChain: TermSummary[][];
  narrower: TermSummary[];
  broader: TermSummary[];
  instanceOf: TermSummary[];
  generatedDetectors: Array<{ id: string; key: string; name: string }>;
}

export interface Scheme {
  id: string;
  key: string;
  name: string;
  description: string | null;
  color: string | null;
  origin: string;
  packKey: string | null;
  packVersion: string | null;
  termCount: number;
}

export interface TermListResult {
  terms: Term[];
  total: number;
}

export interface LookupHit extends Term {
  matchedOn?: string;
  score?: number;
}

export interface TermActivity {
  id: string;
  type: string;
  actor: string | null;
  payload: unknown;
  createdAt: string;
}

export function listTerms(params: {
  query?: string;
  kind?: TermKind;
  schemeKey?: string;
  status?: TermStatus | TermStatus[];
  entityType?: EntityType;
  take?: number;
  skip?: number;
}) {
  return request<TermListResult>("GET", "/glossary", {
    query: {
      ...params,
      status: Array.isArray(params.status) ? params.status : params.status,
    },
  });
}

export function lookupTerms(
  query: string,
  options: { kind?: TermKind; schemeKey?: string; limit?: number } = {},
) {
  return request<LookupHit[]>("GET", "/glossary/lookup", {
    query: { query, ...options },
  });
}

export function getTerm(idOrKey: string) {
  return request<TermDetail>(
    "GET",
    `/glossary/terms/${encodeURIComponent(idOrKey)}`,
  );
}

export function getTermActivity(idOrKey: string, take = 50, skip = 0) {
  return request<{ activities: TermActivity[]; total: number }>(
    "GET",
    `/glossary/terms/${encodeURIComponent(idOrKey)}/activity`,
    { query: { take, skip } },
  );
}

export interface TermInput {
  id?: string;
  term: string;
  kind?: TermKind;
  key?: string;
  aliases?: string[];
  codes?: string[];
  hiddenAliases?: string[];
  definition?: string | null;
  schemeId?: string | null;
  entityType?: EntityType;
  steward?: string | null;
  notes?: string | null;
  createNew?: boolean;
}

export function saveTerm(input: TermInput) {
  return request<Term & { merged: boolean }>(
    "POST",
    "/glossary",
    { body: input },
  );
}

export const approveTerm = (id: string) =>
  request<Term>("POST", `/glossary/${id}/approve`);
export const unapproveTerm = (id: string) =>
  request<Term>("POST", `/glossary/${id}/unapprove`);
export const reinstateTerm = (id: string) =>
  request<Term>("POST", `/glossary/${id}/reinstate`);
export const deprecateTerm = (id: string, replacedById?: string | null) =>
  request<Term>("POST", `/glossary/${id}/deprecate`, {
    body: replacedById ? { replacedById } : {},
  });
export const deleteTerm = (id: string) =>
  request<{ deleted: boolean }>("DELETE", `/glossary/${id}`);

export function bulkUpdateTerms(input: {
  ids?: string[];
  filters?: Record<string, unknown>;
  status?: TermStatus;
  kind?: TermKind;
  schemeId?: string | null;
  entityType?: EntityType;
}) {
  return request<{ updatedCount: number }>("POST", "/glossary/bulk", {
    body: input,
  });
}

export const listSchemes = () => request<Scheme[]>("GET", "/glossary/schemes");
export const saveScheme = (input: {
  id?: string;
  name: string;
  key?: string;
  description?: string | null;
  color?: string | null;
}) =>
  input.id
    ? request<Scheme>("PATCH", `/glossary/schemes/${input.id}`, { body: input })
    : request<Scheme>("POST", "/glossary/schemes", { body: input });
export const deleteScheme = (id: string) =>
  request<unknown>("DELETE", `/glossary/schemes/${id}`);

export interface SchemeTreeNode extends Term {
  childCount: number;
}

export function schemeTree(schemeIdOrKey: string, parentId?: string) {
  return request<{
    scheme: Scheme | null;
    parentId: string | null;
    nodes: SchemeTreeNode[];
  }>("GET", `/glossary/schemes/${encodeURIComponent(schemeIdOrKey)}/tree`, {
    query: { parentId },
  });
}

export function createRelation(input: {
  fromTermId: string;
  toTermId: string;
  type: RelationType;
  label?: string;
  note?: string;
}) {
  return request<{ id: string }>("POST", "/glossary/relations", {
    body: input,
  });
}

export const approveRelation = (id: string) =>
  request<unknown>("POST", `/glossary/relations/${id}/approve`);
export const removeRelation = (id: string) =>
  request<unknown>("DELETE", `/glossary/relations/${id}`);

export function exportGlossaryUrl(format: "csv" | "skos", schemeId?: string) {
  return `${getNamespacedApiBaseUrl()}/glossary/export${queryString({ format, schemeId })}`;
}

export interface ImportReport {
  jobId: string | null;
  status: "DONE" | "DRY_RUN";
  format: string;
  dryRun: boolean;
  counts: {
    create: number;
    update: number;
    skip: number;
    conflict: number;
    refused: number;
    schemesCreated: number;
    relationsCreated: number;
    relationsRefused: number;
  };
  items: Array<{
    row: number;
    key: string;
    term: string;
    action: string;
    reason?: string;
  }>;
  relations: Array<{ from: string; to: string; type: string; reason: string }>;
  truncated: boolean;
}

export function importGlossary(input: {
  format: "csv" | "skos";
  content: string;
  dryRun: boolean;
  conflict?: "skip" | "overwrite" | "merge-labels";
  asDraft?: boolean;
  schemeKey?: string;
}) {
  return request<ImportReport>("POST", "/glossary/import", { body: input });
}

// ── Vocabulary and bindings (SL2) ────────────────────────────────────────────

export type BindingMode =
  | "OUTPUT"
  | "OUTPUT_VALUES"
  | "OUTPUT_LOOKUP"
  | "METADATA_VALUES"
  | "METADATA_LOOKUP";

export interface OutputRef {
  detectorType: string;
  customDetectorKey?: string | null;
  customDetectorName?: string | null;
  findingType: string;
}

export interface VocabularyBinding {
  id: string;
  mode: BindingMode;
  status: string;
  noMeaning: boolean;
  term: { id: string; key: string; term: string } | null;
  lookupScheme: { id: string; key: string; name: string } | null;
}

export interface VocabularyRow {
  kind: "output" | "field";
  id: string;
  output?: OutputRef & { pipelineType: string | null };
  field?: string;
  label: { label: string; detail: string };
  sources: Array<{ id: string; name: string }>;
  openCount: number;
  assetCount: number;
  distinctValues: number | null;
  categorical: boolean;
  topValues: Array<{ value: string; count: number }>;
  lastSeenAt: string | null;
  refreshedAt: string | null;
  bindings: VocabularyBinding[];
  bound: boolean;
}

export function listVocabulary(params: {
  kind?: "outputs" | "fields" | "all";
  bound?: "true" | "false" | "any";
  sourceId?: string;
  q?: string;
  take?: number;
  skip?: number;
}) {
  return request<{
    rows: VocabularyRow[];
    total: number;
    refreshedAt: string | null;
  }>("GET", "/semantic/vocabulary", { query: params });
}

export const refreshVocabulary = () =>
  request<unknown>("POST", "/semantic/vocabulary/refresh", { body: {} });

export interface BindingSpec {
  mode: BindingMode;
  output?: OutputRef | null;
  field?: string | null;
  values?: string[];
  splitDelimiter?: string | null;
  lookup?: { schemeId?: string; schemeKey?: string; match: "CODES" | "ANY" } | null;
  termKey?: string | null;
  termId?: string | null;
  noMeaning?: boolean;
  sourceIds?: string[];
}

export interface Binding {
  id: string;
  mode: BindingMode;
  output: OutputRef | null;
  field: string | null;
  values: string[];
  splitDelimiter: string | null;
  lookup: {
    schemeId: string;
    scheme: { id: string; key: string; name: string } | null;
    match: "CODES" | "ANY";
  } | null;
  term: {
    id: string;
    key: string;
    term: string;
    kind: TermKind;
    status: TermStatus;
  } | null;
  noMeaning: boolean;
  sourceIds: string[];
  status: "DRAFT" | "APPROVED" | "DISABLED";
  origin: string;
  rationale: string | null;
  note: string | null;
  packKey: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  label: { label: string; detail: string };
}

export interface BindingPreview {
  counts: { findings: number; assets: number; sources: number };
  samples: Array<{
    findingId: string | null;
    assetId: string;
    assetName: string;
    value: string;
    term: { id: string; key: string; term: string } | null;
  }>;
  lookup?: {
    matched: Array<{
      value: string;
      count: number;
      term: { id: string; key: string; term: string };
    }>;
    unmatched: Array<{ value: string; count: number }>;
    ambiguous: Array<{
      value: string;
      count: number;
      candidates: Array<{ id: string; key: string; term: string }>;
    }>;
  };
  warnings: Array<{ code: string; message: string }>;
  timedOut: boolean;
  label: { label: string; detail: string } | null;
}

export function listBindings(params: {
  termId?: string;
  /** Lookup bindings that read values against this scheme. */
  schemeId?: string;
  status?: string;
  detectorType?: string;
  customDetectorKey?: string;
  findingType?: string;
  take?: number;
  skip?: number;
}) {
  return request<{ bindings: Binding[]; total: number }>(
    "GET",
    "/semantic/bindings",
    { query: params },
  );
}

export const previewBinding = (spec: BindingSpec) =>
  request<BindingPreview>("POST", "/semantic/bindings/preview", { body: spec });
export const createBinding = (
  spec: BindingSpec,
  options: { status?: "APPROVED" | "DRAFT"; note?: string } = {},
) =>
  request<Binding>("POST", "/semantic/bindings", {
    body: { ...spec, ...options },
  });
export const approveBinding = (id: string) =>
  request<Binding>("POST", `/semantic/bindings/${id}/approve`);
export const disableBinding = (id: string) =>
  request<Binding>("POST", `/semantic/bindings/${id}/disable`);
export const enableBinding = (id: string) =>
  request<Binding>("POST", `/semantic/bindings/${id}/enable`);
export const deleteBinding = (id: string) =>
  request<unknown>("DELETE", `/semantic/bindings/${id}`);

export interface PackSummary {
  key: string;
  name: string;
  version: string | null;
  counts: Record<string, number>;
}

export const listPacks = () =>
  request<{
    installed: Array<PackSummary & { installedAt: string | null }>;
    available: Array<
      PackSummary & {
        description: string | null;
        language: string | null;
        installedVersion: string | null;
      }
    >;
  }>("GET", "/semantic/packs");

export const installPack = (key: string, dryRun: boolean) =>
  request<{
    pack: { key: string; name: string; version: string };
    dryRun: boolean;
    terms: ImportReport;
    bindings: { counts: Record<string, number> };
  }>("POST", "/semantic/packs/install", { body: { key, dryRun } });

export interface FindInTextPreview {
  term: { id: string; key: string; term: string; kind: TermKind; status: TermStatus };
  labels: Array<{
    value: string;
    type: "term" | "alias" | "code";
    checked: boolean;
    reason?: string;
  }>;
  pattern: string | null;
  error: string | null;
  scenarios: Array<{ name: string; inputText: string; shouldMatch: boolean }>;
  warnings: Array<{ code: string; message: string }>;
  detectors: Array<{ id: string; key: string; name: string; outOfDate?: boolean }>;
}

export const findInTextPreview = (termKey: string) =>
  request<FindInTextPreview>(
    "GET",
    `/glossary/terms/${encodeURIComponent(termKey)}/find-in-text`,
  );
export const findInTextCreate = (
  termKey: string,
  input: { severity?: string; wholeWords?: boolean; continuations?: boolean },
) =>
  request<{
    customDetectorId: string;
    customDetectorKey: string;
    bindingId: string;
    pattern: string;
    scenarios: number;
    attachedSourceIds: string[];
  }>(
    "POST",
    `/glossary/terms/${encodeURIComponent(termKey)}/find-in-text`,
    { body: input },
  );

// ── Meaning (SL3) ────────────────────────────────────────────────────────────

export type LinkMethod =
  | "BINDING"
  | "DECLARED"
  | "MANUAL"
  | "SUGGESTED"
  | "MENTION";

export interface MeaningTerm {
  id: string;
  key: string;
  name: string;
  kind: TermKind;
  status: TermStatus;
  scheme: SchemeRef | null;
}

export interface MeaningItem {
  term: MeaningTerm;
  method: LinkMethod | "BROADER";
  confidence: number;
  support: number;
  binding?: {
    id: string;
    mode: string;
    label: string;
    approvedBy: string | null;
    approvedAt: string | null;
    origin: string;
  } | null;
  declaredBy?: { edgeId: string; evidence: unknown } | null;
  linkedBy?: {
    referenceId: string;
    by: string | null;
    note: string | null;
  } | null;
  via?: { id: string; key: string; name: string } | null;
  /** For MENTION: the entity value the finding carries, and how it was confirmed. */
  mention?: { label: string; value: string; how: string } | null;
  since: string | null;
}

export interface FindingMeaning {
  findingId: string;
  assetId: string;
  output: OutputRef & { label: { label: string; detail: string } };
  meanings: MeaningItem[];
}

export const getFindingMeaning = (findingId: string) =>
  request<FindingMeaning>(
    "GET",
    `/semantic/findings/${encodeURIComponent(findingId)}/meaning`,
  );

export interface AssetMeaningTerm {
  term: MeaningTerm;
  current: boolean;
  methods: Array<{
    method: LinkMethod;
    support: number;
    confidence: number;
    maxSeverity: string | null;
    sampleFindingId: string | null;
    since: string;
    lastLinkedAt: string;
    goneAt: string | null;
    bindings: Array<{ id: string; mode: string; label: string }>;
  }>;
}

export const getAssetMeaning = (assetId: string, history = false) =>
  request<{
    assetId: string;
    assetName: string;
    current: AssetMeaningTerm[];
    history: AssetMeaningTerm[];
  }>("GET", `/semantic/assets/${encodeURIComponent(assetId)}/meaning`, {
    query: { history: history || undefined },
  });

export interface TermEvidencePage {
  termId: string;
  includeNarrower: boolean;
  total: number;
  page: number;
  pageSize: number;
  assets: Array<{
    assetId: string;
    assetName: string;
    externalUrl: string;
    assetType: string;
    source: { id: string; name: string };
    methods: LinkMethod[];
    terms: Array<{ id: string; key: string; name: string }>;
    support: number;
    maxSeverity: string | null;
    firstLinkedAt: string;
    lastLinkedAt: string;
    goneAt: string | null;
  }>;
}

export const getTermEvidence = (
  termId: string,
  params: {
    includeNarrower?: boolean;
    sourceId?: string;
    method?: LinkMethod;
    status?: "current" | "gone" | "all";
    page?: number;
  } = {},
) =>
  request<TermEvidencePage>(
    "GET",
    `/semantic/terms/${encodeURIComponent(termId)}/evidence`,
    { query: params },
  );

export interface TermSummaryStats {
  counts: {
    assets: number;
    findings: number;
    sources: number;
    direct: number;
    withNarrower: number;
  };
  byMethod: Array<{ method: LinkMethod; assets: number }>;
  bySource: Array<{ sourceId: string; name: string; assets: number }>;
  bySeverity: Array<{ severity: string; assets: number }>;
  trend: Array<{ week: string; added: number; gone: number }>;
}

export const getTermSummary = (termId: string, includeNarrower = false) =>
  request<TermSummaryStats>(
    "GET",
    `/semantic/terms/${encodeURIComponent(termId)}/summary`,
    { query: { includeNarrower: includeNarrower || undefined } },
  );

export const linkTerm = (input: {
  termId?: string;
  termKey?: string;
  target: { type: "finding" | "asset" | "case"; id: string };
  note?: string;
}) => request<{ id: string }>("POST", "/semantic/links", { body: input });

export const unlinkTerm = (referenceId: string) =>
  request<unknown>("DELETE", `/semantic/links/${encodeURIComponent(referenceId)}`);

// ── Review queue (SL4) ───────────────────────────────────────────────────────

export type ProposalKind =
  | "TERM"
  | "ALIAS"
  | "RELATION"
  | "BINDING"
  | "LINK"
  | "TERM_REF"
  | "ENTITY_MENTION"
  | "ENTITY_MERGE";

export type ProposalDecision =
  | "accept"
  | "edit"
  | "dismiss"
  | "dismiss_forever"
  | "skip";

export interface ProposalItem {
  kind: ProposalKind;
  id: string;
  source: "draft" | "suggestion" | "ref" | "entity";
  title: string;
  rationale: string | null;
  score: number | null;
  generator: string | null;
  origin: string;
  createdBy: string | null;
  createdAt: string | null;
  term: {
    id: string;
    key: string;
    term: string;
    kind: TermKind;
    status: TermStatus;
  } | null;
  asset?: { id: string; name: string } | null;
  payload?: unknown;
  evidence?: unknown;
  agentNote?: string | null;
}

export function listProposals(params: {
  kind?: ProposalKind;
  minScore?: number;
  take?: number;
  skip?: number;
}) {
  return request<{
    items: ProposalItem[];
    total: number;
    counts: Record<string, number>;
    embeddings: boolean;
  }>("GET", "/glossary/proposals", { query: params });
}

export const proposalCounts = () =>
  request<Record<string, number>>("GET", "/glossary/proposals/counts");

export const decideProposal = (input: {
  kind: ProposalKind;
  id: string;
  decision: ProposalDecision;
  reason?: string;
  edit?: Record<string, unknown>;
}) => request<unknown>("POST", "/glossary/proposals/decide", { body: input });

export const refreshSuggestions = () =>
  request<unknown>("POST", "/semantic/suggestions/refresh", { body: {} });

// ── Semantic map (SL5) ───────────────────────────────────────────────────────

export interface MapNode {
  termId: string;
  key: string;
  name: string;
  kind: TermKind;
  definition: string | null;
  scheme: SchemeRef | null;
  directAssetCount: number;
  totalAssetCount: number;
  findingCount: number;
  sourceCount: number;
  severityCounts: Record<string, number>;
  lastLinkedAt: string | null;
  pendingProposals: number;
  broaderIds: string[];
  context: boolean;
}

export interface MapLink {
  a: string;
  b: string;
  kind: string;
  label: string;
  assetCount: number;
  lift: number | null;
}

export interface SemanticMap {
  nodes: MapNode[];
  links: MapLink[];
  overlay: unknown;
  unbound: { outputs: number; findings: number };
  coverage: {
    share: number;
    openFindings: number;
    findingsWithMeaning: number;
  } | null;
  freshness: {
    refreshedAt: string | null;
    durationMs: number | null;
    isBuilt: boolean;
    liveBuild: boolean;
  };
  empty: "NO_CONCEPTS" | "NO_LINKS" | null;
}

export const getSemanticMap = (params: {
  schemeIds?: string[];
  sourceIds?: string[];
  minAssets?: number;
  cooccurrence?: boolean;
  caseId?: string;
  entities?: boolean;
}) => request<SemanticMap>("GET", "/semantic/map", { query: params });

export const rebuildSemanticMap = () =>
  request<unknown>("POST", "/semantic/map/rebuild", { body: {} });

export const getCoverage = () =>
  request<{
    share: number | null;
    openFindings: number | null;
    findingsWithMeaning: number | null;
    assetsWithMeaning: number | null;
    computedAt: string | null;
    unboundOutputs: number;
    unboundFindings: number;
  }>("GET", "/semantic/coverage");

// ── Where a term is used (SL3 R7.3) ──────────────────────────────────────────

export interface TermUsage {
  cases: Array<{
    id: string;
    title: string;
    status: string;
    /** Evidence assets of the case that link to the term. */
    assets: number;
    /** The case itself was linked to the term ("this case is about …"). */
    about: boolean;
  }>;
  watches: Array<{
    id: string;
    title: string;
    status: string;
    matchCount: number;
    newMatchCount: number;
    termsIncludeNarrower: boolean;
  }>;
}

export const getTermUsage = (termId: string) =>
  request<TermUsage>(
    "GET",
    `/semantic/terms/${encodeURIComponent(termId)}/usage`,
  );
