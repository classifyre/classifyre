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
        expect(tool.resolveGate).toBeDefined();
        expect(tool.domain).toBeTruthy();
      }
    }
  });

  it('exposes uniquely-named, namespaced tools', () => {
    const names = toolset.list().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });
});
