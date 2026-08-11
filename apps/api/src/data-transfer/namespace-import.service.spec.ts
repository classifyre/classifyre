import { NamespaceImportService } from './namespace-import.service';
import { tableSpec } from './transfer-scopes';

describe('NamespaceImportService legacy instance settings', () => {
  const prepare = (row: Record<string, unknown>) => {
    const service = new NamespaceImportService({} as never, {} as never);
    const spec = tableSpec('instanceSettings');
    if (!spec) throw new Error('instanceSettings transfer spec is missing');

    return (service as any).prepare(
      spec,
      row,
      new Set(['instanceConfig']),
      (value: unknown) => value,
      { warn: jest.fn(), tally: jest.fn() },
    ) as Record<string, unknown>;
  };

  it('clears assignments disabled by legacy feature flags', () => {
    const prepared = prepare({
      id: 1,
      aiEnabled: false,
      harnessEnabled: false,
      aiProviderConfigId: 'assistant-provider',
      harnessAiProviderConfigId: 'harness-provider',
    });

    expect(prepared.aiProviderConfigId).toBeNull();
    expect(prepared.harnessAiProviderConfigId).toBeNull();
    expect(prepared).not.toHaveProperty('aiEnabled');
    expect(prepared).not.toHaveProperty('harnessEnabled');
  });

  it('keeps assignments enabled by legacy flags or created after their removal', () => {
    expect(
      prepare({
        id: 1,
        aiEnabled: true,
        harnessEnabled: true,
        aiProviderConfigId: 'assistant-provider',
        harnessAiProviderConfigId: 'harness-provider',
      }),
    ).toMatchObject({
      aiProviderConfigId: 'assistant-provider',
      harnessAiProviderConfigId: 'harness-provider',
    });

    expect(
      prepare({
        id: 1,
        aiProviderConfigId: 'assistant-provider',
        harnessAiProviderConfigId: 'harness-provider',
      }),
    ).toMatchObject({
      aiProviderConfigId: 'assistant-provider',
      harnessAiProviderConfigId: 'harness-provider',
    });
  });
});
