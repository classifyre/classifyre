import { MASKED_CONFIG_ENCRYPTED_PREFIX } from '../utils/masked-config.utils';
import { assertNoSecrets, redactRow } from './redaction';
import { knownModelNames, scalarFields } from './prisma-delegate';
import {
  TRANSFER_SCOPES,
  TRANSFER_TABLES,
  tablesForScopes,
  missingDependencies,
  type TransferTableSpec,
} from './transfer-scopes';

const spec = (over: Partial<TransferTableSpec> = {}): TransferTableSpec => ({
  model: 'source',
  scope: 'sources',
  order: 1,
  keys: ['id'],
  ...over,
});

const encrypted = (value: string) =>
  `${MASKED_CONFIG_ENCRYPTED_PREFIX}${Buffer.from(value).toString('base64url')}`;

describe('redactRow', () => {
  it('removes declared credential columns and reports them', () => {
    const result = redactRow(
      spec({ model: 'aiProviderConfig', redact: ['apiKeyEnc'] }),
      {
        id: 'p1',
        name: 'Claude',
        apiKeyEnc: encrypted('sk-live-123'),
      },
    );

    expect(result.row).not.toHaveProperty('apiKeyEnc');
    expect(result.row).toEqual({ id: 'p1', name: 'Claude' });
    expect(result.stripped).toEqual(['apiKeyEnc']);
  });

  it('drops config.masked but keeps the rest of a source config', () => {
    const result = redactRow(spec({ redactMaskedConfig: true }), {
      id: 's1',
      config: {
        base_url: 'https://wiki.example.com',
        detectors: { secrets: { enabled: true } },
        masked: { access_token: encrypted('t'), password: encrypted('p') },
      },
    });

    const config = result.row['config'] as Record<string, unknown>;
    expect(config).not.toHaveProperty('masked');
    expect(config['base_url']).toBe('https://wiki.example.com');
    expect(config['detectors']).toEqual({ secrets: { enabled: true } });
    // The names survive so the import can say what has to be re-entered; the
    // values never do.
    expect(config['maskedKeys']).toEqual(['access_token', 'password']);
    expect(result.stripped).toEqual(['config.masked']);
  });

  it('leaves a config without a masked block untouched', () => {
    const result = redactRow(spec({ redactMaskedConfig: true }), {
      id: 's1',
      config: { path: '/data' },
    });

    expect(result.row['config']).toEqual({ path: '/data' });
    expect(result.stripped).toEqual([]);
  });
});

describe('assertNoSecrets', () => {
  it('accepts a redacted row', () => {
    expect(() =>
      assertNoSecrets('source', {
        id: 's1',
        name: 'Wiki',
        config: { base_url: 'https://example.com', maskedKeys: ['password'] },
      }),
    ).not.toThrow();
  });

  it('rejects an encrypted value hidden deep inside JSON', () => {
    expect(() =>
      assertNoSecrets('source', {
        id: 's1',
        config: { auth: [{ nested: encrypted('leak') }] },
      }),
    ).toThrow(/config\.auth\[0\]\.nested/);
  });

  it('rejects a credential-shaped column that no redact list covers', () => {
    // The regression this guards: a new column lands on a model and nobody
    // updates transfer-scopes.ts.
    expect(() =>
      assertNoSecrets('chatBot', { id: 'b1', botToken: 'xoxb-plaintext' }),
    ).toThrow(/botToken/);
  });

  it('ignores non-string columns whose names look credential-shaped', () => {
    expect(() =>
      assertNoSecrets('agentRun', {
        id: 'r1',
        inputTokens: 1200,
        totalTokens: 3400,
      }),
    ).not.toThrow();
  });

  it('does not reject innocent names inside schema-driven config', () => {
    // `secrets` is a detector, `api_key` is a finding label. Name matching is
    // deliberately confined to a row's own columns.
    expect(() =>
      assertNoSecrets('source', {
        id: 's1',
        config: { detectors: { secrets: { enabled: true } } },
      }),
    ).not.toThrow();
    expect(() =>
      assertNoSecrets('finding', { id: 'f1', label: 'api_key' }),
    ).not.toThrow();
  });
});

