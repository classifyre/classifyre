import type { DecisionApplierService } from '../../decision-applier.service';
import type { AgentSearchService } from '../../search/agent-search.service';
import type { ToolContext } from '../tool.types';
import { HypothesesToolset } from './hypotheses.toolset';

describe('HypothesesToolset', () => {
  const threadId = '11111111-1111-4111-8111-111111111111';
  const search = { openHypotheses: jest.fn() };
  const applier = {
    caseThreadGate: jest
      .fn()
      .mockResolvedValue({ mode: 'MANAGED', caseId: 'case-1' }),
    caseGate: jest.fn(),
    linkProbeCore: jest.fn(),
  };
  const tools = new HypothesesToolset(
    search as unknown as AgentSearchService,
    applier as unknown as DecisionApplierService,
  ).list();
  const byName = (name: string) => tools.find((tool) => tool.name === name)!;
  const tc = {
    ctx: { settings: { autopilotCaseEnabled: false } },
  } as unknown as ToolContext;

  beforeEach(() => jest.clearAllMocks());

  it('resolves link_probe through the thread case and case instance flag', async () => {
    const gate = await byName('hypotheses.link_probe').resolveGate!(
      { threadId, customDetectorKey: 'cust_probe' },
      tc,
    );
    expect(applier.caseThreadGate).toHaveBeenCalledWith(threadId, false);
    expect(applier.caseGate).not.toHaveBeenCalled();
    expect(gate).toEqual({
      mode: 'MANAGED',
      entityType: 'case',
      entityId: 'case-1',
    });
  });

  it('teaches that thread ids come from hypotheses.open', async () => {
    await expect(
      byName('hypotheses.link_probe').handler(
        { threadId: 'case-not-thread', customDetectorKey: 'cust_probe' },
        tc,
      ),
    ).rejects.toThrow(/Hypothesis thread ids come from hypotheses\.open/);
  });

  it('forwards detector identity to the gate-free applier primitive', async () => {
    await byName('hypotheses.link_probe').handler(
      {
        threadId,
        customDetectorKey: 'cust_probe',
        detectorId: 'det-1',
        note: 'Tests key reuse.',
      },
      tc,
    );
    expect(applier.linkProbeCore).toHaveBeenCalledWith({
      threadId,
      customDetectorKey: 'cust_probe',
      detectorId: 'det-1',
      note: 'Tests key reuse.',
    });
  });
});
