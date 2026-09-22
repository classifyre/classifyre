import { classifyMatch, RunAnchor, retiredCandidateWhere } from './match-state';
import { InquiryMatchers } from './inquiry-matcher';

/**
 * Newness and its mirror, measured against the run anchor.
 *
 * The cases that matter here are the ones where a finding LOOKS retired but is
 * not. "Resolved, and carrying the latest run's id" is the tempting rule and it
 * is wrong: a manual resolve sets resolvedAt and never touches runnerId, so a
 * finding this run re-detected and a person then triaged reads as a
 * disappearance. Telling an investigator that evidence vanished from the corpus
 * when in fact a colleague marked it a false positive is worse than saying
 * nothing, so every one of those paths gets a test.
 */
describe('classifyMatch', () => {
  const ANCHOR_AT = new Date('2026-09-20T10:00:00Z');
  const BEFORE = new Date('2026-09-19T10:00:00Z');
  const AFTER = new Date('2026-09-20T11:00:00Z');

  const anchors = new Map<string, RunAnchor>([
    ['s1', { runnerId: 'run-latest', startedAt: ANCHOR_AT }],
  ]);

  const GONE_REASON = 'Detection no longer present in scan';

  describe('open findings', () => {
    it('is NEW when the latest run created it', () => {
      expect(
        classifyMatch(
          { sourceId: 's1', status: 'OPEN', createdAt: AFTER },
          anchors,
        ),
      ).toBe('NEW');
    });

    it('is NEW at exactly the anchor instant', () => {
      // The run's own findings are created at or after it started; a strict
      // comparison would drop whatever landed in the first tick.
      expect(
        classifyMatch(
          { sourceId: 's1', status: 'OPEN', createdAt: ANCHOR_AT },
          anchors,
        ),
      ).toBe('NEW');
    });

    it('is ONGOING once an earlier run had already found it', () => {
      expect(
        classifyMatch(
          { sourceId: 's1', status: 'OPEN', createdAt: BEFORE },
          anchors,
        ),
      ).toBe('ONGOING');
    });

    it('is ONGOING when no run has ever completed for the source', () => {
      // Nothing to measure against, so nothing may claim to be new.
      expect(
        classifyMatch(
          { sourceId: 'unscanned', status: 'OPEN', createdAt: AFTER },
          anchors,
        ),
      ).toBe('ONGOING');
    });
  });

  describe('retired findings', () => {
    it('is GONE when the latest run stopped detecting it', () => {
      expect(
        classifyMatch(
          {
            sourceId: 's1',
            status: 'RESOLVED',
            createdAt: BEFORE,
            resolvedAt: AFTER,
            resolutionReason: GONE_REASON,
          },
          anchors,
        ),
      ).toBe('GONE');
    });

    it('is GONE when the asset itself was deleted from the source', () => {
      expect(
        classifyMatch(
          {
            sourceId: 's1',
            status: 'RESOLVED',
            createdAt: BEFORE,
            resolvedAt: AFTER,
            resolutionReason: 'Asset deleted from source (full scan)',
          },
          anchors,
        ),
      ).toBe('GONE');
    });

    it('is NOT gone when a person resolved it by hand after the scan', () => {
      // The whole reason this does not key on runnerId. Triage right after a
      // scan is the common case, and the finding still carries that run's id.
      expect(
        classifyMatch(
          {
            sourceId: 's1',
            status: 'RESOLVED',
            createdAt: BEFORE,
            resolvedAt: AFTER,
            resolutionReason: 'Duplicate of the Q3 filing',
          },
          anchors,
        ),
      ).toBeNull();
    });

    it('is NOT gone when it carries no resolution reason at all', () => {
      expect(
        classifyMatch(
          {
            sourceId: 's1',
            status: 'RESOLVED',
            createdAt: BEFORE,
            resolvedAt: AFTER,
            resolutionReason: null,
          },
          anchors,
        ),
      ).toBeNull();
    });

    it('is NOT gone when an EARLIER run retired it', () => {
      // Already reported as gone by the run that did it. Repeating it every
      // run afterwards would make "gone" a permanent state rather than a delta.
      expect(
        classifyMatch(
          {
            sourceId: 's1',
            status: 'RESOLVED',
            createdAt: BEFORE,
            resolvedAt: BEFORE,
            resolutionReason: GONE_REASON,
          },
          anchors,
        ),
      ).toBeNull();
    });

    it.each(['FALSE_POSITIVE', 'IGNORED'])(
      'is not reported at all when %s',
      (status) => {
        // An operator's verdict, not a disappearance.
        expect(
          classifyMatch(
            {
              sourceId: 's1',
              status,
              createdAt: BEFORE,
              resolvedAt: AFTER,
              resolutionReason: GONE_REASON,
            },
            anchors,
          ),
        ).toBeNull();
      },
    );
  });
});

describe('retiredCandidateWhere', () => {
  const matchers: InquiryMatchers = {
    matchAllSources: false,
    sourceIds: ['s1'],
    detectorTypes: [],
    customDetectorKeys: [],
    findingTypes: [],
    findingTypeRegex: [],
    findingValueRegex: [],
  };

  it('returns nothing to walk when no source has completed a run', () => {
    expect(retiredCandidateWhere(matchers, new Map())).toBeNull();
  });

  it('bounds the walk in SQL to the latest run of each source', () => {
    const startedAt = new Date('2026-09-20T10:00:00Z');
    const where = retiredCandidateWhere(
      matchers,
      new Map([['s1', { runnerId: 'run-latest', startedAt }]]),
    );

    // The candidate set is the corpus; this one has to stay a single run's
    // retirements, or the mirror walk costs as much as the main one.
    expect(where?.AND).toEqual(
      expect.arrayContaining([
        { status: 'RESOLVED' },
        { OR: [{ sourceId: 's1', resolvedAt: { gte: startedAt } }] },
      ]),
    );
  });
});
