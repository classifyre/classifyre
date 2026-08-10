/**
 * The single source of truth for what a namespace archive contains.
 *
 * Every table that can travel is declared here exactly once, with the scope it
 * belongs to, its position in the foreign-key-safe write order, its primary key
 * and — critically — which of its columns must never leave the instance. The
 * export service, the import service, the REST scope catalogue and the
 * redaction guard all read this table rather than keeping their own lists, so a
 * new model cannot be added to one half of the feature and forgotten in the
 * other.
 *
 * Deliberately absent, and why:
 *   ContentEmbedding / EmbeddingSpace / AssetChunk — derived vectors and text
 *     slices, regenerated on demand and far larger than everything else combined.
 *   FindingEvidenceAnalysis — derived ranking scores, and they carry a required
 *     reference into EmbeddingSpace, which cannot travel: a space's identity is
 *     the (provider, model, revision, dim, …) tuple of the receiving instance's
 *     own embedding configuration, not something an archive can carry with it.
 *     The part that matters, importanceScore, is already denormalized onto
 *     Finding; the rest is rebuilt by the next recalibration pass.
 *   McpAccessToken — nothing but a credential hash.
 *   ChatSession / ChatMessage — conversation transcripts, tied to a live
 *     connector that the target instance does not have.
 *   CorrelationPairStaging — scratch space for one correlation run.
 *   Notification — an inbox, meaningless once detached from its instance.
 *   DataTransferJob — the transfer history itself; exporting it would nest.
 */

export const TRANSFER_SCOPE_IDS = [
  'sources',
  'sourceFiles',
  'assets',
  'findings',
  'customDetectors',
  'glossary',
  'fingerprints',
  'investigations',
  'scanData',
  'harness',
  'instanceConfig',
] as const;

export type TransferScopeId = (typeof TRANSFER_SCOPE_IDS)[number];

export interface TransferScope {
  id: TransferScopeId;
  /** Stable English label; the web app translates by id and falls back to this. */
  label: string;
  description: string;
  /**
   * Scopes whose rows this one references. Not enforced — a partial import of
   * `findings` without `assets` still works, orphans are skipped and reported —
   * but the UI warns before the operator commits to it.
   */
  dependsOn: readonly TransferScopeId[];
  /** Large or binary payloads; off by default and flagged in the UI. */
  heavy?: boolean;
  /** Contains configuration whose credentials are stripped on export. */
  redactsSecrets?: boolean;
}

export const TRANSFER_SCOPES: readonly TransferScope[] = [
  {
    id: 'sources',
    label: 'Sources',
    description:
      'Source definitions, schedules and scan configuration. Connection credentials are always stripped.',
    dependsOn: [],
    redactsSecrets: true,
  },
  {
    id: 'sourceFiles',
    label: 'Sandbox uploads',
    description:
      'The raw bytes of files uploaded to sandbox sources. Large — the archive grows by roughly the size of the uploads.',
    dependsOn: ['sources'],
    heavy: true,
  },
  {
    id: 'assets',
    label: 'Assets',
    description: 'Ingested documents with their metadata and extracted text.',
    dependsOn: ['sources'],
  },
  {
    id: 'findings',
    label: 'Findings',
    description:
      'Detections with their evidence, extraction payloads and reviewer feedback.',
    dependsOn: ['sources', 'assets'],
  },
  {
    id: 'customDetectors',
    label: 'Custom detectors',
    description:
      'Detector definitions with their training examples, training history and test scenarios.',
    dependsOn: [],
  },
  {
    id: 'glossary',
    label: 'Glossary',
    description: 'Terms, aliases and entity annotations.',
    dependsOn: [],
  },
  {
    id: 'fingerprints',
    label: 'Fingerprints',
    description:
      'Correlation values, asset signatures, duplicate clusters and the relationship graph.',
    dependsOn: ['assets'],
  },
  {
    id: 'investigations',
    label: 'Investigations',
    description:
      'Cases and inquiries with their evidence, leads, chronology, notes and threads.',
    dependsOn: ['findings'],
  },
  {
    id: 'scanData',
    label: 'Scan history',
    description:
      'Runs with their per-asset outcomes and coverage statistics. The largest scope on a mature namespace.',
    dependsOn: ['sources'],
    heavy: true,
  },
  {
    id: 'harness',
    label: 'AI harness',
    description:
      'Agent runs, decisions, logs, long-term memory, per-agent configuration and connected MCP servers. MCP request headers are stripped.',
    dependsOn: [],
    redactsSecrets: true,
  },
  {
    id: 'instanceConfig',
    label: 'Instance configuration',
    description:
      'Regional defaults, autopilot switches, AI providers and chat bots. API keys and bot tokens are always stripped.',
    dependsOn: [],
    redactsSecrets: true,
  },
];

