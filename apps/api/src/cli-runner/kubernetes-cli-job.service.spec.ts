import { KubernetesCliJobService } from './kubernetes-cli-job.service';

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

describe('KubernetesCliJobService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.K8S_JOBS_ENABLED = '0';
    delete process.env.CLASSIFYRE_K8S_JOBS_ENABLED;
    delete process.env.K8S_CLI_JOB_CLEANUP_POLICY;
    delete process.env.CLASSIFYRE_K8S_CLI_JOB_CLEANUP_POLICY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function makeService(cleanupPolicy: 'none' | 'failed' | 'always') {
    process.env.K8S_CLI_JOB_CLEANUP_POLICY = cleanupPolicy;
    const service = new KubernetesCliJobService();
    const batchApi = {
      deleteNamespacedJob: jest.fn().mockResolvedValue(undefined),
    };
    Object.defineProperty(service as any, 'batchApi', {
      value: batchApi,
      configurable: true,
    });
    return { service, batchApi };
  }

  function mockRunJobInternals(
    service: any,
    completion: { succeeded: boolean; exitCode?: number; output?: string },
  ) {
    jest.spyOn(service, 'loadTemplate').mockResolvedValue({});
    jest.spyOn(service, 'buildJobFromTemplate').mockReturnValue({
      metadata: {
        name: 'classifyre-extract-test-abc123',
        namespace: 'classifyre-dev',
      },
      spec: {
        template: {
          spec: {
            containers: [{ name: 'cli' }],
          },
        },
      },
    });
    jest.spyOn(service, 'createJob').mockResolvedValue(undefined);
    jest.spyOn(service, 'waitForJobCompletion').mockResolvedValue({
      output: 'job logs',
      ...completion,
    });
  }

  it('cleans up failed jobs when cleanup policy is failed', async () => {
    const { service, batchApi } = makeService('failed');
    mockRunJobInternals(service, { succeeded: false, exitCode: 2 });

    const result = await (service as any).runJob({
      sourceId: 'source-1',
      recipe: { type: 'POSTGRESQL' },
      mode: 'extract',
      runnerId: 'runner-1',
    });

    expect(result).toEqual({
      exitCode: 2,
      output: 'job logs',
      jobName: 'classifyre-extract-test-abc123',
      namespace: 'classifyre-dev',
    });
    expect(batchApi.deleteNamespacedJob).toHaveBeenCalledWith({
      name: 'classifyre-extract-test-abc123',
      namespace: 'classifyre-dev',
      propagationPolicy: 'Background',
    });
    expect((service as any).runningJobsByRunnerId.size).toBe(0);
  });

  it('keeps successful jobs when cleanup policy is failed', async () => {
    const { service, batchApi } = makeService('failed');
    mockRunJobInternals(service, { succeeded: true, exitCode: 0 });

    const result = await (service as any).runJob({
      sourceId: 'source-2',
      recipe: { type: 'POSTGRESQL' },
      mode: 'extract',
      runnerId: 'runner-2',
    });

    expect(result.exitCode).toBe(0);
    expect(batchApi.deleteNamespacedJob).not.toHaveBeenCalled();
    expect((service as any).runningJobsByRunnerId.size).toBe(0);
  });

  it('cleans up successful jobs when cleanup policy is always', async () => {
    const { service, batchApi } = makeService('always');
    mockRunJobInternals(service, { succeeded: true, exitCode: 0 });

    await (service as any).runJob({
      sourceId: 'source-3',
      recipe: { type: 'POSTGRESQL' },
      mode: 'test',
    });

    expect(batchApi.deleteNamespacedJob).toHaveBeenCalledTimes(1);
  });

  it('cleans up jobs on runner errors when cleanup policy is failed', async () => {
    const { service, batchApi } = makeService('failed');
    jest.spyOn(service as any, 'loadTemplate').mockResolvedValue({});
    jest.spyOn(service as any, 'buildJobFromTemplate').mockReturnValue({
      metadata: {
        name: 'classifyre-extract-test-err999',
        namespace: 'classifyre-dev',
      },
      spec: {
        template: {
          spec: {
            containers: [{ name: 'cli' }],
          },
        },
      },
    });
    jest.spyOn(service as any, 'createJob').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'waitForJobCompletion')
      .mockRejectedValue(new Error('timeout'));

    await expect(
      (service as any).runJob({
        sourceId: 'source-4',
        recipe: { type: 'POSTGRESQL' },
        mode: 'extract',
        runnerId: 'runner-4',
      }),
    ).rejects.toThrow('timeout');

    expect(batchApi.deleteNamespacedJob).toHaveBeenCalledWith({
      name: 'classifyre-extract-test-err999',
      namespace: 'classifyre-dev',
      propagationPolicy: 'Background',
    });
    expect((service as any).runningJobsByRunnerId.size).toBe(0);
  });

  it('streams Kubernetes job log deltas while waiting for completion', async () => {
    process.env.K8S_JOBS_ENABLED = '1';
    process.env.K8S_CLI_JOB_POLL_INTERVAL_MS = '1';

    const service = new KubernetesCliJobService() as any;
    const batchApi = {
      readNamespacedJob: jest
        .fn()
        .mockResolvedValueOnce({ body: { status: {} } })
        .mockResolvedValueOnce({ body: { status: { succeeded: 1 } } }),
    };
    Object.defineProperty(service, 'batchApi', {
      value: batchApi,
      configurable: true,
    });

    jest
      .spyOn(service, 'readJobLogs')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('line 1\n')
      .mockResolvedValueOnce('line 1\nline 2\n');

    const onLogChunk = jest.fn().mockResolvedValue(undefined);

    const result = await service.waitForJobCompletion(
      'classifyre',
      'job-1',
      onLogChunk,
    );

    expect(result).toEqual({
      succeeded: true,
      exitCode: 0,
      output: 'line 1\nline 2\n',
    });
    expect(onLogChunk).toHaveBeenNthCalledWith(1, 'line 1\n');
    expect(onLogChunk).toHaveBeenNthCalledWith(2, 'line 2\n');
  });

  it('ignores transient pod log 400 errors while sandbox container is not yet available', async () => {
    process.env.K8S_JOBS_ENABLED = '1';
    process.env.K8S_CLI_JOB_POLL_INTERVAL_MS = '1';

    const service = new KubernetesCliJobService() as any;
    const batchApi = {
      readNamespacedJob: jest
        .fn()
        .mockResolvedValueOnce({ body: { status: {} } })
        .mockResolvedValueOnce({ body: { status: { succeeded: 1 } } }),
    };
    Object.defineProperty(service, 'batchApi', {
      value: batchApi,
      configurable: true,
    });

    jest
      .spyOn(service, 'readJobLogs')
      .mockRejectedValueOnce(
        Object.assign(new Error('Unknown API Status Code!'), {
          statusCode: 400,
          message:
            'HTTP-Code: 400 Body: {"message":"container \\"cli\\" in pod \\"sandbox-pod\\" is not available"}',
        }),
      )
      .mockResolvedValueOnce('sandbox output\n')
      .mockResolvedValueOnce('sandbox output\n');

    const onLogChunk = jest.fn().mockResolvedValue(undefined);

    const result = await service.waitForJobCompletion(
      'classifyre',
      'job-1',
      onLogChunk,
    );

    expect(result).toEqual({
      succeeded: true,
      exitCode: 0,
      output: 'sandbox output\n',
    });
    expect(onLogChunk).toHaveBeenCalledWith('sandbox output\n');
  });

  it('defaults cleanup policy to always when not configured', () => {
    delete process.env.K8S_CLI_JOB_CLEANUP_POLICY;
    delete process.env.CLASSIFYRE_K8S_CLI_JOB_CLEANUP_POLICY;

    const service = new KubernetesCliJobService();
    expect((service as any).cleanupPolicy).toBe('always');
  });

  it('builds extract command with REST output flags', () => {
    const service = new KubernetesCliJobService();
    const command = (service as any).buildJobCommand(
      'extract',
      '/app/apps/cli',
    );

    expect(command).toContain(
      'OUTPUT_REST_URL="${CLASSIFYRE_OUTPUT_REST_URL:-http://127.0.0.1:8000}"',
    );
    expect(command).toContain(
      'OUTPUT_BATCH_SIZE="${CLASSIFYRE_OUTPUT_BATCH_SIZE:-20}"',
    );
    expect(command).toContain('--output-type rest');
    expect(command).toContain('--output-rest-url');
    expect(command).toContain('--source-id');
    expect(command).toContain('--runner-id');
    expect(command).toContain('--managed-runner');
  });

  it('builds sandbox command with shared input paths', () => {
    const service = new KubernetesCliJobService();
    const command = (service as any).buildJobCommand(
      'sandbox',
      '/app/apps/cli',
    );

    expect(command).toContain('cd /app/apps/cli');
    expect(command).toContain('src.main sandbox "$SANDBOX_INPUT_PATH"');
    expect(command).toContain('--detectors-file "$SANDBOX_DETECTORS_PATH"');
    expect(command).not.toContain('RECIPE_B64');
  });

  it('injects sandbox file env vars into sandbox jobs', () => {
    const service = new KubernetesCliJobService();
    const job = (service as any).buildJobFromTemplate(
      {
        apiVersion: 'batch/v1',
        kind: 'Job',
        spec: {
          template: {
            spec: {
              containers: [{ name: 'cli', image: 'cli:latest' }],
            },
          },
        },
      },
      {
        sourceId: 'sandbox-run-1',
        mode: 'sandbox',
        sandboxInputPath:
          '/var/lib/classifyre/runner-logs/sandbox-runs/sandbox-run-1/input.txt',
        sandboxDetectorsPath:
          '/var/lib/classifyre/runner-logs/sandbox-runs/sandbox-run-1/detectors.json',
      },
    );
    const env = job.spec?.template?.spec?.containers?.[0]?.env ?? [];

    expect(env.find((item) => item.name === 'SANDBOX_INPUT_PATH')?.value).toBe(
      '/var/lib/classifyre/runner-logs/sandbox-runs/sandbox-run-1/input.txt',
    );
    expect(
      env.find((item) => item.name === 'SANDBOX_DETECTORS_PATH')?.value,
    ).toBe(
      '/var/lib/classifyre/runner-logs/sandbox-runs/sandbox-run-1/detectors.json',
    );
    expect(env.find((item) => item.name === 'RECIPE_B64')).toBeUndefined();
  });

  it('injects successful-run state env var into extract jobs', () => {
    const service = new KubernetesCliJobService();
    const job = (service as any).buildJobFromTemplate(
      {
        apiVersion: 'batch/v1',
        kind: 'Job',
        spec: {
          template: {
            spec: {
              containers: [{ name: 'cli', image: 'cli:latest' }],
            },
          },
        },
      },
      {
        sourceId: 'source-1',
        runnerId: 'runner-1',
        mode: 'extract',
        recipe: { type: 'POSTGRESQL' },
        hasSuccessfulRuns: false,
      },
    );
    const env = job.spec?.template?.spec?.containers?.[0]?.env ?? [];
    const entry = env.find(
      (item) => item.name === 'CLASSIFYRE_SOURCE_HAS_SUCCESSFUL_RUN',
    );

    expect(entry?.value).toBe('0');
  });
});
