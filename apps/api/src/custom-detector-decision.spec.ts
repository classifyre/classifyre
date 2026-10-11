import { BadRequestException } from '@nestjs/common';
import {
  isDecisionSchema,
  validateDecisionSchema,
} from './custom-detector-decision';
import {
  carriesSecrets,
  maskDetectorSecrets,
  versionedShape,
} from './custom-detector-secrets';
import { CustomDetectorsService } from './custom-detectors.service';
import { MaskedConfigCryptoService } from './masked-config-crypto.service';

function schema(overrides: Record<string, unknown> = {}) {
  return {
    type: 'DECISION',
    model: 'typesafe/jev-latest',
    secrets: { api_key: 'ts-plain-key' },
    severity: 'medium',
    questions: [
      {
        name: 'refund_request',
        type: 'yes_no',
        instructions: 'Is the customer asking for a refund?',
        threshold: 0.6,
      },
      {
        name: 'urgency',
        type: 'choice',
        instructions: 'How urgent is this?',
        options: [
          { label: 'low', description: 'can wait a week', report: false },
          {
            label: 'high',
            description: 'needs action today',
            severity: 'high',
          },
        ],
      },
      {
        name: 'frustration',
        type: 'score',
        instructions: 'How frustrated is the customer?',
        options: [
          { label: 'calm', report: false },
          { label: 'annoyed' },
          { label: 'angry', severity: 'critical' },
        ],
      },
    ],
    ...overrides,
  };
}

function question(overrides: Record<string, unknown>) {
  return {
    name: 'q',
    type: 'yes_no',
    instructions: 'Is it?',
    ...overrides,
  };
}

