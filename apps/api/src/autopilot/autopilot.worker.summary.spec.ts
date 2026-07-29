import { formatSummary } from './autopilot.worker';
import type { ApplySummary } from './decision-applier.service';

/**
 * G-032. Run summaries counted every successful tool call as "applied",
 * including pure reads. Manual CASE / DETECTOR_AUTHOR / ESCALATION runs
 * reported 11, 2 and 4 applied while each persisted decisionCount: 0 and a
 * direct state diff found no mutation. The summary is the first thing an
 * operator reads, so it has to mean what it says.
 */
describe('formatSummary (G-032)', () => {
  const summary = (over: Partial<ApplySummary> = {}): ApplySummary => ({
    applied: 0,
    readOk: 0,
    skippedObserveOnly: 0,
    failed: 0,
    createdInquiries: [],
    createdCases: [],
    ...over,
  });

  // A run that read 11 things and changed nothing must never read as work
  // done. It now says so in words rather than as "0 applied" — restraint is a
  // result, and reporting it as a row of zeros taught both the operator and
  // the model reading its own history that the cycle had been wasted.
  it('names a read-only run as deliberate, never as applied work', () => {
    const text = formatSummary(summary({ applied: 0, readOk: 11 }));

    expect(text).toContain('observed only');
    expect(text).toContain('11 read');
    expect(text).not.toContain('11 applied');
    expect(text).not.toContain('1 applied');
  });

  it('carries the reason when the model gave one', () => {
    const text = formatSummary(
      summary({
        applied: 0,
        readOk: 6,
        finishSummary: 'all matches are boilerplate; nothing warranted action',
      }),
    );

    expect(text).toContain('boilerplate');
  });

  // A run that failed has not "observed only" — it has a problem to report.
  it('does not dress a failed run up as restraint', () => {
    const text = formatSummary(summary({ applied: 0, readOk: 3, failed: 2 }));

    expect(text).toContain('2 failed');
    expect(text).not.toContain('observed only');
  });

  it('counts only mutations as applied', () => {
    const text = formatSummary(summary({ applied: 2, readOk: 9 }));

    expect(text).toContain('2 applied');
    expect(text).toContain('9 read');
  });

  it('still reports observe-only skips and failures', () => {
    const text = formatSummary(
      summary({ applied: 1, readOk: 3, skippedObserveOnly: 4, failed: 2 }),
    );

    expect(text).toContain('1 applied');
    expect(text).toContain('3 read');
    expect(text).toContain('4 observe-only');
    expect(text).toContain('2 failed');
  });

  it('tolerates a summary persisted before read counting existed', () => {
    const legacy = summary();
    delete (legacy as { readOk?: number }).readOk;

    expect(formatSummary(legacy)).toContain('0 read');
  });

  it('still names created inquiries and cases', () => {
    const text = formatSummary(
      summary({
        applied: 2,
        createdInquiries: [{ id: 'q1', title: 'Legal references' }],
        createdCases: [{ id: 'c1', title: 'DS6 review' }],
      }),
    );

    expect(text).toContain('Legal references');
    expect(text).toContain('DS6 review');
  });
});