describe('transfer scope registry', () => {
  it('names only models that exist in the generated client', () => {
    const known = knownModelNames();
    const unknown = TRANSFER_TABLES.filter((t) => !known.has(t.model));
    expect(unknown.map((t) => t.model)).toEqual([]);
  });

  it('declares every table under a known scope', () => {
    const scopes = new Set(TRANSFER_SCOPES.map((s) => s.id));
    for (const table of TRANSFER_TABLES) {
      expect(scopes.has(table.scope)).toBe(true);
    }
  });

  it('gives every table a distinct model and order', () => {
    const models = TRANSFER_TABLES.map((t) => t.model);
    expect(new Set(models).size).toBe(models.length);
    const orders = TRANSFER_TABLES.map((t) => t.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('declares a compound key for exactly the composite-key tables', () => {
    for (const table of TRANSFER_TABLES) {
      expect(Boolean(table.compoundKey)).toBe(table.keys.length > 1);
    }
  });

  it('redacts every table that its scope advertises as secret-bearing', () => {
    for (const scope of TRANSFER_SCOPES) {
      if (!scope.redactsSecrets) continue;
      const tables = TRANSFER_TABLES.filter((t) => t.scope === scope.id);
      const redacting = tables.filter(
        (t) => (t.redact?.length ?? 0) > 0 || t.redactMaskedConfig,
      );
      expect(redacting.length).toBeGreaterThan(0);
    }
  });

  it('orders selected tables so referenced rows are written first', () => {
    const tables = tablesForScopes([
      'sources',
      'assets',
      'findings',
      'scanData',
    ]);
    const position = (model: string) =>
      tables.findIndex((t) => t.model === model);

    expect(position('source')).toBeLessThan(position('asset'));
    expect(position('source')).toBeLessThan(position('runner'));
    expect(position('runner')).toBeLessThan(position('runnerAsset'));
    expect(position('asset')).toBeLessThan(position('finding'));
    expect(position('finding')).toBeLessThan(
      position('customDetectorExtraction'),
    );
  });

  it('declares its own primary key among the remappable id columns', () => {
    for (const table of TRANSFER_TABLES) {
      // Singletons keep their fixed key (id = 1, or an enum), and composite
      // keys built on a natural column keep that column.
      const uuidKeys = table.keys.filter(
        (key) => key !== 'kind' && !(table.singleton && key === 'id'),
      );
      for (const key of uuidKeys) {
        if (key.endsWith('Hash')) continue;
        expect(table.idRefs ?? []).toContain(key);
      }
    }
  });

  it('names only real columns in idRefs, redact and omit', () => {
    for (const table of TRANSFER_TABLES) {
      const columns = scalarFields(table.model);
      for (const column of [
        ...(table.idRefs ?? []),
        ...(table.redact ?? []),
        ...(table.omit ?? []),
        ...Object.keys(table.optionalRefs ?? {}),
      ]) {
        expect({
          model: table.model,
          column,
          known: columns.has(column),
        }).toEqual({ model: table.model, column, known: true });
      }
    }
  });

  it('does not carry a source schedule to another instance', () => {
    const source = TRANSFER_TABLES.find((t) => t.model === 'source');
    expect(source?.omit).toEqual(
      expect.arrayContaining([
        'scheduleEnabled',
        'scheduleCron',
        'scheduleTimezone',
        'scheduleNextAt',
      ]),
    );
  });

  it('reports scopes whose dependencies were left out', () => {
    expect(missingDependencies(['findings'])).toEqual([
      { scope: 'findings', missing: ['sources', 'assets'] },
    ]);
    expect(missingDependencies(['sources', 'assets', 'findings'])).toEqual([]);
  });
});
