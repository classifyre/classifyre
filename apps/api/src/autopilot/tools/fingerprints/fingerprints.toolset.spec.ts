import { FingerprintsToolset } from './fingerprints.toolset';
import type { PrismaService } from '../../../prisma.service';
import type { CorrelationService } from '../../../correlation/correlation.service';
import type { DuplicatesFinderAgentService } from '../../../correlation/duplicates-finder-agent.service';
import type { DecisionApplierService } from '../../decision-applier.service';

describe('FingerprintsToolset', () => {
  const toolset = new FingerprintsToolset(
    {} as PrismaService,
    {} as CorrelationService,
    {} as DuplicatesFinderAgentService,
    {} as DecisionApplierService,
  );

  it('every mutating fingerprint tool declares a gate and domain', () => {
    for (const tool of toolset.list()) {
      if (tool.sideEffect === 'mutate') {
        expect('resolveGate' in tool).toBe(true);
        expect('domain' in tool).toBe(true);
      }
    }
  });

  it('config-bearing tools opt out of lenient input stripping', () => {
    const tune = toolset
      .list()
      .find((t) => t.name === 'fingerprints.tune_config');
    expect(tune?.lenientInput).toBe(false);
  });
});