export interface TransferTableSpec {
  /**
   * Prisma delegate name. Doubles as the archive's line tag, so renaming a
   * model is a breaking archive change and must bump ARCHIVE_VERSION.
   */
  model: string;
  scope: TransferScopeId;
  /**
   * Foreign-key-safe write order. Import walks tables in ascending order so a
   * referenced row always lands before the row referencing it; export uses the
   * same order purely so archives read in a predictable shape.
   */
  order: number;
  /** Primary-key fields. Two join tables carry a composite key. */
  keys: readonly string[];
  /**
   * Prisma's compound unique/cursor property name for composite keys
   * (`runnerId_assetHash`). Absent for single-column keys.
   */
  compoundKey?: string;
  /**
   * Columns removed from every row before it reaches the archive. These hold
   * credentials — see the guard in redaction.ts, which fails the whole export
   * if an encrypted value survives anyway.
   */
  redact?: readonly string[];
  /** Strip `config.masked`, where source connection secrets live. */
  redactMaskedConfig?: boolean;
  /**
   * Values forced onto every imported row. Used to land connectors in a safe
   * disabled state, because their credentials were stripped on the way out.
   */
  importDefaults?: Record<string, unknown>;
  /**
   * Singleton configuration rows (`id = 1`, or a fixed enum key). Imported with
   * an upsert on the fixed key instead of a batch insert.
   */
  singleton?: boolean;
  /**
   * Columns that simply do not travel. Unlike {@link redact} these are not
   * credentials, so they are not tracked or reported — they are settings that
   * belong to the instance the data came from, not to the data itself.
   */
  omit?: readonly string[];
  /**
   * Columns holding the id of a transferable row: the table's own primary key
   * plus every foreign key, declared or not, including the polymorphic
   * `<x>Id`/`<x>Type` pairs.
   *
   * Import rewrites each of these through the same deterministic function (see
   * id-remap.ts), which is what keeps references consistent while every row
   * gets a fresh identity. A column left off this list keeps its original
   * value and its reference silently dangles, so this list is exhaustive by
   * necessity — the FK inventory it mirrors is in the schema.
   *
   * Content hashes are deliberately absent: they are natural keys and the
   * remapper passes non-UUID values through untouched anyway.
   */
  idRefs?: readonly string[];
  /**
   * Nullable foreign keys pointing into another scope, mapped to that scope.
   *
   * When the referenced scope is not part of an import, the column is set to
   * null instead of the row being rejected. Without this, importing `assets`
   * alone would fail every asset — each one carries an optional `runnerId`
   * into `scanData` — which is precisely the partial import the feature exists
   * to support. Required references are deliberately not listed: a finding
   * without its asset is not worth keeping, and the dependency warning tells
   * the operator so before they start.
   */
  optionalRefs?: Record<string, TransferScopeId>;
}

/**
 * Ordered so that `order` alone determines import sequencing. Gaps are left
 * between groups to leave room for later models without a renumber.
 */
