import { MaskedConfigCryptoService } from './masked-config-crypto.service';
import { SourceService } from './source.service';
import { MASKED_CONFIG_ENCRYPTED_PREFIX } from './utils/masked-config.utils';
import { normalizeSourceConfig } from './utils/source-config-normalizer';

jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mocked-uuid'),
}));

describe('SourceService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'test';
    process.env.CLASSIFYRE_MASKED_CONFIG_KEY = Buffer.alloc(32, 11).toString(
      'base64',
    );
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function createService(prismaOverrides?: Partial<any>) {
    const prisma = {
      source: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      runner: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      ...prismaOverrides,
    };
    const runnerLogStorage = {
      deleteRunnerLogs: jest.fn(),
    };
    const maskedConfigCryptoService = new MaskedConfigCryptoService();
    const pgBoss = {
      getBossAsync: jest.fn().mockResolvedValue({
        send: jest.fn().mockResolvedValue('job-id'),
      }),
    };
    const service = new SourceService(
      prisma as any,
      maskedConfigCryptoService,
      runnerLogStorage as any,
      pgBoss as any,
    );
    return {
      service,
      prisma,
      maskedConfigCryptoService,
      runnerLogStorage,
      pgBoss,
    };
  }

  it('persists the AUTOMATIC sampling cursor on the source', async () => {
    const { service, prisma } = createService();
    prisma.source.update.mockImplementation(({ data }: any) => ({
      id: 'source-1',
      ...data,
    }));

    const cursor = { tables: { 'db_#_users': { pk: [7] } } };
    await service.updateSamplingCursor('source-1', cursor);

    expect(prisma.source.update).toHaveBeenCalledWith({
      where: { id: 'source-1' },
      data: { samplingCursor: cursor },
    });
  });

  it('encrypts masked config when creating a source', async () => {
    const { service, prisma } = createService();
    prisma.source.create.mockImplementation(({ data }: any) => ({
      id: 'source-1',
      ...data,
    }));

    const created = await service.createFromConfig({
      type: 'SLACK',
      name: 'Slack Source',
      config: {
        type: 'SLACK',
        required: { workspace: 'acme' },
        masked: { bot_token: 'xoxb-plain-token' },
      },
    });

    expect(created.id).toBe('source-1');
    expect(prisma.source.create).toHaveBeenCalledTimes(1);
    const savedConfig = prisma.source.create.mock.calls[0][0].data.config;
    const savedToken = savedConfig.masked.bot_token as string;
    expect(savedToken.startsWith(MASKED_CONFIG_ENCRYPTED_PREFIX)).toBe(true);
    expect(savedToken).not.toBe('xoxb-plain-token');
  });

  it('returns existing source when decrypted config already exists', async () => {
    const { service, prisma, maskedConfigCryptoService } = createService();
    const plainConfig = {
      type: 'WORDPRESS',
      required: { url: 'https://blog.example.com' },
      masked: { username: 'admin', application_password: 'plain-password' },
    };
    const normalizedPlainConfig = normalizeSourceConfig(
      'WORDPRESS',
      plainConfig,
    ) as Record<string, unknown>;
    const existing = {
      id: 'existing-source',
      name: 'Existing',
      type: 'WORDPRESS',
      config: maskedConfigCryptoService.encryptMaskedConfig(
        normalizedPlainConfig,
      ),
      currentRunnerId: null,
      runnerStatus: 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    prisma.source.findMany.mockResolvedValue([existing]);

    const result = await service.createFromConfig({
      type: 'WORDPRESS',
      name: 'New Name',
      config: plainConfig,
    });

    expect(result).toBe(existing);
    expect(prisma.source.create).not.toHaveBeenCalled();
  });

  it('skips corrupted encrypted candidates during de-duplication', async () => {
    const { service, prisma, maskedConfigCryptoService } = createService();
    const plainConfig = {
      type: 'WORDPRESS',
      required: { url: 'https://blog.example.com' },
      masked: { username: 'admin', application_password: 'plain-password' },
    };

    prisma.source.findMany.mockResolvedValue([
      {
        id: 'broken-source',
        type: 'WORDPRESS',
        config: {
          masked: {
            application_password: `${MASKED_CONFIG_ENCRYPTED_PREFIX}broken-payload`,
          },
        },
      },
      {
        id: 'non-match',
        type: 'WORDPRESS',
        config: maskedConfigCryptoService.encryptMaskedConfig({
          ...plainConfig,
          required: {
            url: 'https://other.example.com',
          },
        }),
      },
    ]);
    prisma.source.create.mockImplementation(({ data }: any) => ({
      id: 'source-new',
      ...data,
    }));

    const result = await service.createFromConfig({
      type: 'WORDPRESS',
      config: plainConfig,
    });

    expect(result.id).toBe('source-new');
    expect(prisma.source.create).toHaveBeenCalledTimes(1);
  });

  it('preserves encrypted values and encrypts updated plaintext on update', async () => {
    const { service, prisma, maskedConfigCryptoService } = createService();
    const alreadyEncrypted = maskedConfigCryptoService.encryptMaskedConfig({
      type: 'SLACK',
      required: { workspace: 'acme' },
      masked: { bot_token: 'old-token' },
    });
    const encryptedToken = (alreadyEncrypted.masked as Record<string, unknown>)
      .bot_token as string;

    prisma.source.update.mockImplementation(({ data }: any) => ({
      id: 'source-1',
      ...data,
    }));

    await service.updateFromConfig('source-1', {
      config: {
        type: 'SLACK',
        required: { workspace: 'acme' },
        masked: {
          bot_token: encryptedToken,
          user_token: 'new-plain-token',
        },
      },
    });

    const updatePayload = prisma.source.update.mock.calls[0][0].data.config;
    expect(updatePayload.masked.bot_token).toBe(encryptedToken);
    expect(
      String(updatePayload.masked.user_token).startsWith(
        MASKED_CONFIG_ENCRYPTED_PREFIX,
      ),
    ).toBe(true);
  });

  it('deletes runner log directories when source is deleted', async () => {
    const { service, prisma, runnerLogStorage } = createService();
    prisma.source.findUnique.mockResolvedValue({ id: 'source-1' });
    prisma.runner.findMany.mockResolvedValue([
      { id: 'runner-1' },
      { id: 'runner-2' },
    ]);
    prisma.source.delete.mockResolvedValue({
      id: 'source-1',
      name: 'Deleted source',
      type: 'WORDPRESS',
      config: {},
      currentRunnerId: null,
      runnerStatus: 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.deleteSource({ id: 'source-1' });

    expect(prisma.runner.findMany).toHaveBeenCalledWith({
      where: { sourceId: 'source-1' },
      select: { id: true },
    });
    expect(runnerLogStorage.deleteRunnerLogs).toHaveBeenCalledWith(
      'source-1',
      'runner-1',
    );
    expect(runnerLogStorage.deleteRunnerLogs).toHaveBeenCalledWith(
      'source-1',
      'runner-2',
    );
  });

  it('does not delete source when runner log cleanup fails', async () => {
    const { service, prisma, runnerLogStorage } = createService();
    prisma.source.findUnique.mockResolvedValue({ id: 'source-1' });
    prisma.runner.findMany.mockResolvedValue([{ id: 'runner-1' }]);
    runnerLogStorage.deleteRunnerLogs.mockRejectedValue(
      new Error('disk error'),
    );

    await expect(service.deleteSource({ id: 'source-1' })).rejects.toThrow(
      'disk error',
    );

    expect(prisma.source.delete).not.toHaveBeenCalled();
  });

  describe('purgeFindings', () => {
    it('deletes every finding of the source and schedules a correlation recompute', async () => {
      const deleteMany = jest.fn().mockResolvedValue({ count: 42 });
      const { service, pgBoss } = createService({
        source: { findUnique: jest.fn().mockResolvedValue({ id: 'src-1' }) },
        finding: { deleteMany },
      });

      const result = await service.purgeFindings('src-1');

      expect(result).toEqual({ purgedFindings: 42 });
      expect(deleteMany).toHaveBeenCalledWith({
        where: { sourceId: 'src-1' },
      });
      const boss = await pgBoss.getBossAsync.mock.results[0].value;
      expect(boss.send).toHaveBeenCalledWith(
        'correlation.scan',
        { recomputeAll: true },
        expect.objectContaining({ singletonKey: 'correlation:recompute-all' }),
      );
    });

    it('404s for an unknown source without deleting anything', async () => {
      const deleteMany = jest.fn();
      const { service } = createService({
        source: { findUnique: jest.fn().mockResolvedValue(null) },
        finding: { deleteMany },
      });

      await expect(service.purgeFindings('missing')).rejects.toThrow(
        'Source with ID missing not found',
      );
      expect(deleteMany).not.toHaveBeenCalled();
    });

    it('still purges when scheduling the recompute fails', async () => {
      const deleteMany = jest.fn().mockResolvedValue({ count: 3 });
      const { service, pgBoss } = createService({
        source: { findUnique: jest.fn().mockResolvedValue({ id: 'src-1' }) },
        finding: { deleteMany },
      });
      pgBoss.getBossAsync.mockRejectedValue(new Error('boss down'));

      await expect(service.purgeFindings('src-1')).resolves.toEqual({
        purgedFindings: 3,
      });
    });
  });
});
