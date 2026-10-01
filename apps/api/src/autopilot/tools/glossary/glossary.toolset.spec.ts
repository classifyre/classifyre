import { AiManagementMode } from '@prisma/client';
import { GlossaryToolset } from './glossary.toolset';
import type { Tool, ToolContext } from '../tool.types';

describe('GlossaryToolset', () => {
  const glossary = {
    lookup: jest.fn(),
    upsert: jest.fn(),
    resolveOrThrow: jest.fn(),
  };
  const relations = { create: jest.fn(), approve: jest.fn() };
  const bindings = {
    create: jest.fn(),
    approve: jest.fn(),
    disable: jest.fn(),
    get: jest.fn(),
    verifyPreviewToken: jest.fn(),
    preview: jest.fn(),
    specOf: jest.fn(),
  };
  const undo = { record: jest.fn() };
  const prisma = {
    glossaryBinding: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    glossaryRelation: { findUnique: jest.fn() },
    glossaryTerm: { count: jest.fn() },
    agentDecision: { count: jest.fn() },
    semanticSuggestion: { findUnique: jest.fn(), update: jest.fn() },
    finding: { findUnique: jest.fn() },
  };
  const tools = new GlossaryToolset(
    glossary as never,
    relations as never,
    bindings as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    undo as never,
    prisma as never,
  ).list();
  const byName = (name: string) =>
    tools.find((tool) => tool.name === name) as Tool;

  beforeEach(() => jest.clearAllMocks());

  it('links a focused case to an agent glossary proposal', async () => {
    glossary.upsert.mockResolvedValue({ id: 'term-1' });
    const context = {
      ctx: {
        run: { id: 'run-1', agentKind: 'CASE', caseId: 'case-1' },
      },
    } as unknown as ToolContext;

    await byName('glossary.propose').handler(
      { term: 'Project Aurora', aliases: ['Aurora'] },
      context,
    );

    expect(glossary.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        term: 'Project Aurora',
        aliases: ['Aurora'],
        refType: 'case',
        refId: 'case-1',
        origin: 'AGENT',
        author: 'CASE',
      }),
    );
  });

  it('preserves an explicit inquiry reference outside a focused case', async () => {
    const context = {
      ctx: { run: { id: 'run-1', agentKind: 'INQUIRY' } },
    } as unknown as ToolContext;

    await byName('glossary.propose').handler(
      {
        term: 'Special Access Program',
        refType: 'inquiry',
        refId: 'inquiry-1',
      },
      context,
    );

    expect(glossary.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        refType: 'inquiry',
        refId: 'inquiry-1',
      }),
    );
  });

  it('rejects incomplete reference provenance', async () => {
    const context = {
      ctx: { run: { id: 'run-1', agentKind: 'CASE' } },
    } as unknown as ToolContext;

    await expect(
      byName('glossary.propose').handler(
        { term: 'Project Aurora', refType: 'case' },
        context,
      ),
    ).rejects.toThrow(/refType and refId/);
    expect(glossary.upsert).not.toHaveBeenCalled();
  });

  describe('D7 guardrails', () => {
    const settings = {
      autopilotGlossaryApproveEnabled: true,
      autopilotGlossaryApprovalsPerDay: 20,
      autopilotBindingImpactLimit: 5000,
      supervisorUndoRetentionDays: 30,
    };
    const context = (overrides: Record<string, unknown> = {}) =>
      ({
        ctx: {
          run: { id: 'run-1', agentKind: 'CONFIG' },
          settings: { ...settings, ...overrides },
        },
      }) as unknown as ToolContext;
    const draft = {
      id: 'b1',
      status: 'DRAFT',
      origin: 'AGENT',
      mode: 'OUTPUT',
      detectorType: 'CUSTOM',
      customDetectorKey: 'fm',
      findingType: 'force_majeure',
      metadataPath: null,
      values: [],
      splitDelimiter: null,
      termId: 't1',
      lookupSchemeId: null,
      lookupMatch: null,
      noMeaning: false,
      sourceIds: [],
      confidence: 1,
      rationale: 'looks right',
      term: { key: 'force-majeure', status: 'APPROVED' },
    };

    beforeEach(() => {
      prisma.glossaryBinding.findUnique.mockResolvedValue(draft);
      prisma.glossaryBinding.findMany.mockResolvedValue([]);
      prisma.agentDecision.count.mockResolvedValue(0);
      bindings.verifyPreviewToken.mockResolvedValue({ ok: true, findings: 40 });
      bindings.approve.mockResolvedValue({ id: 'b1', status: 'APPROVED' });
    });

    it('approvals are OBSERVE_ONLY when the switch is off', async () => {
      const gate = await byName('glossary.approve_binding').resolveGate!(
        {},
        context({ autopilotGlossaryApproveEnabled: false }),
      );
      expect(gate.mode).toBe(AiManagementMode.OBSERVE_ONLY);
      const proposal = await byName('glossary.propose_binding').resolveGate!(
        {},
        context({ autopilotGlossaryApproveEnabled: false }),
      );
      expect(proposal.mode).toBe(AiManagementMode.MANAGED);
    });

    it('approves within the guardrails and records an undo entry', async () => {
      await byName('glossary.approve_binding').handler(
        { bindingId: 'b1', previewToken: 't', rationale: 'r' },
        context(),
      );
      expect(bindings.approve).toHaveBeenCalledWith('b1', 'agent:CONFIG');
      expect(undo.record).toHaveBeenCalledWith(
        expect.objectContaining({
          revertKind: 'restore_value',
          revertPayload: {
            kind: 'glossary.binding',
            bindingId: 'b1',
            status: 'DRAFT',
          },
        }),
      );
    });

    it('refuses a stale token and keeps the reason on the binding', async () => {
      bindings.verifyPreviewToken.mockResolvedValue({
        ok: false,
        reason: 'previewToken expired (30 minutes): preview again',
      });
      await expect(
        byName('glossary.approve_binding').handler(
          { bindingId: 'b1', previewToken: 't', rationale: 'r' },
          context(),
        ),
      ).rejects.toThrow(/expired/);
      expect(bindings.approve).not.toHaveBeenCalled();
      expect(prisma.glossaryBinding.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            rationale: expect.stringMatching(
              /approval refused: previewToken expired/,
            ),
          },
        }),
      );
    });

    it('refuses above the impact limit', async () => {
      bindings.verifyPreviewToken.mockResolvedValue({
        ok: true,
        findings: 9000,
      });
      await expect(
        byName('glossary.approve_binding').handler(
          { bindingId: 'b1', previewToken: 't', rationale: 'r' },
          context(),
        ),
      ).rejects.toThrow(/impact limit/);
    });

    it('refuses when the daily budget is spent', async () => {
      prisma.agentDecision.count.mockResolvedValue(20);
      await expect(
        byName('glossary.approve_binding').handler(
          { bindingId: 'b1', previewToken: 't', rationale: 'r' },
          context(),
        ),
      ).rejects.toThrow(/budget/);
    });

    it('refuses a conflict with an operator binding', async () => {
      prisma.glossaryBinding.findMany.mockResolvedValue([
        {
          id: 'op',
          termId: 't2',
          lookupSchemeId: null,
          noMeaning: false,
          values: [],
        },
      ]);
      await expect(
        byName('glossary.approve_binding').handler(
          { bindingId: 'b1', previewToken: 't', rationale: 'r' },
          context(),
        ),
      ).rejects.toThrow(/operator binding/);
    });

    it('refuses a binding whose concept is still DRAFT', async () => {
      prisma.glossaryBinding.findUnique.mockResolvedValue({
        ...draft,
        term: { key: 'force-majeure', status: 'DRAFT' },
      });
      await expect(
        byName('glossary.approve_binding').handler(
          { bindingId: 'b1', previewToken: 't', rationale: 'r' },
          context(),
        ),
      ).rejects.toThrow(/not APPROVED/);
    });

    it('never disables an operator binding', async () => {
      prisma.glossaryBinding.findUnique.mockResolvedValue({
        ...draft,
        status: 'APPROVED',
        approvedBy: 'operator',
      });
      await expect(
        byName('glossary.disable_binding').handler(
          { bindingId: 'b1', rationale: 'r' },
          context(),
        ),
      ).rejects.toThrow(/operator approved/);
      expect(bindings.disable).not.toHaveBeenCalled();
    });

    it('never approves an operator relation, and needs both terms APPROVED', async () => {
      prisma.glossaryRelation.findUnique.mockResolvedValue({
        id: 'r1',
        origin: 'OPERATOR',
        status: 'DRAFT',
        type: 'BROADER',
        from: { key: 'a', status: 'APPROVED' },
        to: { key: 'b', status: 'APPROVED' },
      });
      await expect(
        byName('glossary.approve_relation').handler(
          { relationId: 'r1', rationale: 'r' },
          context(),
        ),
      ).rejects.toThrow(/operator created/);
      prisma.glossaryRelation.findUnique.mockResolvedValue({
        id: 'r1',
        origin: 'AGENT',
        status: 'DRAFT',
        type: 'BROADER',
        from: { key: 'a', status: 'DRAFT' },
        to: { key: 'b', status: 'APPROVED' },
      });
      await expect(
        byName('glossary.approve_relation').handler(
          { relationId: 'r1', rationale: 'r' },
          context(),
        ),
      ).rejects.toThrow(/both terms must be APPROVED/);
      expect(relations.approve).not.toHaveBeenCalled();
    });
  });
});
