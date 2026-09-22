import { Prisma } from '@prisma/client';
import { AUTO_RETIREMENT_REASONS } from '../types/finding-history';
import { candidateWhere, InquiryMatchers } from './inquiry-matcher';

/**
 * Where a match sits relative to the latest run of its source.
 *
 * The axis this replaces was "has the reader seen it" (`createdAt >
 * matchesSeenAt`), which meant opening an inquiry destroyed its own signal:
 * the badge cleared because someone looked, not because anything changed. It
 * also had no way to say the opposite — a finding the last scan took away just
 * vanished from the list with no trace.
 *
 * Newness is a property of (finding, run), so it is derived here from the run
 * anchor rather than stored. Nothing persists per match; the durable record of
 * what arrived when is the inquiry timeline.
 */
export type InquiryMatchState = 'NEW' | 'ONGOING' | 'GONE';

/** The latest run of one source that actually finished observing the corpus. */
export interface RunAnchor {
  runnerId: string;
  startedAt: Date;
}

export type RunAnchors = ReadonlyMap<string, RunAnchor>;

/** The columns a classification needs, beyond the matcher's own dimensions. */
export interface StatefulFinding {
  sourceId: string;
  createdAt?: Date;
  status?: string;
  resolvedAt?: Date | null;
  resolutionReason?: string | null;
}

/**
 * Classify one finding that has ALREADY been confirmed to match the matchers.
 *
 * Returns null for a row that matches but should not be reported in either
 * direction — principally a RESOLVED finding an operator resolved by hand.
 * That case is the whole reason this does not simply test `runnerId`: a manual
 * resolve sets `resolvedAt` and never touches `runnerId`, so a finding the
 * latest run re-detected and a human then triaged an hour later is otherwise
 * indistinguishable from one the run retired. Triage right after a scan is the
 * common case, not the edge case.
 */
export function classifyMatch(
  f: StatefulFinding,
  anchors: RunAnchors,
): InquiryMatchState | null {
  const anchor = anchors.get(f.sourceId);
  const status = f.status ?? 'OPEN';

  if (status === 'OPEN') {
    if (!anchor) return 'ONGOING';
    const createdAt = f.createdAt;
    return createdAt && createdAt.getTime() >= anchor.startedAt.getTime()
      ? 'NEW'
      : 'ONGOING';
  }

  if (status !== 'RESOLVED') return null;
  if (!anchor) return null;
  if (
    !f.resolutionReason ||
    !AUTO_RETIREMENT_REASONS.includes(f.resolutionReason)
  )
    return null;
  const resolvedAt = f.resolvedAt;
  if (!resolvedAt || resolvedAt.getTime() < anchor.startedAt.getTime())
    return null;
  return 'GONE';
}

/**
 * The `where` for "matches, and the latest run of its source took it away".
 *
 * Bounded in SQL rather than in memory on purpose. The OPEN candidate set is
 * the corpus; this one is a single run's retirements per source, so the walk
 * behind it stays small even on a matcher that names every source.
 */
export function retiredCandidateWhere(
  m: InquiryMatchers,
  anchors: RunAnchors,
): Prisma.FindingWhereInput | null {
  const perSource = Array.from(anchors.entries()).map(([sourceId, anchor]) => ({
    sourceId,
    resolvedAt: { gte: anchor.startedAt },
  }));
  // No anchor anywhere means no source has ever completed a run, so nothing can
  // have been retired by one.
  if (perSource.length === 0) return null;

  return {
    AND: [
      candidateWhere(m, 'OPEN_AND_RESOLVED'),
      { status: 'RESOLVED' },
      { resolutionReason: { in: [...AUTO_RETIREMENT_REASONS] } },
      { OR: perSource },
    ],
  };
}
