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
}

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
      'finding_evidence_analyses',
      'custom_detector_extractions',
      'extraction_payloads',
      'custom_detector_feedback',
      'finding_bulk_operations',
    ],
  },
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
  // Duplicate-detection artefacts. Human review decisions (verdicts) and
  // review batches are deliberately NOT listed: they are triage work, and
  // everything here is rebuilt by the next duplicate check.
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
  },
  // Vectors and their chunk texts. Spaces and embedding settings (config)
  // stay; re-running the embedding index rebuilds everything listed.
  { key: 'embeddings', tables: ['content_embeddings', 'asset_chunks'] },
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
