import { KubernetesCliJobService } from './kubernetes-cli-job.service';
import type { InstanceSettingsService } from '../instance-settings.service';

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

function mockInstanceSettings(): InstanceSettingsService {
  return {
    getUserHfToken: jest.fn().mockResolvedValue(null),
  } as unknown as InstanceSettingsService;
}

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
    const service = new KubernetesCliJobService(mockInstanceSettings());
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

    const service = new KubernetesCliJobService(mockInstanceSettings()) as any;
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

    const service = new KubernetesCliJobService(mockInstanceSettings()) as any;
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

    const service = new KubernetesCliJobService(mockInstanceSettings());
    expect((service as any).cleanupPolicy).toBe('always');
  });

  it('builds extract command with REST output flags', () => {
    const service = new KubernetesCliJobService(mockInstanceSettings());
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

  it('builds sandbox command reading file from the mounted volume', () => {
    const service = new KubernetesCliJobService(mockInstanceSettings());
    const command = (service as any).buildJobCommand(
      'sandbox',
      '/app/apps/cli',
      true, // sandboxViaVolume
    );

    expect(command).toContain('cd /app/apps/cli');
    // File is no longer inlined; it is read from the init-container volume.
    expect(command).not.toContain('SANDBOX_FILE_B64');
    expect(command).toContain('/sandbox-input/input${SANDBOX_FILE_EXT:-}');
    expect(command).toContain('SANDBOX_DETECTORS_B64');
    expect(command).toContain('base64 -d');
    expect(command).toContain('src.main sandbox');
    expect(command).toContain('--detectors-file /tmp/sandbox-detectors.json');
    expect(command).not.toContain('RECIPE_B64');
  });

  it('transports the sandbox file via an init-container + emptyDir volume (no base64 inline)', async () => {
    const service = new KubernetesCliJobService(mockInstanceSettings());
    const detectors = [{ type: 'BUILTIN_EMAIL', enabled: true }];
    const job = await (service as any).buildJobFromTemplate(
      {
        apiVersion: 'batch/v1',
        kind: 'Job',
        spec: {
          template: {
            spec: {
              containers: [
                {
                  name: 'cli',
                  image: 'cli:latest',
                  env: [
                    {
                      name: 'CLASSIFYRE_OUTPUT_REST_URL',
                      value: 'http://api.svc:8000',
                    },
                  ],
                },
              ],
            },
          },
        },
      },
      {
        sourceId: 'sandbox-run-1',
        mode: 'sandbox',
        sandboxFileExt: '.txt',
        sandboxDetectorsB64: Buffer.from(
          JSON.stringify(detectors),
          'utf8',
        ).toString('base64'),
      },
    );
    const podSpec = job.spec?.template?.spec;
    const env = podSpec?.containers?.[0]?.env ?? [];

    // File is NOT inlined anymore.
    expect(
      env.find((item: any) => item.name === 'SANDBOX_FILE_B64'),
    ).toBeUndefined();
    expect(
      env.find((item: any) => item.name === 'SANDBOX_FILE_EXT')?.value,
    ).toBe('.txt');
    expect(
      env.find((item: any) => item.name === 'SANDBOX_DETECTORS_B64')?.value,
    ).toBe(Buffer.from(JSON.stringify(detectors), 'utf8').toString('base64'));

    // emptyDir volume mounted into the main container.
    expect(
      podSpec.volumes?.find((v: any) => v.name === 'sandbox-input')?.emptyDir,
    ).toBeDefined();
    expect(
      podSpec.containers[0].volumeMounts?.find(
        (m: any) => m.name === 'sandbox-input',
      )?.mountPath,
    ).toBe('/sandbox-input');

    // init-container fetches the file from the API into the volume.
    const init = podSpec.initContainers?.find(
      (c: any) => c.name === 'sandbox-input-fetch',
    );
    expect(init).toBeDefined();
    expect(init.image).toBe('cli:latest');
    expect(
      init.volumeMounts?.find((m: any) => m.name === 'sandbox-input')
        ?.mountPath,
    ).toBe('/sandbox-input');
    expect(init.args?.[0]).toContain('/sandbox/runs/');
    expect(init.args?.[0]).toContain('/input');
    expect(
      init.env?.find((e: any) => e.name === 'CLASSIFYRE_OUTPUT_REST_URL')
        ?.value,
    ).toBe('http://api.svc:8000');
  });

  it('strips server-generated identity fields from a captured-job template', async () => {
    const service = new KubernetesCliJobService(mockInstanceSettings());
    // Simulates K8S_CLI_JOB_TEMPLATE_PATH pointing at a dumped live Job, which
    // carries a prior job's selector + controller-uid/job-name pod labels.
    const job = await (service as any).buildJobFromTemplate(
      {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
          uid: 'old-uid',
          resourceVersion: '12345',
          labels: { 'controller-uid': 'stale-uid' },
        },
        status: { active: 1 },
        spec: {
          selector: {
            matchLabels: { 'batch.kubernetes.io/controller-uid': 'stale-uid' },
          },
          manualSelector: false,
          template: {
            metadata: {
              labels: {
                'controller-uid': 'stale-uid',
                'job-name': 'old-job',
                'batch.kubernetes.io/controller-uid': 'stale-uid',
                'batch.kubernetes.io/job-name': 'old-job',
              },
            },
            spec: { containers: [{ name: 'cli', image: 'cli:latest' }] },
          },
        },
      },
      { sourceId: 'source-1', mode: 'extract', recipe: { type: 'POSTGRESQL' } },
    );

    expect(job.status).toBeUndefined();
    expect(job.metadata?.uid).toBeUndefined();
    expect(job.metadata?.resourceVersion).toBeUndefined();
    expect(job.spec?.selector).toBeUndefined();
    expect(job.spec?.manualSelector).toBeUndefined();

    const podLabels = job.spec?.template?.metadata?.labels ?? {};
    for (const key of [
      'controller-uid',
      'job-name',
      'batch.kubernetes.io/controller-uid',
      'batch.kubernetes.io/job-name',
    ]) {
      expect(podLabels[key]).toBeUndefined();
    }
    expect(job.metadata?.labels?.['controller-uid']).toBeUndefined();
    // Our own labels survive.
    expect(podLabels['app.kubernetes.io/managed-by']).toBe('classifyre-api');
  });

  it('injects successful-run state env var into extract jobs', async () => {
    const service = new KubernetesCliJobService(mockInstanceSettings());
    const job = await (service as any).buildJobFromTemplate(
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