describe('decision detector schema rules', () => {
  it('accepts a complete schema', () => {
    expect(() => validateDecisionSchema(schema())).not.toThrow();
    expect(() =>
      validateDecisionSchema(
        schema({
          model: 'strands_decider/local-decider',
          api_base: 'http://decider.internal:8080',
          extra_headers: { 'x-team': 'risk' },
          secrets: undefined,
          content_limit: 20000,
          scope: { asset_kinds: ['record'] },
          budget: { max_attempts: 2 },
        }),
      ),
    ).not.toThrow();
  });

  it('recognises the type whatever its case', () => {
    expect(isDecisionSchema({ type: 'decision' })).toBe(true);
    expect(isDecisionSchema({ type: 'LLM' })).toBe(false);
    expect(isDecisionSchema(null)).toBe(false);
  });

  it.each([
    ['jev-latest', /<provider>\/<model>/],
    ['typesafe/', /<provider>\/<model>/],
    ['/jev-latest', /<provider>\/<model>/],
    ['typesafe/jev latest', /<provider>\/<model>/],
    ['', /model is required/],
    [undefined, /model is required/],
  ])('refuses the model %p', (model, message) => {
    expect(() => validateDecisionSchema(schema({ model }))).toThrow(message);
  });

  it('takes any provider prefix: the provider list is LiteLLM’s, not ours', () => {
    for (const model of [
      'openai/gpt-6-luna',
      'cloudflare/@cf/cloudflare/clef-flash',
      'openrouter/typesafe/jev-1.13',
      'databricks/databricks-openjev-qwen35-4b',
      'some_future_provider/model-x',
    ]) {
      expect(() => validateDecisionSchema(schema({ model }))).not.toThrow();
    }
  });

  it('says where a misplaced credential belongs', () => {
    expect(() => validateDecisionSchema(schema({ api_key: 'k' }))).toThrow(
      /api_key belongs in secrets/,
    );
    expect(() =>
      validateDecisionSchema(schema({ provider_runtime: {} })),
    ).toThrow(/provider_runtime is for LLM detectors/);
    expect(() =>
      validateDecisionSchema(schema({ secrets: { token: 'k' } })),
    ).toThrow(/only secret a decision detector reads is api_key/);
    expect(() =>
      validateDecisionSchema(
        schema({ extra_headers: { Authorization: 'Bearer k' } }),
      ),
    ).toThrow(/API key goes in secrets\.api_key/);
  });

  it('fails closed on unknown fields', () => {
    expect(() => validateDecisionSchema(schema({ temperature: 0 }))).toThrow(
      /unknown field\(s\): temperature/,
    );
    expect(() =>
      validateDecisionSchema(
        schema({ questions: [question({ prompt: 'x' })] }),
      ),
    ).toThrow(/unknown field\(s\): prompt/);
    expect(() =>
      validateDecisionSchema(
        schema({
          questions: [
            question({
              type: 'choice',
              options: [{ label: 'a', value: 'a' }, { label: 'b' }],
            }),
          ],
        }),
      ),
    ).toThrow(/unknown field\(s\): value/);
  });

  it('refuses a malformed endpoint or header', () => {
    expect(() =>
      validateDecisionSchema(schema({ api_base: 'decider.internal' })),
    ).toThrow(/api_base must be an http\(s\) URL/);
    expect(() =>
      validateDecisionSchema(schema({ api_base: 'ftp://decider' })),
    ).toThrow(/api_base/);
    expect(() =>
      validateDecisionSchema(schema({ extra_headers: { 'bad name': 'x' } })),
    ).toThrow(/not a valid HTTP header name/);
    expect(() =>
      validateDecisionSchema(schema({ extra_headers: { 'x-n': 1 } })),
    ).toThrow(/must be a string/);
  });

  it('requires 1 to 64 well-formed, uniquely named questions', () => {
    expect(() => validateDecisionSchema(schema({ questions: [] }))).toThrow(
      /1 to 64/,
    );
    expect(() =>
      validateDecisionSchema(schema({ questions: undefined })),
    ).toThrow(/1 to 64/);
    expect(() =>
      validateDecisionSchema(
        schema({
          questions: Array.from({ length: 65 }, (_, i) =>
            question({ name: `q${i}` }),
          ),
        }),
      ),
    ).toThrow(/1 to 64/);
    expect(() =>
      validateDecisionSchema(
        schema({ questions: [question({}), question({})] }),
      ),
    ).toThrow(/duplicate question name 'q'/);
    expect(() =>
      validateDecisionSchema(
        schema({ questions: [question({ name: 'has space' })] }),
      ),
    ).toThrow(/becomes the finding type/);
    expect(() =>
      validateDecisionSchema(
        schema({ questions: [question({ type: 'noul' })] }),
      ),
    ).toThrow(/yes_no, choice, score/);
    expect(() =>
      validateDecisionSchema(
        schema({ questions: [question({ instructions: '   ' })] }),
      ),
    ).toThrow(/needs instructions/);
  });

  it('holds each question type to the option counts every provider accepts', () => {
    const withOptions = (type: string, count: number) =>
      schema({
        questions: [
          question({
            type,
            options: Array.from({ length: count }, (_, i) => ({
              label: `o${i}`,
            })),
          }),
        ],
      });

    expect(() => validateDecisionSchema(withOptions('choice', 1))).toThrow(
      /choice question 'q' needs 2 to 255 options/,
    );
    expect(() =>
      validateDecisionSchema(withOptions('choice', 2)),
    ).not.toThrow();
    expect(() => validateDecisionSchema(withOptions('score', 1))).toThrow(
      /score question 'q' needs 2 to 10 options, ordered lowest first/,
    );
    expect(() =>
      validateDecisionSchema(withOptions('score', 10)),
    ).not.toThrow();
    expect(() => validateDecisionSchema(withOptions('score', 11))).toThrow(
      /2 to 10/,
    );
    expect(() => validateDecisionSchema(withOptions('yes_no', 2))).toThrow(
      /yes_no and takes no options/,
    );
    expect(() =>
      validateDecisionSchema(
        schema({
          questions: [
            question({
              type: 'choice',
              options: [{ label: 'same' }, { label: 'same' }],
            }),
          ],
        }),
      ),
    ).toThrow(/repeats the option 'same'/);
  });

  it('checks thresholds and severities where they are set', () => {
    expect(() =>
      validateDecisionSchema(
        schema({ questions: [question({ threshold: 1.2 })] }),
      ),
    ).toThrow(/threshold must be a number from 0 to 1/);
    expect(() =>
      validateDecisionSchema(
        schema({ questions: [question({ threshold: null })] }),
      ),
    ).toThrow(/leave it out for the default/);
    expect(() =>
      validateDecisionSchema(
        schema({ questions: [question({ severity: 'urgent' })] }),
      ),
    ).toThrow(/question 'q' severity must be one of/);
    expect(() =>
      validateDecisionSchema(schema({ severity: 'urgent' })),
    ).toThrow(/severity must be one of/);
    expect(() => validateDecisionSchema(schema({ content_limit: 0 }))).toThrow(
      /content_limit/,
    );
  });

  it('reports every failure as a 400 that names the engine', () => {
    try {
      validateDecisionSchema(schema({ model: 'nope' }));
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toMatch(/^DECISION: /);
    }
  });

  it('shares the secrets bag rules with code detectors', () => {
    expect(carriesSecrets(schema())).toBe(true);
    expect(carriesSecrets({ type: 'LLM', system_prompt: 'x' })).toBe(false);

    const { schema: masked, secretKeys } = maskDetectorSecrets(schema());
    expect(masked).not.toHaveProperty('secrets');
    expect(secretKeys).toEqual(['api_key']);

    expect(versionedShape(schema({ secrets: { api_key: 'a' } }))).toEqual(
      versionedShape(schema({ secrets: { api_key: 'b' } })),
    );
  });
});

