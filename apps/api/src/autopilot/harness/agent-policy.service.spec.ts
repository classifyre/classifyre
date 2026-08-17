import { AgentKind, AgentTriggerMode } from '@prisma/client';
import {
  evidenceUsable,
  shouldRun,
  type ReadinessSignals,
} from './agent-policy.service';
import { FACTORY_POLICY, type AgentPolicy } from './missions';

/**
 * When each agent is allowed to start.
 *
 * The harness had one cadence and one readiness gate for everything, so every
 * agent was paced by the slowest thing in the instance. Measured on a live
 * 151-source workspace: ESCALATION completes in 2.8 minutes and CONFIG in 2.2
 * hours, and both waited behind `inquiry.match.source` holding 16 jobs at
 * ~579 s apiece. For two days only the deterministic DUPLICATES step ran.
 *
 * The gate had an escape hatch — proceed anyway after five requeues — and it
 * fired **zero times** in the entire log, because a fresh cycle landing in the
 * same 600 s coalescing slot dropped the escalating requeue and restarted the
 * count. The staleness backstop below is its replacement, and the tests that
 * matter most here are the ones proving it cannot be starved the same way.
 */
describe('agent scheduling policy', () => {
  const NOW = new Date('2026-08-17T12:00:00.000Z');
  const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

  const signals = (over: Partial<ReadinessSignals> = {}): ReadinessSignals => ({
    matchingBusy: false,
    scansActive: false,
    coverage: { open: 1000, analyzed: 1000 },
    evidence: { usableFindings: 2000, usableCoverage: 0.25 },
    ...over,
  });

  const policy = (over: Partial<AgentPolicy> = {}): AgentPolicy => ({
    triggerMode: AgentTriggerMode.BATCH,
    waitForMatching: false,
    waitForEvidence: false,
    waitForScans: false,
    minIntervalMinutes: 0,
    maxStalenessHours: 0,
    ...over,
  });

  const decide = (
    p: Partial<AgentPolicy>,
    s: Partial<ReadinessSignals> = {},
    over: {
      trigger?: 'scan' | 'express' | 'manual' | 'schedule';
      last?: Date | null;
    } = {},
  ) =>
    shouldRun({
      policy: policy(p),
      signals: signals(s),
      trigger: over.trigger ?? 'scan',
      lastTriggeredAt: over.last === undefined ? minutesAgo(600) : over.last,
      now: NOW,
    });

  describe('the split this exists for', () => {
    it('runs an eager agent while matching is backed up', () => {
      // The live failure: escalation is 2.8 minutes of work and was waiting on
      // a 2.5-hour matching queue it does not read.
      expect(
        decide(FACTORY_POLICY[AgentKind.ESCALATION], { matchingBusy: true })
          .run,
      ).toBe(true);
    });

    it('holds the inquiry agent back while matching is backed up', () => {
      // Its output *is* match counts, so counting against a queue that has not
      // drained produces numbers that are wrong when written.
      const decision = decide(FACTORY_POLICY[AgentKind.INQUIRY], {
        matchingBusy: true,
      });

      expect(decision.run).toBe(false);
      expect(decision.reason).toMatch(/matching/i);
    });

    it('holds detector tuning back while scans are still running', () => {
      const decision = decide(FACTORY_POLICY[AgentKind.CONFIG], {
        scansActive: true,
      });

      expect(decision.run).toBe(false);
      expect(decision.reason).toMatch(/scans/i);
    });
  });

  describe('the staleness backstop', () => {
    it('overrides a gate that will not open', () => {
      // The property the old requeue counter was supposed to provide and never
      // did. Without this, an agent gated on a permanently busy queue never
      // runs again.
      const decision = decide(
        { waitForMatching: true, maxStalenessHours: 24 },
        { matchingBusy: true },
        { last: minutesAgo(25 * 60) },
      );

      expect(decision.run).toBe(true);
      expect(decision.reason).toMatch(/staleness/i);
    });

    it('does not fire before the window elapses', () => {
      expect(
        decide(
          { waitForMatching: true, maxStalenessHours: 24 },
          { matchingBusy: true },
          { last: minutesAgo(23 * 60) },
        ).run,
      ).toBe(false);
    });

    it('treats never-having-run as stale', () => {
      const decision = decide(
        { waitForMatching: true, maxStalenessHours: 24 },
        { matchingBusy: true },
        { last: null },
      );

      expect(decision.run).toBe(true);
      expect(decision.reason).toMatch(/never/i);
    });

    it('can be disabled with 0, and then the gate really does hold', () => {
      expect(
        decide(
          { waitForMatching: true, maxStalenessHours: 0 },
          { matchingBusy: true },
          { last: minutesAgo(60 * 24 * 30) },
        ).run,
      ).toBe(false);
    });
  });

  describe('the minimum-gap floor', () => {
    it('suppresses a run that is too soon', () => {
      const decision = decide(
        { minIntervalMinutes: 30 },
        {},
        { last: minutesAgo(10) },
      );

      expect(decision.run).toBe(false);
      expect(decision.reason).toMatch(/minimum gap/i);
    });

    it('is not pierced by an express event', () => {
      // 184 source completions a day, each able to raise an express cycle: the
      // floor is the only thing standing between that and a run apiece.
      expect(
        decide(
          { triggerMode: AgentTriggerMode.EAGER, minIntervalMinutes: 30 },
          {},
          { trigger: 'express', last: minutesAgo(5) },
        ).run,
      ).toBe(false);
    });

    it('wins over the staleness backstop when both could apply', () => {
      // Contrived but reachable via config: a floor longer than the backstop
      // must not produce a run every evaluation.
      expect(
        decide(
          { minIntervalMinutes: 120, maxStalenessHours: 1 },
          {},
          { last: minutesAgo(90) },
        ).run,
      ).toBe(false);
    });

    it('allows the run once the gap has passed', () => {
      expect(
        decide({ minIntervalMinutes: 30 }, {}, { last: minutesAgo(31) }).run,
      ).toBe(true);
    });
  });

  describe('trigger modes', () => {
    it('never starts a MANUAL agent from a scan', () => {
      expect(decide({ triggerMode: AgentTriggerMode.MANUAL }).run).toBe(false);
    });

    it('starts a MANUAL agent when an operator asks', () => {
      expect(
        decide(
          { triggerMode: AgentTriggerMode.MANUAL },
          {},
          { trigger: 'manual' },
        ).run,
      ).toBe(true);
    });

    it('does not start a SCHEDULED agent from a scan', () => {
      expect(decide({ triggerMode: AgentTriggerMode.SCHEDULED }).run).toBe(
        false,
      );
    });

    it('starts a SCHEDULED agent on its schedule', () => {
      expect(
        decide(
          { triggerMode: AgentTriggerMode.SCHEDULED },
          {},
          { trigger: 'schedule' },
        ).run,
      ).toBe(true);
    });

    it('still rescues a SCHEDULED agent whose schedule stopped firing', () => {
      expect(
        decide(
          { triggerMode: AgentTriggerMode.SCHEDULED, maxStalenessHours: 48 },
          {},
          { last: minutesAgo(49 * 60) },
        ).run,
      ).toBe(true);
    });

    it('does not let one express event satisfy a SETTLED agent', () => {
      // A single high-importance finding is the opposite of the whole-corpus
      // view this mode waits for.
      const decision = decide(
        { triggerMode: AgentTriggerMode.SETTLED },
        {},
        { trigger: 'express' },
      );

      expect(decision.run).toBe(false);
      expect(decision.reason).toMatch(/settled/i);
    });
  });

  describe('manual override', () => {
    it('beats every gate and both guardrails at once', () => {
      // An operator pressing the button and watching nothing happen is worse
      // than anything this protects.
      expect(
        decide(
          {
            triggerMode: AgentTriggerMode.SETTLED,
            waitForMatching: true,
            waitForEvidence: true,
            waitForScans: true,
            minIntervalMinutes: 600,
          },
          {
            matchingBusy: true,
            scansActive: true,
            coverage: { open: 1_000_000, analyzed: 0 },
          },
          { trigger: 'manual', last: minutesAgo(1) },
        ).run,
      ).toBe(true);
    });
  });

  describe('evidence gate', () => {
    it('opens on the absolute floor even when coverage is low', () => {
      // 2000 scored findings is a real ranking regardless of how many more are
      // pending; the live instance sat at 22% with 1.5M scored.
      expect(
        evidenceUsable(
          signals({ coverage: { open: 6_700_000, analyzed: 1_500_000 } }),
        ),
      ).toBe(true);
    });

    it('opens on the ratio for a corpus too small to reach the floor', () => {
      expect(
        evidenceUsable(signals({ coverage: { open: 100, analyzed: 30 } })),
      ).toBe(true);
    });

    it('stays shut when both are missed', () => {
      expect(
        evidenceUsable(signals({ coverage: { open: 100_000, analyzed: 500 } })),
      ).toBe(false);
    });

    it('treats an unscored corpus as ready rather than blocking forever', () => {
      // No findings to score is not the same as none scored — an instance with
      // no semantic stack still needs its agents.
      expect(
        evidenceUsable(signals({ coverage: { open: 0, analyzed: 0 } })),
      ).toBe(true);
    });

    it('honours operator-lowered thresholds', () => {
      expect(
        evidenceUsable(
          signals({
            coverage: { open: 100_000, analyzed: 500 },
            evidence: { usableFindings: 400, usableCoverage: 0.25 },
          }),
        ),
      ).toBe(true);
    });
  });

  describe('factory defaults', () => {
    it('gives every agent kind a policy', () => {
      for (const kind of Object.values(AgentKind)) {
        expect(FACTORY_POLICY[kind]).toBeDefined();
      }
    });

    it('lets the cheap urgent agents act without waiting on anything', () => {
      for (const kind of [AgentKind.ESCALATION, AgentKind.CASE]) {
        const p = FACTORY_POLICY[kind];
        expect(p.triggerMode).toBe(AgentTriggerMode.EAGER);
        expect(p.waitForMatching || p.waitForEvidence || p.waitForScans).toBe(
          false,
        );
      }
    });

    it('keeps the corpus-wide agents waiting for a settled corpus', () => {
      for (const kind of [AgentKind.CONFIG, AgentKind.DETECTOR_AUTHOR]) {
        const p = FACTORY_POLICY[kind];
        expect(p.triggerMode).toBe(AgentTriggerMode.SETTLED);
        expect(p.waitForScans).toBe(true);
        expect(p.waitForEvidence).toBe(true);
      }
    });

    it('gives every automatic agent a backstop', () => {
      // An agent with gates and no backstop can be starved indefinitely, which
      // is the bug this whole feature is correcting.
      for (const kind of [
        AgentKind.ESCALATION,
        AgentKind.CASE,
        AgentKind.INQUIRY,
        AgentKind.CONFIG,
        AgentKind.DETECTOR_AUTHOR,
      ]) {
        expect(FACTORY_POLICY[kind].maxStalenessHours).toBeGreaterThan(0);
      }
    });
  });
});
