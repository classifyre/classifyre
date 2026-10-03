/**
 * pg-boss queues of the semantic layer. Each is registered per namespace
 * (integration rule 8) and coalesced: the job is a wake-up signal, and the work
 * itself is described by persisted rows (`semantic_link_jobs`) or recomputed
 * from scratch, so a coalesced or lost job never loses a change.
 */
export const SEMANTIC_LINKS_QUEUE = 'semantic-links';
export const SEMANTIC_LINKS_RECONCILE_QUEUE = 'semantic-links-reconcile';
export const VOCABULARY_REFRESH_QUEUE = 'vocabulary-refresh';
export const SEMANTIC_SUGGESTIONS_QUEUE = 'semantic-suggestions';
export const SEMANTIC_SUGGESTIONS_NIGHTLY_QUEUE =
  'semantic-suggestions-nightly';
export const SEMANTIC_MAP_QUEUE = 'semantic-map-rebuild';

/** Coalescing windows. */
export const SEMANTIC_LINKS_COALESCE_SECONDS = 5;
export const VOCABULARY_COALESCE_SECONDS = 30;
export const SEMANTIC_SUGGESTIONS_COALESCE_SECONDS = 120;
/** The map rebuilds at most every 5 minutes (SL5 B6). */
export const SEMANTIC_MAP_COALESCE_SECONDS = 300;

/** Nightly crons (UTC). */
export const SEMANTIC_RECONCILE_CRON = '23 2 * * *';
export const SEMANTIC_SUGGESTIONS_CRON = '41 2 * * *';

/** Linker batch size (SL3 R2). */
export const LINKER_BATCH = 500;
/** Bindings evaluated per SQL statement. */
export const LINKER_BINDING_CHUNK = 25;
/** GONE rows older than this are purged (SL3 R1). */
export const GONE_RETENTION_DAYS = 90;

export type SemanticLinkJobKind = 'INCREMENTAL' | 'BACKFILL' | 'RECONCILE';

export interface SemanticLinkTrigger {
  runId?: string;
  sourceId?: string;
  assetIds?: string[];
  bindingIds?: string[];
  termIds?: string[];
  /** Every active binding (pack installs, imports, "Rebuild"). */
  all?: boolean;
  reason?: string;
}