describe('CustomDetectorsService with decision detectors', () => {
  function createService(stored?: Record<string, unknown>) {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      customDetector: {
        findUnique: jest.fn().mockResolvedValue(
          stored
            ? {
                id: 'd1',
                key: 'ticket_triage',
                name: 'Ticket triage',
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
      customDetectorFile: { findMany: jest.fn() },
    };
    const crypto = new MaskedConfigCryptoService();
    const service = new CustomDetectorsService(
      prisma as any,
      { get: jest.fn() } as any,
      crypto,
    );
    return { service, prisma, crypto };
  }

  it('is a pipeline type the service accepts and validates', () => {
    const { service } = createService();
    expect(() => service.validatePipelineSchema(schema())).not.toThrow();
    expect(() =>
      service.validatePipelineSchema(schema({ model: 'jev-latest' })),
    ).toThrow(/<provider>\/<model>/);
  });

  it('encrypts the API key on create and never returns it', async () => {
    const { service, prisma, crypto } = createService();
    const response = await service.create({
      name: 'Ticket triage',
      pipelineSchema: schema({ secrets: { api_key: 'ts-live-key' } }),
    });

    const data = prisma.customDetector.create.mock.calls[0][0].data;
    const stored = data.pipelineSchema as Record<string, any>;
    expect(crypto.isEncryptedValue(stored.secrets.api_key)).toBe(true);
    expect(crypto.decryptString(stored.secrets.api_key)).toBe('ts-live-key');
    expect(JSON.stringify(response)).not.toContain('ts-live-key');
    expect(response.pipelineSchema).not.toHaveProperty('secrets');
    expect(response.secretKeys).toEqual(['api_key']);
    expect(response.detectorType).toBe('DECISION');
    expect(response.severity).toBe('medium');
    // The answer is the finding type: `urgency:high`.
    expect(response.answerDimension).toBe('findingType');
    // It holds its own key; it does not point at an AI provider.
    expect(data.aiProviderConfigId).toBeNull();
  });

  it('keeps the stored key when an update omits it, without a version bump', async () => {
    const crypto = new MaskedConfigCryptoService();
    const stored = schema({
      secrets: { api_key: crypto.encryptString('old') },
    });
    const { service, prisma } = createService(stored);

    const { secrets: _omit, ...withoutSecrets } = schema();
    await service.update('d1', { pipelineSchema: withoutSecrets });

    const data = prisma.customDetector.update.mock.calls[0][0].data;
    expect(data.pipelineSchema.secrets.api_key).toBe(
      (stored.secrets as Record<string, string>).api_key,
    );
    expect(data.version).toBe(3);
  });

  it('rotates the key without a version bump, and removes it on null', async () => {
    const crypto = new MaskedConfigCryptoService();
    const stored = schema({
      secrets: { api_key: crypto.encryptString('old') },
    });
    const { service, prisma } = createService(stored);

    await service.update('d1', {
      pipelineSchema: schema({ secrets: { api_key: 'new' } }),
    });
    const rotated = prisma.customDetector.update.mock.calls[0][0].data;
    expect(crypto.decryptString(rotated.pipelineSchema.secrets.api_key)).toBe(
      'new',
    );
    expect(rotated.version).toBe(3);

    await service.update('d1', {
      pipelineSchema: schema({ secrets: { api_key: null } }),
    });
    const removed = prisma.customDetector.update.mock.calls[1][0].data;
    expect(removed.pipelineSchema).not.toHaveProperty('secrets');
  });

  it('drops the stored key when the detector is pointed somewhere else', async () => {
    // The key is write-only. Repointing the detector at another server must
    // not be a way to have the next scan deliver it there.
    const crypto = new MaskedConfigCryptoService();
    const stored = schema({
      secrets: { api_key: crypto.encryptString('old') },
    });
    const { secrets: _omit, ...base } = schema();

    for (const change of [
      { api_base: 'https://collector.example.test' },
      { model: 'strands_decider/anything', api_base: 'http://10.0.0.9:8080' },
      { model: 'openai/gpt-6-luna' },
    ]) {
      const { service, prisma } = createService(stored);
      const response = await service.update('d1', {
        pipelineSchema: { ...base, ...change },
      });
      const data = prisma.customDetector.update.mock.calls[0][0].data;
      expect(data.pipelineSchema).not.toHaveProperty('secrets');
      expect(response.secretKeys).toEqual([]);
    }
  });

  it('keeps the stored key across changes that leave the endpoint alone', async () => {
    const crypto = new MaskedConfigCryptoService();
    const encrypted = crypto.encryptString('old');
    const { secrets: _omit, ...base } = schema();

    // Another model of the same provider, and a trailing slash on the URL.
    const withBase = { ...base, api_base: 'https://gateway.example.test' };
    for (const [stored, next] of [
      [base, { ...base, model: 'typesafe/jev-1.13.0' }],
      [withBase, { ...withBase, api_base: 'https://gateway.example.test/' }],
    ]) {
      const { service, prisma } = createService({
        ...stored,
        secrets: { api_key: encrypted },
      });
      await service.update('d1', { pipelineSchema: next });
      expect(
        prisma.customDetector.update.mock.calls[0][0].data.pipelineSchema
          .secrets.api_key,
      ).toBe(encrypted);
    }
  });

  it('takes a new key together with a new endpoint', async () => {
    const crypto = new MaskedConfigCryptoService();
    const { service, prisma } = createService(
      schema({ secrets: { api_key: crypto.encryptString('old') } }),
    );
    await service.update('d1', {
      pipelineSchema: schema({
        model: 'openai/gpt-6-luna',
        secrets: { api_key: 'the-openai-key' },
      }),
    });
    const data = prisma.customDetector.update.mock.calls[0][0].data;
    expect(crypto.decryptString(data.pipelineSchema.secrets.api_key)).toBe(
      'the-openai-key',
    );
  });

  it('bumps the version when a question or the model changes', async () => {
    const { service, prisma } = createService(schema());
    await service.update('d1', {
      pipelineSchema: schema({ model: 'cloudflare/clef' }),
    });
    expect(prisma.customDetector.update.mock.calls[0][0].data.version).toBe(4);
  });

  it('does not inherit a code detector’s secrets when the engine changes', async () => {
    const crypto = new MaskedConfigCryptoService();
    const { service, prisma } = createService({
      type: 'CODE_DETECTOR',
      notebook: { revision: 1, cells: [] },
      secrets: { api_key: crypto.encryptString('a-notebook-credential') },
    });

    const { secrets: _omit, ...withoutSecrets } = schema();
    await service.update('d1', { pipelineSchema: withoutSecrets });

    expect(
      prisma.customDetector.update.mock.calls[0][0].data.pipelineSchema,
    ).not.toHaveProperty('secrets');
  });

  it('decrypts the key at dispatch and adds nothing a code detector needs', async () => {
    const crypto = new MaskedConfigCryptoService();
    const { service, prisma } = createService();
    const runtime = await service.prepareRuntimePipelineSchema({
      id: 'd1',
      pipelineSchema: schema({
        secrets: { api_key: crypto.encryptString('ts-live-key') },
      }),
    });

    expect(runtime.secrets).toEqual({ api_key: 'ts-live-key' });
    expect(runtime.model).toBe('typesafe/jev-latest');
    expect(runtime).not.toHaveProperty('files_runtime');
    expect(runtime).not.toHaveProperty('custom_detector_id');
    expect(runtime).not.toHaveProperty('provider_runtime');
    expect(prisma.customDetectorFile.findMany).not.toHaveBeenCalled();
  });

  it('dispatches a keyless detector with an empty secrets bag', async () => {
    const { service } = createService();
    const runtime = await service.prepareRuntimePipelineSchema({
      id: 'd1',
      pipelineSchema: schema({
        model: 'strands_decider/local-decider',
        api_base: 'http://decider.internal:8080',
        secrets: undefined,
      }),
    });
    expect(runtime.secrets).toEqual({});
  });
});
