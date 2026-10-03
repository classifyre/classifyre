import { BadRequestException } from '@nestjs/common';
import {
  definesDetect,
  maskCodeDetectorSchema,
  mergeCodeDetectorSecrets,
  validateCodeDetectorSchema,
  versionedShape,
} from './custom-detector-code';
import { CustomDetectorsService } from './custom-detectors.service';
import { MaskedConfigCryptoService } from './masked-config-crypto.service';

const DETECT =
  'def detect(asset, ctx):\n    yield Finding(label="x", value="y")\n';

function schema(overrides: Record<string, unknown> = {}) {
  return {
    type: 'CODE_DETECTOR',
    notebook: {
      revision: 1,
      cells: [
        { id: 'md', type: 'markdown', source: '# Rule' },
        { id: 'c1', type: 'code', source: DETECT },
      ],
    },
    severity: 'high',
    category: 'QUALITY',
    fields: [{ name: 'expected', type: 'number' }],
    variables: { limit: '5' },
    secrets: { api_token: 'plain' },
    limits: { per_asset_timeout_seconds: 10 },
    ...overrides,
  };
}

describe('code detector schema rules', () => {
  it('accepts a complete schema', () => {
    expect(() => validateCodeDetectorSchema(schema())).not.toThrow();
  });

  it.each([
    [{ notebook: { cells: [] } }, /non-empty/],
    [
      {
        notebook: {
          cells: [{ id: 'c1', type: 'code', source: 'def setup(ctx): pass' }],
        },
      },
      /detect\(asset, ctx\)/,
    ],
    [{ files_runtime: [] }, /injected by the server/],
    [{ custom_detector_id: 'x' }, /injected by the server/],
    [{ surprise: true }, /unknown field/],
    [{ variables: { 'bad-key': 'x' } }, /Python identifier/],
    [{ fields: [{ name: 'a', type: 'money' }] }, /type must be one of/],
    [{ limits: { max_workers: 99 } }, /max_workers/],
    [{ limits: { nope: 1 } }, /unknown key/],
    [{ severity: 'urgent' }, /severity/],
    [{ deterministic: 'yes' }, /boolean/],
  ])('refuses %j', (overrides, message) => {
    expect(() => validateCodeDetectorSchema(schema(overrides))).toThrow(
      message,
    );
  });

  it('only counts a top-level def detect(asset[, ctx]) in a code cell', () => {
    expect(definesDetect(schema())).toBe(true);
    expect(
      definesDetect(
        schema({
          notebook: {
            cells: [
              { id: 'a', type: 'markdown', source: 'def detect(asset):' },
              { id: 'b', type: 'code', source: '    def detect(asset): pass' },
            ],
          },
        }),
      ),
    ).toBe(false);
    expect(
      definesDetect(
        schema({
          notebook: {
            cells: [
              { id: 'a', type: 'code', source: 'def detect(): pass' },
              {
                id: 'b',
                type: 'code',
                source: 'def detect(a, b, c): pass',
              },
            ],
          },
        }),
      ),
    ).toBe(false);
    expect(
      definesDetect(
        schema({
          notebook: {
            cells: [
              { id: 'a', type: 'code', source: 'def detect(asset): pass' },
            ],
          },
        }),
      ),
    ).toBe(true);
  });

  it('accepts the files key and normalizes severity/category case', () => {
    expect(() =>
      validateCodeDetectorSchema(schema({ files: ['file-id-1'] })),
    ).not.toThrow();
    expect(() => validateCodeDetectorSchema(schema({ files: [42] }))).toThrow(
      /files/,
    );
    expect(() =>
      validateCodeDetectorSchema(
        schema({ severity: 'High', category: 'quality' }),
      ),
    ).not.toThrow();
  });

  it('masks secret values but keeps their names', () => {
    const { schema: masked, secretKeys } = maskCodeDetectorSchema(
      schema({ secrets: { b: 'x', a: 'y' } }),
    );
    expect(masked).not.toHaveProperty('secrets');
    expect(secretKeys).toEqual(['a', 'b']);
  });

  it('applies a secrets patch: set, delete, keep', () => {
    const merged = mergeCodeDetectorSecrets(
      { keep: 'enc-keep', drop: 'enc-drop', rotate: 'enc-old' },
      { drop: null, rotate: 'new', added: 'fresh' },
      (value) => `enc(${value})`,
    );
    expect(merged).toEqual({
      keep: 'enc-keep',
      rotate: 'enc(new)',
      added: 'enc(fresh)',
    });
  });

  it('leaves secrets out of the versioned shape', () => {
    expect(versionedShape(schema({ secrets: { a: '1' } }))).toEqual(
      versionedShape(schema({ secrets: { a: '2' } })),
    );
  });
});

