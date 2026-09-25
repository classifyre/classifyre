/**
 * Storage datasets of one workspace: what the Cleanup tab lists, measures,
 * and — for the cleanable ones — wipes.
 *
 * Two groups, and the distinction is the whole point of this file:
 *
 * - PROTECTED_DATASETS are the investigation itself (sources, findings,
 *   assets, cases, inquiries, glossary). They are listed with their sizes so
 *   the operator sees where the bytes live, but the API refuses to clean
 *   them — there is no cleanup key for them at all.
 * - CLEANABLE_DATASETS are ephemeral or derived data: scan history, duplicate
 *   artefacts, vectors, harness runs, finished queue jobs, rebuilt stats and
 *   graphs, finished transfers. Each has a stable `key` used by
 *   `POST /maintenance/cleanup/:key`, the exact physical tables involved,
 *   and the safety rules the service enforces (terminal states only, running
 *   work skipped, FK dependants handled first).
 *
 * Physical table names are snake_case (see the migrations); the pg-boss
 * queue tables live in a separate `pgboss_<id>` schema and are resolved at
 * runtime, so the scheduler dataset carries `bossTables` instead.
 *
 * One table is split between two datasets: `edges` holds both the asset
 * lineage (protected — only a source rescan rebuilds it) and the duplicate
 * engine's scored pairs (derived — the next duplicate check rebuilds them).
 * The split is by `relation_type` ({@link SCORED_EDGE_RELATION_TYPES}); the
 * overview attributes the table's size by the planner's frequency of each
 * type, and the duplicates cleanup removes only the scored rows. Never
 * TRUNCATE `edges` as a whole.
 */
export interface ProtectedDataset {
  key: string;
  tables: string[];
}

export interface CleanableDataset {
  key: CleanupKey;
  tables: string[];
  /** pg-boss tables inside the namespace's boss schema (not the app schema). */
  bossTables?: string[];
  /**
   * Rows of a shared table that belong to this dataset — the scored share of
   * `edges` for duplicates. Listed apart from `tables` because the wipe must
   * filter them, never truncate.
   */
  sharedRows?: { table: string; column: string; values: readonly string[] };
}

/**
 * Edge types the duplicate engine writes — and therefore rebuilds. Mirrors
 * `CORRELATION_RELATION_TYPES` in `correlation.service.ts` (a spec pins the
 * two together). Every other relation type in `edges` is lineage.
 */
export const SCORED_EDGE_RELATION_TYPES = [
  'related',
  'likely_duplicate',
  'identical_content',
] as const;

export type CleanupKey =
  | 'scans'
  | 'duplicates'
  | 'embeddings'
  | 'harness'
  | 'scheduler'
  | 'stats'
  | 'graph'
  | 'transfers';

export const CLEANUP_KEYS: readonly CleanupKey[] = [
  'scans',
  'duplicates',
  'embeddings',
  'harness',
  'scheduler',
  'stats',
  'graph',
  'transfers',
];

export function isCleanupKey(value: string): value is CleanupKey {
  return (CLEANUP_KEYS as readonly string[]).includes(value);
}

export const PROTECTED_DATASETS: readonly ProtectedDataset[] = [
  {
    key: 'sources',
    tables: ['sources', 'source_files'],
  },
  {
    key: 'findings',
    tables: [
      'findings',
      'custom_detector_extractions',
      'extraction_payloads',
      'custom_detector_feedback',
      'finding_bulk_operations',
    ],
  },
  // `edges` here means its lineage share; the scored share is measured and
  // cleaned under `duplicates`.
  {
    key: 'assets',
    tables: ['assets', 'edges'],
  },
  {
    key: 'cases',
    tables: [
      'cases',
      'case_leads',
      'case_events',
      'case_notes',
      'case_threads',
      'case_thread_entries',
      'case_thread_support',
      'case_activities',
      'case_boards',
      'case_board_items',
      'case_board_links',
      'case_board_snapshots',
      'case_findings',
      'case_evidence',
      'case_inquiries',
      'case_hypotheses',
      'hypothesis_support',
    ],
  },
  {
    key: 'inquiries',
    tables: ['inquiries'],
  },
  {
    key: 'glossary',
    tables: ['glossary_terms', 'glossary_references'],
  },
];

