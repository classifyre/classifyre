import { TRACE_KINDS, type TraceKind } from '../graph-trace';

/**
 * The kinds of connection Explore follows. The first four are walks of the
 * edge table (graph-trace.ts); `meaning` goes through the glossary terms two
 * assets share, and `alike` through their vectors. Neither of the last two is
 * ever written to `edges`.
 */
export const EXPLORE_KINDS = [
  'lineage',
  'links',
  'duplicates',
  'similar',
  'meaning',
  'alike',
] as const;
export type ExploreKind = (typeof EXPLORE_KINDS)[number];

export type EdgeWalkKind = Exclude<TraceKind, 'meaning'>;
export const EDGE_WALK_KINDS: readonly EdgeWalkKind[] = TRACE_KINDS.filter(
  (kind): kind is EdgeWalkKind => kind !== 'meaning',
);

/** Assets each edge kind may bring in. Walked separately, so a hub of
 * look-alikes cannot crowd the lineage out. */
export const EXPLORE_PER_KIND = 40;
/** Assets the meaning lens may bring in. */
export const EXPLORE_MEANING_LIMIT = 60;
/** Look-alikes per seed, and how many seeds are read for them. */
export const EXPLORE_ALIKE_PER_SEED = 8;
export const EXPLORE_ALIKE_SEEDS = 3;
/** Assets a lineage or links trace may bring in when it goes further than one step. */
export const EXPLORE_TRACE_LIMIT = 120;
/** Kinds traced as far and as one-way as asked. */
export const TRACED_KINDS: ReadonlySet<EdgeWalkKind> = new Set([
  'lineage',
  'links',
]);
/** Duplicates and shared values never go further than this. */
export const SCORED_DEPTH_MAX = 2;

/** Connections kept: all, those inside the explored source, those leaving it. */
export const EXPLORE_SCOPES = ['all', 'internal', 'external'] as const;
export type ExploreScope = (typeof EXPLORE_SCOPES)[number];
/** Starting points picked for a source: its most connected assets. */
export const EXPLORE_SOURCE_SEEDS = 10;
