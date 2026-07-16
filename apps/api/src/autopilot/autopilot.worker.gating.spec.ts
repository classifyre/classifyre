import { AgentKind } from '@prisma/client';
import { AutopilotWorker } from './autopilot.worker';

/**
 * G-027 / G-029. Disabling the scan-cycle agents did not stop an already
 * running cycle: every member launched anyway and had to be cancelled by hand
 * as it appeared. Two independent causes:
 *
 *  1. runCycle read the settings once and then ran five agents sequentially
 *     over many minutes, so a mid-cycle disable could not be seen.
 *  2. `cycle.only` replaced the flag check outright, so any job carrying
 *     agentKinds ran every named agent regardless of the switches — including
 *     rerunRun, which sets agentKinds but leaves `manual` unset for a
 *     scan-triggered run.
 */
describe('AutopilotWorker agent gating (G-027/G-029)', () => {
  const ALL_ON = {
    aiEnabled: true,
    autopilotInquiryEnabled: true,
    autopilotCaseEnabled: true,
    autopilotConfigEnabled: true,
    autopilotDetectorEnabled: true,
    autopilotEscalationEnabled: true,
  };
  const ALL_OFF = {
    aiEnabled: true,
    autopilotInquiryEnabled: false,
    autopilotCaseEnabled: false,
    autopilotConfigEnabled: false,
    autopilotDetectorEnabled: false,
    autopilotEscalationEnabled: false,
  };

  const PIPELINE = [
    AgentKind.INQUIRY,
    AgentKind.CASE,
    AgentKind.CONFIG,
    AgentKind.DETECTOR_AUTHOR,
    AgentKind.ESCALATION,
  ];

  let findUnique: jest.Mock;
  let worker: AutopilotWorker;

  const build = (settings: Record<string, unknown> | null) => {
    findUnique = jest.fn().mockResolvedValue(settings);
    worker = new AutopilotWorker(
      { instanceSettings: { findUnique } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  };

  const enabled = (kind: AgentKind, cycle: Record<string, unknown>) =>
    (worker as any).agentEnabled(kind, cycle) as Promise<boolean>;

  const scanCycle = (over: Record<string, unknown> = {}) => ({
    sourceId: 's1',
    runnerId: 'r1',
    manual: false,
    only: null,
    cycleKey: 'scan:s1:r1',
    trigger: 'scan_completed',
    ...over,
  });

  describe('a scan cycle honours the master switches', () => {
    it('runs every agent when all are enabled', async () => {
      build(ALL_ON);

      for (const kind of PIPELINE) {
        await expect(enabled(kind, scanCycle())).resolves.toBe(true);
      }
    });

    it('runs no agent when all are disabled', async () => {
      build(ALL_OFF);

      for (const kind of PIPELINE) {
        await expect(enabled(kind, scanCycle())).resolves.toBe(false);
      }
    });

    it('gates each agent on its own flag', async () => {
      build({ ...ALL_OFF, autopilotCaseEnabled: true });

      await expect(enabled(AgentKind.CASE, scanCycle())).resolves.toBe(true);
      await expect(enabled(AgentKind.INQUIRY, scanCycle())).resolves.toBe(
        false,
      );
    });

    // The cycle's early-exit gate used to test only the inquiry and case flags.
    // Enabling any of the other three left the gate closed, so the agent the
    // operator had just switched on never ran.
    it.each([
      ['autopilotConfigEnabled', AgentKind.CONFIG],
      ['autopilotDetectorEnabled', AgentKind.DETECTOR_AUTHOR],
      ['autopilotEscalationEnabled', AgentKind.ESCALATION],
    ])(
      'runs %s alone when it is the only agent enabled',
      async (flag, kind) => {
        build({ ...ALL_OFF, [flag]: true });

        await expect(enabled(kind, scanCycle())).resolves.toBe(true);
        await expect(enabled(AgentKind.INQUIRY, scanCycle())).resolves.toBe(
          false,
        );
        await expect(enabled(AgentKind.CASE, scanCycle())).resolves.toBe(false);
      },
    );

    it('runs nothing when AI itself is off', async () => {
      build({ ...ALL_ON, aiEnabled: false });

      for (const kind of PIPELINE) {
        await expect(enabled(kind, scanCycle())).resolves.toBe(false);
      }
    });

    it('runs nothing when settings are missing entirely', async () => {
      build(null);

      await expect(enabled(AgentKind.INQUIRY, scanCycle())).resolves.toBe(
        false,
      );
    });
  });

  describe('cycle.only narrows, it does not authorise', () => {
    it('does NOT run a disabled agent just because it was named', async () => {
      // The rerunRun shape: agentKinds set, manual unset, scan-triggered.
      build(ALL_OFF);

      const cycle = scanCycle({ only: [AgentKind.CONFIG] });

      await expect(enabled(AgentKind.CONFIG, cycle)).resolves.toBe(false);
    });

    it('does not run the whole pipeline when a job names it and agents are off', async () => {
      build(ALL_OFF);

      const cycle = scanCycle({ only: PIPELINE });

      for (const kind of PIPELINE) {
        await expect(enabled(kind, cycle)).resolves.toBe(false);
      }
    });

    it('still restricts to the named agents when they are enabled', async () => {
      build(ALL_ON);

      const cycle = scanCycle({ only: [AgentKind.CONFIG] });

      await expect(enabled(AgentKind.CONFIG, cycle)).resolves.toBe(true);
      await expect(enabled(AgentKind.INQUIRY, cycle)).resolves.toBe(false);
    });
  });

  describe('manual runs remain explicit operator intent', () => {
    it('overrides disabled flags', async () => {
      build(ALL_OFF);

      await expect(
        enabled(AgentKind.INQUIRY, scanCycle({ manual: true })),
      ).resolves.toBe(true);
    });

    it('still respects the named subset', async () => {
      build(ALL_OFF);

      const cycle = scanCycle({ manual: true, only: [AgentKind.CASE] });

      await expect(enabled(AgentKind.CASE, cycle)).resolves.toBe(true);
      await expect(enabled(AgentKind.INQUIRY, cycle)).resolves.toBe(false);
    });

    it('does not override the AI master switch', async () => {
      build({ ...ALL_OFF, aiEnabled: false });

      await expect(
        enabled(AgentKind.INQUIRY, scanCycle({ manual: true })),
      ).resolves.toBe(false);
    });
  });

  describe('settings are re-read per agent', () => {
    it('sees a disable that lands mid-cycle', async () => {
      // A cycle runs its agents over many minutes. The operator disables
      // everything after INQUIRY has already started.
      build(ALL_ON);
      await expect(enabled(AgentKind.INQUIRY, scanCycle())).resolves.toBe(true);

      findUnique.mockResolvedValue(ALL_OFF);

      for (const kind of PIPELINE.slice(1)) {
        await expect(enabled(kind, scanCycle())).resolves.toBe(false);
      }
    });

    it('reads settings freshly for every agent, never once per cycle', async () => {
      build(ALL_ON);

      for (const kind of PIPELINE) {
        await enabled(kind, scanCycle());
      }

      expect(findUnique).toHaveBeenCalledTimes(PIPELINE.length);
    });
  });
});