export const TRANSFER_TABLES: readonly TransferTableSpec[] = [
  // ── Instance configuration referenced by everything else ──────────────────
  {
    model: 'aiProviderConfig',
    idRefs: ['id'],
    scope: 'instanceConfig',
    order: 10,
    keys: ['id'],
    // The provider's API key. Imported configs are keyless until an operator
    // re-enters the secret in Settings → AI providers.
    redact: ['apiKeyEnc'],
  },

  // ── Sources and their scan history ────────────────────────────────────────
  {
    model: 'source',
    idRefs: ['id', 'currentRunnerId'],
    scope: 'sources',
    order: 100,
    keys: ['id'],
    redactMaskedConfig: true,
    // A schedule is a property of the instance that was running the source, not
    // of the source itself. Carrying it over would have an imported source
    // start scanning on someone else's cadence, with credentials it does not
    // have yet.
    omit: [
      'scheduleEnabled',
      'scheduleCron',
      'scheduleTimezone',
      'scheduleNextAt',
      // The adaptive scheduler's state is a record of what THIS instance
      // observed while scanning: how far the sweep got, how often it found
      // nothing, how many times it failed. None of it describes the imported
      // source, and importing it would have a fresh source arrive already
      // "converged" and be scanned once a day from the start.
      'scheduleMode',
      'autoPhase',
      'autoIntervalSeconds',
      'autoNoProgressStreak',
      'autoCatchUpRuns',
      'autoReason',
      'autoLastRunnerId',
    ],
    // A source whose credentials were stripped must not be picked up by the
    // scheduler on the target instance and start failing every cron tick.
    importDefaults: {
      scheduleEnabled: false,
      scheduleNextAt: null,
      scheduleMode: 'OFF',
      autoPhase: 'CATCH_UP',
      autoIntervalSeconds: null,
      autoNoProgressStreak: 0,
      autoCatchUpRuns: 0,
      autoReason: null,
      autoLastRunnerId: null,
      currentRunnerId: null,
      runnerStatus: 'PENDING',
      consecutiveFailures: 0,
      lastErrorMessage: null,
      autopilotDirtyAt: null,
    },
  },
  {
    model: 'runner',
    scope: 'scanData',
    order: 110,
    keys: ['id'],
    idRefs: ['id', 'sourceId'],
  },
  {
    model: 'asset',
    idRefs: ['id', 'sourceId', 'runnerId'],
    scope: 'assets',
    order: 120,
    keys: ['id'],
    optionalRefs: { runnerId: 'scanData' },
  },
  {
    model: 'runnerAsset',
    idRefs: ['runnerId'],
    scope: 'scanData',
    order: 130,
    keys: ['runnerId', 'assetHash'],
    compoundKey: 'runnerId_assetHash',
  },
  {
    model: 'uploadedSourceFile',
    idRefs: ['id', 'sourceId'],
    scope: 'sourceFiles',
    order: 140,
    keys: ['id'],
  },

  // ── Detectors ─────────────────────────────────────────────────────────────
  {
    model: 'customDetector',
    idRefs: ['id', 'aiProviderConfigId'],
    scope: 'customDetectors',
    order: 200,
    keys: ['id'],
    optionalRefs: { aiProviderConfigId: 'instanceConfig' },
  },
  {
    model: 'customDetectorTrainingExample',
    idRefs: ['id', 'customDetectorId'],
    scope: 'customDetectors',
    order: 210,
    keys: ['id'],
  },
  {
    model: 'customDetectorTrainingRun',
    idRefs: ['id', 'customDetectorId', 'sourceId'],
    scope: 'customDetectors',
    order: 220,
    keys: ['id'],
    optionalRefs: { sourceId: 'sources' },
  },
  {
    model: 'customDetectorTestScenario',
    idRefs: ['id', 'detectorId'],
    scope: 'customDetectors',
    order: 230,
    keys: ['id'],
  },
  {
    model: 'customDetectorTestResult',
    idRefs: ['id', 'scenarioId', 'detectorId'],
    scope: 'customDetectors',
    order: 240,
    keys: ['id'],
  },

  // ── Findings and their evidence ───────────────────────────────────────────
  {
    model: 'finding',
    idRefs: ['id', 'assetId', 'sourceId', 'customDetectorId', 'runnerId'],
    scope: 'findings',
    order: 300,
    keys: ['id'],
    optionalRefs: { customDetectorId: 'customDetectors' },
  },
  {
    model: 'extractionPayload',
    scope: 'findings',
    order: 320,
    keys: ['contentHash'],
  },
  {
    model: 'customDetectorExtraction',
    idRefs: [
      'id',
      'findingId',
      'sourceId',
      'assetId',
      'customDetectorId',
      'runnerId',
    ],
    scope: 'findings',
    order: 330,
    keys: ['id'],
    optionalRefs: { customDetectorId: 'customDetectors' },
  },
  {
    model: 'customDetectorFeedback',
    idRefs: ['id', 'customDetectorId', 'sourceId', 'findingId'],
    scope: 'findings',
    order: 340,
    keys: ['id'],
    optionalRefs: { customDetectorId: 'customDetectors' },
  },

  // ── Fingerprints / correlation ────────────────────────────────────────────
  {
    model: 'correlationConfig',
    scope: 'fingerprints',
    order: 400,
    keys: ['id'],
    singleton: true,
  },
  {
    model: 'assetSignature',
    idRefs: ['assetId', 'sourceId'],
    scope: 'fingerprints',
    order: 410,
    keys: ['assetId'],
  },
  {
    model: 'assetCorrelationValue',
    idRefs: ['id', 'assetId', 'sourceId'],
    scope: 'fingerprints',
    order: 420,
    keys: ['id'],
  },
  {
    model: 'assetCluster',
    scope: 'fingerprints',
    order: 430,
    keys: ['id'],
    idRefs: ['id'],
  },
  {
    model: 'assetClusterMember',
    idRefs: ['clusterId', 'assetId'],
    scope: 'fingerprints',
    order: 440,
    keys: ['clusterId', 'assetId'],
    compoundKey: 'clusterId_assetId',
  },
  {
    model: 'edge',
    scope: 'fingerprints',
    order: 450,
    keys: ['id'],
    idRefs: ['id', 'fromId', 'toId'],
  },

  // ── Investigations ────────────────────────────────────────────────────────
  {
    model: 'inquiry',
    scope: 'investigations',
    order: 500,
    keys: ['id'],
    idRefs: ['id'],
  },
  {
    model: 'case',
    scope: 'investigations',
    order: 510,
    keys: ['id'],
    idRefs: ['id'],
  },
  {
    model: 'caseInquiry',
    scope: 'investigations',
    order: 520,
    keys: ['id'],
    idRefs: ['id', 'caseId', 'inquiryId'],
  },
  {
    model: 'caseFinding',
    scope: 'investigations',
    order: 530,
    keys: ['id'],
    idRefs: ['id', 'caseId', 'caseEvidenceId', 'findingId'],
  },
  {
    model: 'caseEvidence',
    scope: 'investigations',
    order: 540,
    keys: ['id'],
    idRefs: ['id', 'caseId', 'entityId'],
  },
  {
    model: 'caseLead',
    scope: 'investigations',
    order: 550,
    keys: ['id'],
    idRefs: ['id', 'caseId', 'findingId', 'assetId'],
  },
  {
    model: 'caseEvent',
    scope: 'investigations',
    order: 560,
    keys: ['id'],
    idRefs: ['id', 'caseId'],
  },
  {
    model: 'caseNote',
    scope: 'investigations',
    order: 570,
    keys: ['id'],
    idRefs: ['id', 'caseId'],
  },
  {
    model: 'caseThread',
    scope: 'investigations',
    order: 580,
    keys: ['id'],
    idRefs: ['id', 'caseId'],
  },
  {
    model: 'caseThreadEntry',
    idRefs: ['id', 'threadId'],
    scope: 'investigations',
    order: 590,
    keys: ['id'],
  },
  {
    model: 'caseThreadSupport',
    idRefs: ['id', 'threadId', 'entryId', 'targetId'],
    scope: 'investigations',
    order: 600,
    keys: ['id'],
  },
  {
    model: 'caseActivity',
    scope: 'investigations',
    order: 610,
    keys: ['id'],
    idRefs: ['id', 'caseId'],
  },

  // ── AI harness ────────────────────────────────────────────────────────────
  {
    model: 'mcpServerConfig',
    idRefs: ['id'],
    scope: 'harness',
    order: 700,
    keys: ['id'],
    // Request headers routinely carry bearer tokens.
    redact: ['headersEnc'],
    // No headers means an authenticated server would fail on first connect.
    importDefaults: { enabled: false, lastError: null, lastConnectedAt: null },
  },
  {
    model: 'agentConfig',
    scope: 'harness',
    order: 710,
    keys: ['kind'],
    singleton: true,
  },
  {
    model: 'agentSystemBrief',
    scope: 'harness',
    order: 720,
    keys: ['id'],
    singleton: true,
  },
  {
    model: 'agentRun',
    scope: 'harness',
    order: 730,
    keys: ['id'],
    idRefs: ['id', 'sourceId', 'runnerId', 'caseId'],
  },
  {
    model: 'agentDecision',
    scope: 'harness',
    order: 740,
    keys: ['id'],
    idRefs: ['id', 'runId', 'entityId'],
  },
  {
    model: 'agentLog',
    scope: 'harness',
    order: 750,
    keys: ['id'],
    idRefs: ['id', 'runId'],
  },
  {
    model: 'agentMemory',
    scope: 'harness',
    order: 760,
    keys: ['id'],
    idRefs: ['id', 'refId'],
  },

  // ── Glossary ──────────────────────────────────────────────────────────────
  {
    model: 'glossaryTerm',
    scope: 'glossary',
    order: 800,
    keys: ['id'],
    idRefs: ['id'],
  },
  {
    model: 'glossaryReference',
    scope: 'glossary',
    order: 810,
    keys: ['id'],
    idRefs: ['id', 'glossaryTermId', 'entityId'],
  },

  // ── Instance configuration that references the above ──────────────────────
  {
    model: 'chatBot',
    idRefs: ['id'],
    scope: 'instanceConfig',
    order: 900,
    keys: ['id'],
    redact: ['botTokenEnc', 'appTokenEnc'],
    importDefaults: {
      enabled: false,
      lastError: null,
      lastConnectedAt: null,
      telegramLastUpdateId: null,
    },
  },
  {
    model: 'instanceSettings',
    idRefs: ['aiProviderConfigId'],
    scope: 'instanceConfig',
    order: 910,
    keys: ['id'],
    singleton: true,
    // The Hugging Face access token.
    redact: ['hfTokenEnc'],
  },
];

