import { assertChurnBudget } from './config.toolset';
import type { DetectionImpact } from '../../detection-impact.service';
import type { DetectionPostureReport } from '../../detection-posture.service';

/**
 * The brake on a detector set that keeps moving.
 *
 * Removing a detector resolves every open finding it produced, so a source
 * whose detection is retuned 22 times in three days never accumulates an
 * evidence base for anything to be investigated from. Both guards are
 * deliberately one-sided: an agent must always be able to ADD detection, on any
 * source, in any posture — the failure being corrected was a ratchet that only
 * ever subtracted.
 */
describe('detection churn budget', () => {
  const posture = (
    over: Partial<DetectionPostureReport> = {},
  ): DetectionPostureReport => ({
    sourceId: 's1',
    posture: 'CONVERGING',
    reason: 'detection has settled but nothing watches its findings yet',
    openFindings: 5000,
    citedByCases: 0,
    watchingInquiries: 0,
    inquiryMatches: 0,
    completedScans: 10,
    scansSinceDetectionChanged: 4,
    tunesLast24h: 1,
    tuneBudgetRemaining: 3,
    lastChangeUnevaluated: false,
    ...over,
  });

  const impact = (over: Partial<DetectionImpact> = {}): DetectionImpact => ({
    removedDetectors: [],
    addedDetectors: [],
    resolves: { total: 0, byDetector: [], highImportance: 0 },
    protectedEvidence: { total: 0, citedByCases: [], watchedByInquiries: [] },
    citationScanComplete: true,
    ...over,
  });

  const reduction = impact({
    removedDetectors: ['built-in PII'],
    resolves: { total: 44174, byDetector: [], highImportance: 120 },
  });
  const addition = impact({ addedDetectors: ['built-in SECRETS'] });

  it('refuses a reduction once the daily budget is spent', () => {
    expect(() =>
      assertChurnBudget(
        posture({ tunesLast24h: 4, tuneBudgetRemaining: 0 }),
        reduction,
      ),
    ).toThrow(/already changed this source's detection 4 time\(s\)/);
  });

  it('refuses a reduction stacked on a change nobody has evaluated', () => {
    expect(() =>
      assertChurnBudget(posture({ lastChangeUnevaluated: true }), reduction),
    ).toThrow(/has not been evaluated yet/);
  });

  it('names what the refused patch would have cost', () => {
    expect(() =>
      assertChurnBudget(posture({ lastChangeUnevaluated: true }), reduction),
    ).toThrow(/44174 open finding\(s\)/);
  });

  it('allows a reduction within budget on an evaluated source', () => {
    expect(() => assertChurnBudget(posture(), reduction)).not.toThrow();
  });

  // The one-sidedness, asserted in both blocking conditions: a source that is
  // detecting too little must always be fixable, immediately.
  it('never refuses a patch that only adds detection', () => {
    expect(() =>
      assertChurnBudget(
        posture({
          tunesLast24h: 12,
          tuneBudgetRemaining: 0,
          lastChangeUnevaluated: true,
        }),
        addition,
      ),
    ).not.toThrow();
  });

  it('applies no brakes at all while the source is EXPLORING', () => {
    expect(() =>
      assertChurnBudget(
        posture({
          posture: 'EXPLORING',
          tunesLast24h: 9,
          tuneBudgetRemaining: 0,
          lastChangeUnevaluated: true,
        }),
        reduction,
      ),
    ).not.toThrow();
  });

  it('states the posture it is enforcing so the agent can reason about it', () => {
    expect(() =>
      assertChurnBudget(
        posture({ posture: 'STABLE', lastChangeUnevaluated: true }),
        reduction,
      ),
    ).toThrow(/Source posture: STABLE/);
  });
});