export const CLEANABLE_DATASETS: readonly CleanableDataset[] = [
  // Scan history. Runner rows are referenced by assets (last-seen runner,
  // nullable), notifications (auto-null) and runner_assets (auto-cascade);
  // the service nulls the asset side first and only touches terminal runs.
  { key: 'scans', tables: ['runners', 'runner_assets'] },
  // Duplicate-detection artefacts, including the scored pairs in `edges` —
  // on a real incident 17 GB of a 42 GB database, which this dataset used to
  // miss entirely. Human review decisions (verdicts) and review batches are
  // deliberately NOT listed: they are triage work, and everything here is
  // rebuilt by the next duplicate check. Owned by the duplicate-detection
  // switch (Settings → Cleanup › Features).
  {
    key: 'duplicates',
    tables: [
      'correlation_pair_staging',
      'correlation_pair_signatures',
      'asset_correlation_values',
      'asset_signatures',
      'asset_clusters',
      'asset_cluster_members',
      'correlation_source_pairs',
      'correlation_patterns',
      'correlation_cluster_patterns',
      'asset_label_profiles',
      'asset_lineage_profiles',
    ],
    sharedRows: {
      table: 'edges',
      column: 'relation_type',
      values: SCORED_EDGE_RELATION_TYPES,
    },
  },
  // The semantic layer: vectors, the evidence rankings derived from them
  // (importance scores — reset to 0 on the findings they belong to), the
  // document text chunks they were embedded from, and the spaces that tie
  // them together. Embedding settings (config) stay. Owned by the embeddings
  // switch: re-embedding findings is automatic when it is on, but chunk text
  // only comes back by rescanning with the scan cache off.
  {
    key: 'embeddings',
    tables: [
      'content_embeddings',
      'finding_evidence_analyses',
      'asset_chunks',
      'embedding_spaces',
    ],
  },
  // AI harness runs incl. dreams, with their logs and decisions, plus the
  // supervisor's journal and inbox (operational chatter). Learned agent
  // memory, briefs, configs, goals, live state and undo entries stay —
  // history goes, knowledge and safety stay.
  {
    key: 'harness',
    tables: [
      'agent_runs',
      'agent_logs',
      'agent_decisions',
      'supervisor_journal_entries',
      'supervisor_inbox_events',
    ],
  },
  // Finished queue jobs. Pending, scheduled and running jobs are never
  // touched, and neither are the cron schedules themselves.
  { key: 'scheduler', tables: [], bossTables: ['job', 'archive'] },
  // Derived stats, rebuilt by the stats worker (state rows upsert, so a
  // truncated state simply restarts the cursor).
  {
    key: 'stats',
    tables: [
      'finding_stats_daily',
      'finding_stats_asset_daily',
      'finding_stats_first_daily',
      'finding_stats_first_asset_daily',
      'finding_stats_dirty_days',
      'finding_stats_state',
    ],
  },
  // Derived source graph, rebuilt by the graph worker.
  {
    key: 'graph',
    tables: [
      'source_graph_nodes',
      'source_graph_links',
      'source_graph_boundary_assets',
      'source_graph_state',
    ],
  },
  // Finished transfers (uploads waiting for import are staged, not finished,
  // and stay). Chunks cascade from their job.
  { key: 'transfers', tables: ['data_transfer_jobs', 'data_transfer_chunks'] },
];

/** Every physical table the overview measures, for the "everything else" note. */
export function allListedTables(): string[] {
  const tables = new Set<string>();
  for (const d of PROTECTED_DATASETS) for (const t of d.tables) tables.add(t);
  for (const d of CLEANABLE_DATASETS) for (const t of d.tables) tables.add(t);
  return [...tables];
}
