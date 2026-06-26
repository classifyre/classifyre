import { InvestigationToolset } from './investigation.toolset';
import type { DecisionApplierService } from '../../decision-applier.service';

describe('InvestigationToolset', () => {
  const applier = {} as DecisionApplierService;
  const toolset = new InvestigationToolset(applier);

  it('every mutating tool declares a resolveGate (fail-closed lint)', () => {
    const tools = toolset.list();
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      if (tool.sideEffect === 'mutate') {
        expect('resolveGate' in tool).toBe(true);
        expect('domain' in tool).toBe(true);
      }
    }
  });

  it('exposes uniquely-named, namespaced tools', () => {
    const names = toolset.list().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });

  describe('close / reopen / archive / reactivate wiring', () => {
    const stub = {
      closeCaseCore: jest.fn(),
      reopenCaseCore: jest.fn(),
      setInquiryStatusCore: jest.fn(),
    };
    const tools = new InvestigationToolset(
      stub as unknown as DecisionApplierService,
    ).list();
    const byName = (name: string) => tools.find((t) => t.name === name)!;
    const tc = {} as never;

    it('cases.close forwards the conclusion to closeCaseCore', async () => {
      await byName('cases.close').handler(
        { caseId: 'c1', conclusion: 'No longer holds.' },
        tc,
      );
      expect(stub.closeCaseCore).toHaveBeenCalledWith('c1', 'No longer holds.');
    });

    it('cases.reopen forwards the note to reopenCaseCore', async () => {
      await byName('cases.reopen').handler(
        { caseId: 'c1', note: 'Recurred.' },
        tc,
      );
      expect(stub.reopenCaseCore).toHaveBeenCalledWith('c1', 'Recurred.');
    });

    it('inquiries.archive sets ARCHIVED status', async () => {
      await byName('inquiries.archive').handler(
        { inquiryId: 'q1', reason: 'Noise.' },
        tc,
      );
      expect(stub.setInquiryStatusCore).toHaveBeenCalledWith('q1', 'ARCHIVED');
    });

    it('inquiries.reactivate sets ACTIVE status', async () => {
      await byName('inquiries.reactivate').handler(
        { inquiryId: 'q1', reason: 'Recurred.' },
        tc,
      );
      expect(stub.setInquiryStatusCore).toHaveBeenCalledWith('q1', 'ACTIVE');
    });
  });
});