describe('CustomDetectorsService with code detectors', () => {
  function createService(stored?: Record<string, unknown>) {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      customDetector: {
        findUnique: jest.fn().mockResolvedValue(
          stored
            ? {
                id: 'd1',
                key: 'rule',
                name: 'Rule',
                version: 3,
                isActive: true,
                pipelineSchema: stored,
              }
            : null,
        ),
        create: jest.fn(({ data }) => ({
          id: 'd1',
          version: 1,
          trainingRuns: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        })),
        update: jest.fn(({ data }) => ({
          id: 'd1',
          trainingRuns: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        })),
      },
      customDetectorFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'f1',
            fileName: 'list.csv',
            contentHash: 'abc',
            fileSizeBytes: 12,
          },
        ]),
      },
    };
    const crypto = new MaskedConfigCryptoService();
    const service = new CustomDetectorsService(
      prisma as any,
      { get: jest.fn() } as any,
      crypto,
    );
    return { service, prisma, crypto };
  }

  it('encrypts secrets on create and never returns them', async () => {
    const { service, prisma, crypto } = createService();
    const response = await service.create({
      name: 'Rule',
      pipelineSchema: schema({ secrets: { api_token: 's3cr3t' } }),
    });

    const stored = prisma.customDetector.create.mock.calls[0][0].data
      .pipelineSchema as Record<string, any>;
    expect(crypto.isEncryptedValue(stored.secrets.api_token)).toBe(true);
    expect(JSON.stringify(response)).not.toContain('s3cr3t');
    expect(response.pipelineSchema).not.toHaveProperty('secrets');
    expect(response.secretKeys).toEqual(['api_token']);
  });

  it('keeps stored secrets when an update omits them, without a version bump', async () => {
    const crypto = new MaskedConfigCryptoService();
    const stored = schema({
      secrets: { api_token: crypto.encryptString('old') },
    });
    const { service, prisma } = createService(stored);

    const { secrets: _omit, ...withoutSecrets } = schema();
    await service.update('d1', { pipelineSchema: withoutSecrets });

    const data = prisma.customDetector.update.mock.calls[0][0].data;
    expect(data.pipelineSchema.secrets.api_token).toBe(
      (stored.secrets as Record<string, string>).api_token,
    );
    expect(data.version).toBe(3);
  });

  it('owns the notebook revision: +1 when cells change, kept otherwise', async () => {
    const stored = schema();
    (stored.notebook as Record<string, unknown>).revision = 7;
    const { service, prisma } = createService(stored);
    await service.update('d1', {
      pipelineSchema: schema({
        notebook: { revision: 99, cells: stored.notebook.cells },
      }),
    });
    expect(
      prisma.customDetector.update.mock.calls[0][0].data.pipelineSchema.notebook
        .revision,
    ).toBe(7);
    await service.update('d1', {
      pipelineSchema: schema({
        notebook: {
          revision: 1,
          cells: [{ id: 'c1', type: 'code', source: `${DETECT}# v2\n` }],
        },
      }),
    });
    expect(
      prisma.customDetector.update.mock.calls[1][0].data.pipelineSchema.notebook
        .revision,
    ).toBe(8);
  });

  it('bumps the version when the code changes', async () => {
    const { service, prisma } = createService(schema());
    await service.update('d1', {
      pipelineSchema: schema({
        notebook: {
          cells: [{ id: 'c1', type: 'code', source: `${DETECT}# edited\n` }],
        },
      }),
    });
    expect(prisma.customDetector.update.mock.calls[0][0].data.version).toBe(4);
  });

  it('decrypts secrets and adds the file manifest at dispatch', async () => {
    const crypto = new MaskedConfigCryptoService();
    const { service } = createService();
    const runtime = await service.prepareRuntimePipelineSchema(
      {
        id: 'd1',
        pipelineSchema: schema({
          secrets: { api_token: crypto.encryptString('s3cr3t') },
        }),
      },
      { filesBaseUrl: 'http://api/ns-1/' },
    );
    expect(runtime.secrets).toEqual({ api_token: 's3cr3t' });
    expect(runtime.custom_detector_id).toBe('d1');
    expect(runtime.files_runtime).toEqual([
      {
        id: 'f1',
        name: 'list.csv',
        content_hash: 'abc',
        size_bytes: 12,
        url: 'http://api/ns-1/custom-detectors/d1/files/f1/content',
      },
    ]);
  });

  it('refuses a client-supplied runtime field', () => {
    const { service } = createService();
    expect(() =>
      service.validatePipelineSchema(schema({ files_runtime: [] })),
    ).toThrow(BadRequestException);
  });
});