const TABLES_BY_MODEL = new Map(TRANSFER_TABLES.map((t) => [t.model, t]));
const SCOPES_BY_ID = new Map(TRANSFER_SCOPES.map((s) => [s.id, s]));

export function tableSpec(model: string): TransferTableSpec | undefined {
  return TABLES_BY_MODEL.get(model);
}

export function scopeById(id: string): TransferScope | undefined {
  return SCOPES_BY_ID.get(id as TransferScopeId);
}

export function isTransferScopeId(value: string): value is TransferScopeId {
  return SCOPES_BY_ID.has(value as TransferScopeId);
}

/** Tables covered by the given scopes, in foreign-key-safe write order. */
export function tablesForScopes(
  scopes: readonly string[],
): TransferTableSpec[] {
  const selected = new Set(scopes);
  return TRANSFER_TABLES.filter((table) => selected.has(table.scope)).sort(
    (a, b) => a.order - b.order,
  );
}

/**
 * Scopes the operator selected whose referenced scopes are missing. Used to
 * warn (never to block) — the import skips orphaned rows and reports them.
 */
export function missingDependencies(
  scopes: readonly string[],
): Array<{ scope: TransferScopeId; missing: TransferScopeId[] }> {
  const selected = new Set(scopes);
  const gaps: Array<{ scope: TransferScopeId; missing: TransferScopeId[] }> =
    [];
  for (const scope of TRANSFER_SCOPES) {
    if (!selected.has(scope.id)) continue;
    const missing = scope.dependsOn.filter((dep) => !selected.has(dep));
    if (missing.length > 0) gaps.push({ scope: scope.id, missing });
  }
  return gaps;
}
