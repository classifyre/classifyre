import { CliRunnerService } from './cli-runner.service';
import { MaskedConfigCryptoService } from '../masked-config-crypto.service';
import * as fs from 'fs/promises';
import { RunnerExecutionMode, RunnerStatus } from '@prisma/client';

jest.mock('@kubernetes/client-node', () => ({
  KubeConfig: class {
    loadFromFile() {}
    loadFromCluster() {}
    makeApiClient() {
      return {};
    }
  },
  BatchV1Api: class {},
  CoreV1Api: class {},
}));

describe('CliRunnerService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'test';
    process.env.CLASSIFYRE_MASKED_CONFIG_KEY = Buffer.alloc(32, 19).toString(
      'base64',
    );
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function createService(options?: {
    prismaSource?: any;
    kubernetesCliJobService?: any;
  }) {
    const prisma = {
      source: {
        findUnique: jest.fn().mockResolvedValue(options?.prismaSource ?? null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      customDetectorFeedback: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      runner: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn(),
      },
      asset: {
        count: jest.fn(),
      },
      finding: {
        count: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((callback: any) => callback(prisma));
    const notificationsService = {
      create: jest.fn(),
    };
    const customDetectorsService = {
      buildRuntimeCustomDetectors: jest.fn().mockResolvedValue([]),
    };
    const runnerLogStorage = {
      initializeRunner: jest.fn(),
      appendChunk: jest.fn(),
      finalizeRunner: jest.fn(),
      deleteRunnerLogs: jest.fn(),
      listLogs: jest.fn().mockResolvedValue({
        runnerId: 'runner-1',
        entries: [],
        nextCursor: null,
        cursor: '0',
        hasMore: false,
        take: 200,
      }),
    };
    const maskedConfigCryptoService = new MaskedConfigCryptoService();
    const service = new CliRunnerService(
      prisma as any,
      notificationsService as any,
      maskedConfigCryptoService,
      customDetectorsService as any,
      runnerLogStorage as any,
      options?.kubernetesCliJobService,
      undefined,
    );

    return { service, prisma, maskedConfigCryptoService, runnerLogStorage };
  }

  it('decrypts masked config before writing local CLI recipe', async () => {
    const { maskedConfigCryptoService } = createService();
    const plainConfig = {
      type: 'SLACK',
      required: { workspace: 'acme' },
      masked: { bot_token: 'plain-bot-token' },
    };
    const encryptedConfig =
      maskedConfigCryptoService.encryptMaskedConfig(plainConfig);
    const source = {
      id: 'source-1',
      config: encryptedConfig,
    };
    const { service, prisma } = createService({ prismaSource: source });

    jest
      .spyOn(service as any, 'isKubernetesExecutionEnabled')
      .mockReturnValue(false);
    const createTempRecipeFileSpy = jest
      .spyOn(service as any, 'createTempRecipeFile')
      .mockResolvedValue('/tmp/recipe-spec.json');
    jest.spyOn(service as any, 'buildCliTestCommand').mockReturnValue('echo');
    jest.spyOn(service as any, 'executeCli').mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    await service.testConnection('source-1');

    expect(prisma.source.findUnique).toHaveBeenCalledWith({
      where: { id: 'source-1' },
    });
    expect(createTempRecipeFileSpy).toHaveBeenCalledWith(plainConfig);
  });

  it('decrypts masked config before submitting kubernetes test job', async () => {
    const { maskedConfigCryptoService } = createService();
    const plainConfig = {
      type: 'POSTGRESQL',
      required: { host: 'db.local', port: 5432 },
      masked: { username: 'postgres', password: 'plain-db-password' },
    };
    const encryptedConfig =
      maskedConfigCryptoService.encryptMaskedConfig(plainConfig);
    const source = {
      id: 'source-2',
      config: encryptedConfig,
    };
    const kubernetesCliJobService = {
      isEnabled: jest.fn().mockReturnValue(true),
      runTestJob: jest.fn().mockResolvedValue({
        exitCode: 0,
        output: JSON.stringify({
          status: 'SUCCESS',
          message: 'Connection test completed.',
        }),
      }),
    };
    const { service } = createService({
      prismaSource: source,
      kubernetesCliJobService,
    });

    jest
      .spyOn(service as any, 'isKubernetesExecutionEnabled')
      .mockReturnValue(true);

    await service.testConnection('source-2');

    expect(kubernetesCliJobService.runTestJob).toHaveBeenCalledWith(
      'source-2',
      plainConfig,
    );
  });

  it('writes temporary recipe files with owner-only permissions', async () => {
    const { service } = createService();
    const recipe = {
      type: 'POSTGRESQL',
      required: { host: 'localhost', port: 5432 },
      masked: { username: 'postgres', password: 'secret' },
    };

    const filepath = await (service as any).createTempRecipeFile(recipe);
    try {
      const [content, stat] = await Promise.all([
        fs.readFile(filepath, 'utf8'),
        fs.stat(filepath),
      ]);

      expect(JSON.parse(content)).toEqual(recipe);
      expect(stat.mode & 0o777).toBe(0o600);
    } finally {
      await fs.unlink(filepath).catch(() => undefined);
    }
  });

  it('builds extract CLI command with REST output flags', () => {
    const { service } = createService();
    const command = (service as any).buildCliCommand(
      '/tmp/cli',
      '/tmp/cli/.venv',
      '/tmp/recipe.json',
      'source-1',
      'runner-1',
      'http://localhost:8000',
      false,
    );

    expect(command).toContain('CLASSIFYRE_SOURCE_HAS_SUCCESSFUL_RUN=0');
    expect(command).toContain('--output-type rest');
    expect(command).toContain('--output-rest-url');
    expect(command).toContain('--source-id');
    expect(command).toContain('--runner-id');
    expect(command).toContain('--managed-runner');
  });

  it('passes successful-run state into CLI execution context', async () => {
    const { service, prisma, runnerLogStorage, maskedConfigCryptoService } =
      createService();
    const plainConfig = {
      type: 'POSTGRESQL',
      required: { host: 'db.local', port: 5432 },
      sampling: {
        strategy: 'RANDOM',
        limit: 10,
        fetch_all_until_first_success: true,
      },
    };
    const encryptedConfig =
      maskedConfigCryptoService.encryptMaskedConfig(plainConfig);
    const executeCliAsyncSpy = jest
      .spyOn(service as any, 'executeCliAsync')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'getRunnerStatus').mockResolvedValue(null);

    prisma.$transaction.mockImplementation((callback: any) =>
      callback({
        source: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'source-1',
            runnerStatus: 'PENDING',
            currentRunnerId: null,
            config: encryptedConfig,
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn().mockResolvedValue({}),
        },
        runner: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({
            id: 'runner-1',
            sourceId: 'source-1',
            status: 'PENDING',
          }),
        },
      }),
    );

    await service.startRun('source-1');

    expect(runnerLogStorage.initializeRunner).toHaveBeenCalledWith('runner-1');
    expect(executeCliAsyncSpy).toHaveBeenCalledWith(
      'runner-1',
      expect.objectContaining({
        id: 'source-1',
        config: expect.objectContaining({
          type: 'POSTGRESQL',
          required: { host: 'db.local', port: 5432 },
          sampling: {
            strategy: 'RANDOM',
            limit: 10,
            fetch_all_until_first_success: true,
          },
        }),
      }),
      false,
    );
  });

  it('marks orphaned running runners as error on bootstrap', async () => {
    const { service, prisma } = createService();
    prisma.runner.findMany.mockResolvedValue([
      {
        id: 'runner-1',
        sourceId: 'source-1',
        status: RunnerStatus.RUNNING,
        executionMode: RunnerExecutionMode.LOCAL,
        jobName: null,
        jobNamespace: null,
      },
      {
        id: 'runner-2',
        sourceId: 'source-2',
        status: RunnerStatus.RUNNING,
        executionMode: RunnerExecutionMode.LOCAL,
        jobName: null,
        jobNamespace: null,
      },
    ]);
    prisma.source.findMany.mockResolvedValue([]);
    prisma.runner.update.mockResolvedValue({});
    prisma.source.updateMany.mockResolvedValue({ count: 1 });

    await service.onApplicationBootstrap();

    expect(prisma.runner.findMany).toHaveBeenCalledWith({
      where: { status: { in: ['PENDING', 'RUNNING'] } },
      select: {
        id: true,
        sourceId: true,
        status: true,
        executionMode: true,
        jobName: true,
        jobNamespace: true,
      },
    });
    expect(prisma.runner.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'runner-1' },
      data: expect.objectContaining({
        status: 'ERROR',
        errorMessage:
          'Runner was orphaned (application restarted while running)',
        completedAt: expect.any(Date),
      }),
    });
    expect(prisma.runner.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'runner-2' },
      data: expect.objectContaining({
        status: 'ERROR',
        errorMessage:
          'Runner was orphaned (application restarted while running)',
        completedAt: expect.any(Date),
      }),
    });
    expect(prisma.source.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'source-1', currentRunnerId: 'runner-1' },
      data: { runnerStatus: 'ERROR', currentRunnerId: null },
    });
    expect(prisma.source.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'source-2', currentRunnerId: 'runner-2' },
      data: { runnerStatus: 'ERROR', currentRunnerId: null },
    });
  });

  it('repairs sources stuck in RUNNING when the current runner record is missing', async () => {
    const { service, prisma } = createService();
    prisma.runner.findMany.mockResolvedValue([]);
    prisma.source.findMany.mockResolvedValue([
      {
        id: 'source-1',
        name: 'Source 1',
        currentRunnerId: 'missing-runner',
      },
    ]);
    prisma.runner.findUnique.mockResolvedValue(null);
    prisma.source.update.mockResolvedValue({});

    await service.onApplicationBootstrap();

    expect(prisma.source.update).toHaveBeenCalledWith({
      where: { id: 'source-1' },
      data: {
        runnerStatus: 'ERROR',
        currentRunnerId: null,
      },
    });
  });

  it('returns paginated runner logs for existing runner', async () => {
    const { service, prisma, runnerLogStorage } = createService();
    prisma.runner.findUnique.mockResolvedValue({ id: 'runner-1' });
    runnerLogStorage.listLogs.mockResolvedValue({
      runnerId: 'runner-1',
      entries: [
        {
          cursor: '0',
          timestamp: '2026-02-13T09:00:00.000Z',
          stream: 'stderr',
          message: 'hello',
        },
      ],
      nextCursor: null,
      cursor: '17',
      hasMore: false,
      take: 1,
    });

    const result = await service.getRunnerLogs({
      runnerId: 'runner-1',
      take: 1,
    });

    expect(prisma.runner.findUnique).toHaveBeenCalledWith({
      where: { id: 'runner-1' },
      select: { id: true },
    });
    expect(runnerLogStorage.listLogs).toHaveBeenCalledWith({
      runnerId: 'runner-1',
      take: 1,
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].message).toBe('hello');
  });

  it('deletes runner and filesystem logs', async () => {
    const { service, prisma, runnerLogStorage } = createService();
    prisma.runner.findUnique.mockResolvedValue({
      id: 'runner-1',
      sourceId: 'source-1',
      status: 'COMPLETED',
    });
    prisma.$transaction.mockImplementation((callback: any) => {
      const tx = {
        runner: {
          delete: jest.fn().mockResolvedValue({ id: 'runner-1' }),
        },
        source: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ currentRunnerId: 'runner-1' }),
          update: jest.fn().mockResolvedValue({}),
        },
      };
      return callback(tx);
    });

    const result = await service.deleteRunner('runner-1');

    expect(prisma.runner.findUnique).toHaveBeenCalledWith({
      where: { id: 'runner-1' },
      select: { id: true, sourceId: true, status: true },
    });
    expect(runnerLogStorage.deleteRunnerLogs).toHaveBeenCalledWith('runner-1');
    expect(result).toEqual({ message: 'Runner deleted' });
  });

  it('does not delete runner record when log cleanup fails', async () => {
    const { service, prisma, runnerLogStorage } = createService();
    prisma.runner.findUnique.mockResolvedValue({
      id: 'runner-1',
      sourceId: 'source-1',
      status: 'COMPLETED',
    });
    runnerLogStorage.deleteRunnerLogs.mockRejectedValue(
      new Error('cleanup failed'),
    );

    await expect(service.deleteRunner('runner-1')).rejects.toThrow(
      'cleanup failed',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates external runner without launching CLI process', async () => {
    const { service, prisma, runnerLogStorage } = createService();
    prisma.source.findUnique.mockResolvedValue({
      id: 'source-1',
      runnerStatus: 'COMPLETED',
    });
    prisma.source.updateMany.mockResolvedValue({ count: 1 });
    prisma.runner.create.mockResolvedValue({
      id: 'runner-ext-1',
      sourceId: 'source-1',
      status: 'RUNNING',
    });

    await service.createExternalRunner('source-1', 'cli-user');

    expect(prisma.runner.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceId: 'source-1',
          status: 'RUNNING',
          triggeredBy: 'cli-user',
        }),
      }),
    );
    expect(runnerLogStorage.initializeRunner).toHaveBeenCalledWith(
      'runner-ext-1',
    );
    expect(prisma.source.updateMany).toHaveBeenCalledWith({
      where: { id: 'source-1', runnerStatus: { not: 'RUNNING' } },
      data: { runnerStatus: 'RUNNING' },
    });
    expect(prisma.source.update).toHaveBeenCalledWith({
      where: { id: 'source-1' },
      data: { currentRunnerId: 'runner-ext-1' },
    });
  });

  it('rejects startRun when source already has a running scan', async () => {
    const { service, prisma } = createService();
    prisma.$transaction.mockImplementation((callback: any) => {
      const tx = {
        source: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'source-1',
            runnerStatus: 'RUNNING',
            currentRunnerId: 'runner-active-1',
            config: {},
          }),
          updateMany: jest.fn(),
          update: jest.fn(),
        },
        runner: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'runner-active-1',
            status: RunnerStatus.RUNNING,
          }),
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
        },
      };
      return callback(tx);
    });

    await expect(service.startRun('source-1')).rejects.toThrow(
      'already has a running scan',
    );
  });

  it('repairs a missing current runner reference before creating a new run', async () => {
    const { runnerLogStorage, maskedConfigCryptoService } = createService();
    const plainConfig = {
      type: 'POSTGRESQL',
      required: { host: 'db.local', port: 5432 },
    };
    const encryptedConfig =
      maskedConfigCryptoService.encryptMaskedConfig(plainConfig);

    const tx = {
      source: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'source-1',
          runnerStatus: RunnerStatus.RUNNING,
          currentRunnerId: 'missing-runner',
          config: encryptedConfig,
        }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      runner: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'runner-2',
          sourceId: 'source-1',
          status: RunnerStatus.PENDING,
        }),
      },
    };
    const prisma = {
      source: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      customDetectorFeedback: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      runner: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn(),
      },
      asset: {
        count: jest.fn(),
      },
      finding: {
        count: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));
    const service = new CliRunnerService(
      prisma as any,
      { create: jest.fn() } as any,
      maskedConfigCryptoService,
      { buildRuntimeCustomDetectors: jest.fn().mockResolvedValue([]) } as any,
      runnerLogStorage as any,
      undefined,
      undefined,
    );
    jest.spyOn(service as any, 'executeCliAsync').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'getRunnerStatus').mockResolvedValue(null);

    await service.startRun('source-1');

    expect(tx.source.update).toHaveBeenCalledWith({
      where: { id: 'source-1' },
      data: {
        runnerStatus: RunnerStatus.ERROR,
        currentRunnerId: null,
      },
    });
    expect(tx.runner.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceId: 'source-1',
        status: RunnerStatus.PENDING,
      }),
    });
    expect(runnerLogStorage.initializeRunner).toHaveBeenCalledWith('runner-2');
    expect((service as any).executeCliAsync).toHaveBeenCalledWith(
      'runner-2',
      expect.objectContaining({ id: 'source-1' }),
      false,
    );
  });

  it('recomputes stats from asset statuses when marking runner completed', async () => {
    const { service, prisma, runnerLogStorage } = createService();
    prisma.runner.findUnique.mockResolvedValue({
      id: 'runner-1',
      sourceId: 'source-1',
      startedAt: new Date('2026-02-18T10:00:00.000Z'),
      source: { id: 'source-1', name: 'Source', type: 'WORDPRESS' },
    });
    prisma.asset.count
      .mockResolvedValueOnce(3) // NEW
      .mockResolvedValueOnce(2) // UPDATED
      .mockResolvedValueOnce(5); // UNCHANGED
    prisma.finding.count.mockResolvedValue(7);
    prisma.runner.update.mockResolvedValue({});
    prisma.source.update.mockResolvedValue({});

    await service.updateRunnerStatus('runner-1', RunnerStatus.COMPLETED);

    expect(runnerLogStorage.finalizeRunner).toHaveBeenCalledWith('runner-1');
    expect(prisma.runner.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'runner-1' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          assetsCreated: 3,
          assetsUpdated: 2,
          assetsUnchanged: 5,
          totalFindings: 7,
        }),
      }),
    );
    expect(prisma.source.updateMany).toHaveBeenCalledWith({
      where: { id: 'source-1', currentRunnerId: 'runner-1' },
      data: { runnerStatus: 'COMPLETED', currentRunnerId: null },
    });
  });

  it('updates source runnerStatus when stopping a running runner', async () => {
    const { service, prisma, runnerLogStorage } = createService();
    prisma.runner.findUnique
      .mockResolvedValueOnce({
        id: 'runner-1',
        sourceId: 'source-1',
        status: 'RUNNING',
        executionMode: RunnerExecutionMode.LOCAL,
        jobName: null,
        jobNamespace: null,
      })
      .mockResolvedValueOnce({
        id: 'runner-1',
        sourceId: 'source-1',
        status: 'ERROR',
      });

    const tx = {
      runner: {
        update: jest.fn().mockResolvedValue({}),
      },
      source: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));

    await expect(service.stopRunner('runner-1')).resolves.toEqual({
      message: 'Runner stopped',
    });

    expect(runnerLogStorage.finalizeRunner).toHaveBeenCalledWith('runner-1');
    expect(tx.runner.update).toHaveBeenCalledWith({
      where: { id: 'runner-1' },
      data: expect.objectContaining({
        status: 'ERROR',
        errorMessage: 'Manually stopped',
      }),
    });
    expect(tx.source.updateMany).toHaveBeenCalledWith({
      where: { id: 'source-1', currentRunnerId: 'runner-1' },
      data: { runnerStatus: 'ERROR', currentRunnerId: null },
    });
  });

  it('does not overwrite a terminal runner state after kubernetes job exit', async () => {
    const kubernetesCliJobService = {
      isEnabled: jest.fn().mockReturnValue(true),
      runExtractJob: jest.fn().mockResolvedValue({
        exitCode: 1,
        output: 'job output',
        jobName: 'job-1',
        namespace: 'classifyre',
      }),
    };
    const { service, prisma } = createService({
      kubernetesCliJobService,
    });
    prisma.runner.findUnique.mockResolvedValue({
      status: RunnerStatus.COMPLETED,
    });

    const completeRunnerSpy = jest.spyOn(service as any, 'completeRunner');
    const failRunnerSpy = jest.spyOn(service as any, 'failRunner');

    await (service as any).executeCliInKubernetes(
      'runner-1',
      { id: 'source-1' },
      false,
    );

    const runExtractJobCall =
      kubernetesCliJobService.runExtractJob.mock.calls[0];
    expect(runExtractJobCall[0]).toBe('runner-1');
    expect(runExtractJobCall[1]).toBe('source-1');
    expect(runExtractJobCall[2]).toBeUndefined();
    expect(runExtractJobCall[4]).toBe(false);
    expect(runExtractJobCall[5]).toEqual(expect.any(Function));
    expect(runExtractJobCall[6]).toEqual(expect.any(Function));
    expect(prisma.runner.findUnique).toHaveBeenCalledWith({
      where: { id: 'runner-1' },
      select: { status: true },
    });
    expect(completeRunnerSpy).not.toHaveBeenCalled();
    expect(failRunnerSpy).not.toHaveBeenCalled();
  });

  it('terminates tracked local process when stopping a running runner', async () => {
    jest.useFakeTimers();
    try {
      const { service, prisma } = createService();
      prisma.runner.findUnique
        .mockResolvedValueOnce({
          id: 'runner-1',
          sourceId: 'source-1',
          status: 'RUNNING',
          executionMode: RunnerExecutionMode.LOCAL,
          jobName: null,
          jobNamespace: null,
        })
        .mockResolvedValueOnce({
          id: 'runner-1',
          sourceId: 'source-1',
          status: 'ERROR',
        });

      const tx = {
        runner: {
          update: jest.fn().mockResolvedValue({}),
        },
        source: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      prisma.$transaction.mockImplementation((callback: any) => callback(tx));

      const child = {
        pid: 12345,
        exitCode: null,
        signalCode: null,
        kill: jest.fn().mockReturnValue(true),
      };
      (service as any).runningProcessesByRunnerId.set('runner-1', child);

      const terminateSpy = jest
        .spyOn(service as any, 'terminateProcessTree')
        .mockReturnValue(true);

      await service.stopRunner('runner-1');
      expect(terminateSpy).toHaveBeenCalledWith(child, 'SIGTERM');

      jest.advanceTimersByTime(5000);
      expect(terminateSpy).toHaveBeenCalledWith(child, 'SIGKILL');
    } finally {
      jest.useRealTimers();
    }
  });

  it('passes persisted kubernetes job identity into stopRunner reconciliation', async () => {
    const kubernetesCliJobService = {
      isEnabled: jest.fn().mockReturnValue(true),
      stopRunnerJob: jest.fn().mockResolvedValue(undefined),
    };
    const { service, prisma } = createService({
      kubernetesCliJobService,
    });
    prisma.runner.findUnique
      .mockResolvedValueOnce({
        id: 'runner-1',
        sourceId: 'source-1',
        status: RunnerStatus.RUNNING,
        executionMode: RunnerExecutionMode.KUBERNETES,
        jobName: 'job-1',
        jobNamespace: 'classifyre',
      })
      .mockResolvedValueOnce({
        id: 'runner-1',
        sourceId: 'source-1',
        status: 'ERROR',
      });

    const tx = {
      runner: {
        update: jest.fn().mockResolvedValue({}),
      },
      source: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));

    await service.stopRunner('runner-1');

    expect(kubernetesCliJobService.stopRunnerJob).toHaveBeenCalledWith(
      'runner-1',
      {
        jobName: 'job-1',
        namespace: 'classifyre',
      },
    );
  });

  it('buckets feedback rows by current detector key when detector ID matches', async () => {
    const { service, prisma } = createService();
    prisma.customDetectorFeedback.findMany.mockResolvedValue([
      {
        customDetectorId: 'detector-id-1',
        customDetectorKey: 'legacy-key',
        matchedContent: 'example text',
        status: 'RESOLVED',
        label: 'label-1',
      },
    ]);

    const recipe = {
      detectors: [
        {
          type: 'CUSTOM',
          config: {
            method: 'CLASSIFIER',
            custom_detector_key: 'current-key',
            classifier: {
              labels: [{ id: 'label-1' }],
            },
          },
        },
      ],
    };

    const result = await (service as any).injectCustomDetectorFeedbackExamples(
      'source-1',
      recipe,
      new Map([['current-key', 'detector-id-1']]),
    );

    expect(result.detectors[0].config.classifier.training_examples).toEqual([
      {
        text: 'example text',
        label: 'label-1',
        accepted: true,
        source: 'feedback',
      },
    ]);
  });

  it('falls back to row key when detector ID does not map to an active detector', async () => {
    const { service, prisma } = createService();
    prisma.customDetectorFeedback.findMany.mockResolvedValue([
      {
        customDetectorId: 'stale-id',
        customDetectorKey: 'current-key',
        matchedContent: 'example text',
        status: 'FALSE_POSITIVE',
        label: 'label-1',
      },
    ]);

    const recipe = {
      detectors: [
        {
          type: 'CUSTOM',
          config: {
            method: 'CLASSIFIER',
            custom_detector_key: 'current-key',
            classifier: {
              labels: [{ id: 'label-1' }],
            },
          },
        },
      ],
    };

    const result = await (service as any).injectCustomDetectorFeedbackExamples(
      'source-1',
      recipe,
      new Map([['current-key', 'detector-id-1']]),
    );

    expect(result.detectors[0].config.classifier.training_examples).toEqual([
      {
        text: 'example text',
        label: 'label-1',
        accepted: false,
        source: 'feedback',
      },
    ]);
  });
});
