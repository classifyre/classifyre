import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import type {
  BatchV1Api,
  CoreV1Api,
  KubeConfig,
  V1Container,
  V1EnvVar,
  V1Job,
  V1Pod,
  V1PodList,
} from '@kubernetes/client-node';

type KubernetesModule = typeof import('@kubernetes/client-node');

type CliJobMode = 'extract' | 'test' | 'sandbox';
type JobCleanupPolicy = 'none' | 'failed' | 'always';

interface CliJobResult {
  exitCode: number;
  output: string;
  jobName: string;
  namespace: string;
  failureContext?: string;
}

type CliJobLogHandler = (chunk: string) => Promise<void> | void;
type CliJobCreatedHandler = (job: JobRef) => Promise<void> | void;

interface JobRef {
  jobName: string;
  namespace: string;
}

@Injectable()
export class KubernetesCliJobService {
  private readonly logger = new Logger(KubernetesCliJobService.name);
  private readonly namespace =
    process.env.K8S_JOBS_NAMESPACE ||
    process.env.POD_NAMESPACE ||
    process.env.KUBERNETES_NAMESPACE ||
    'default';
  private readonly enabled = this.resolveEnabled();
  private readonly cleanupPolicy = this.resolveCleanupPolicy();
  private k8sModule: KubernetesModule | null = null;
  private kc: KubeConfig | null = null;
  private batchApi: BatchV1Api | null = null;
  private coreApi: CoreV1Api | null = null;
  private readonly runningJobsByRunnerId = new Map<string, JobRef>();
  private cachedTemplate: V1Job | null = null;

  constructor() {}

  isEnabled(): boolean {
    return this.enabled;
  }

  async runExtractJob(
    runnerId: string,
    sourceId: string,
    recipe: Record<string, unknown>,
    outputRestUrl?: string,
    hasSuccessfulRuns?: boolean,
    onLogChunk?: CliJobLogHandler,
    onJobCreated?: CliJobCreatedHandler,
  ): Promise<CliJobResult> {
    return this.runJob({
      runnerId,
      sourceId,
      recipe,
      mode: 'extract',
      outputRestUrl,
      hasSuccessfulRuns,
      onLogChunk,
      onJobCreated,
    });
  }

  async runTestJob(
    sourceId: string,
    recipe: Record<string, unknown>,
  ): Promise<CliJobResult> {
    return this.runJob({
      sourceId,
      recipe,
      mode: 'test',
    });
  }

  async runSandboxJob(params: {
    runId: string;
    inputFilePath: string;
    detectorsFilePath: string;
  }): Promise<CliJobResult> {
    return this.runJob({
      sourceId: params.runId,
      mode: 'sandbox',
      sandboxInputPath: params.inputFilePath,
      sandboxDetectorsPath: params.detectorsFilePath,
      jobTrackingKey: params.runId,
    });
  }

  async stopRunnerJob(
    runnerId: string,
    persistedRef?: Partial<JobRef>,
  ): Promise<void> {
    await this.stopTrackedJob(runnerId, persistedRef);
  }

  async stopSandboxJob(runId: string): Promise<void> {
    await this.stopTrackedJob(runId);
  }

  private async stopTrackedJob(
    jobTrackingKey: string,
    persistedRef?: Partial<JobRef>,
  ): Promise<void> {
    await this.ensureKubernetesClients();
    if (!this.batchApi) {
      return;
    }

    const trackedJob = this.runningJobsByRunnerId.get(jobTrackingKey);
    const jobRef =
      trackedJob ||
      (persistedRef?.jobName
        ? {
            jobName: persistedRef.jobName,
            namespace: persistedRef.namespace || this.namespace,
          }
        : undefined);
    if (!jobRef) {
      return;
    }

    this.runningJobsByRunnerId.delete(jobTrackingKey);
    try {
      await (this.batchApi as any).deleteNamespacedJob({
        name: jobRef.jobName,
        namespace: jobRef.namespace,
        propagationPolicy: 'Background',
      });
    } catch (error: any) {
      if (this.isNotFound(error)) {
        return;
      }
      throw error;
    }
  }

  async isJobActive(
    jobName: string,
    namespace = this.namespace,
  ): Promise<boolean> {
    await this.ensureKubernetesClients();
    if (!this.batchApi) {
      return false;
    }

    try {
      const response = await (this.batchApi as any).readNamespacedJob({
        namespace,
        name: jobName,
      });
      const job = this.unwrapBody<V1Job>(response);
      const status = job.status;

      if ((status?.succeeded || 0) > 0 || (status?.failed || 0) > 0) {
        return false;
      }

      return true;
    } catch (error: any) {
      if (this.isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  private resolveEnabled(): boolean {
    const mode = (process.env.ENVIRONMENT || '').toLowerCase();
    const explicit =
      process.env.K8S_JOBS_ENABLED ||
      process.env.CLASSIFYRE_K8S_JOBS_ENABLED ||
      '';
    if (explicit) {
      return !['0', 'false', 'no'].includes(explicit.toLowerCase());
    }
    return mode === 'kubernetes';
  }

  private async runJob(params: {
    sourceId: string;
    mode: CliJobMode;
    runnerId?: string;
    recipe?: Record<string, unknown>;
    outputRestUrl?: string;
    hasSuccessfulRuns?: boolean;
    sandboxInputPath?: string;
    sandboxDetectorsPath?: string;
    jobTrackingKey?: string;
    onLogChunk?: CliJobLogHandler;
    onJobCreated?: CliJobCreatedHandler;
  }): Promise<CliJobResult> {
    await this.ensureKubernetesClients();
    if (!this.batchApi) {
      throw new Error('Kubernetes client is not initialized');
    }

    const template = await this.loadTemplate();
    const job = this.buildJobFromTemplate(template, params);
    const namespace = job.metadata?.namespace || this.namespace;
    const jobName = job.metadata?.name;

    if (!jobName) {
      throw new Error('CLI Job manifest is missing metadata.name');
    }

    const jobTrackingKey = params.jobTrackingKey || params.runnerId;
    if (jobTrackingKey) {
      this.runningJobsByRunnerId.set(jobTrackingKey, { jobName, namespace });
    }

    let cleanupReason: 'success' | 'failure' | 'error' = 'error';

    try {
      await this.createJob(namespace, job);
      await params.onJobCreated?.({ jobName, namespace });
      const completion = await this.waitForJobCompletion(
        namespace,
        jobName,
        params.onLogChunk,
      );
      const output = completion.output;

      if (completion.succeeded) {
        cleanupReason = 'success';
        return { exitCode: 0, output, jobName, namespace };
      }

      cleanupReason = 'failure';
      const exitCode = completion.exitCode ?? 1;
      return { exitCode, output, jobName, namespace };
    } finally {
      if (jobTrackingKey) {
        this.runningJobsByRunnerId.delete(jobTrackingKey);
      }

      if (this.shouldCleanupJob(cleanupReason)) {
        await this.deleteJobBestEffort(namespace, jobName);
      }
    }
  }

  private async createJob(namespace: string, job: V1Job): Promise<void> {
    if (!this.batchApi) {
      throw new Error('Kubernetes batch API is not initialized');
    }

    try {
      await (this.batchApi as any).createNamespacedJob({
        namespace,
        body: job,
      });
    } catch (error: any) {
      if (this.isAlreadyExists(error)) {
        this.logger.warn(
          `CLI Job ${job.metadata?.name} already exists in namespace ${namespace}, continuing with existing job.`,
        );
        return;
      }

      // @kubernetes/client-node v1.x ObjectSerializer.parse throws
      // "Cannot parse content. No Content-Type defined." when the k8s API
      // returns a successful 2xx response without a Content-Type header
      // (observed with some k3s versions). The job was created — verify and
      // continue rather than surfacing a misleading parse error.
      if (
        typeof error?.message === 'string' &&
        error.message.includes('Cannot parse content')
      ) {
        const jobName = job.metadata?.name;
        const exists = jobName
          ? await this.isJobActive(jobName, namespace)
          : false;
        if (exists || jobName) {
          this.logger.warn(
            `CLI Job ${jobName} create response had no Content-Type header; ` +
              `treating as created (job active: ${exists}).`,
          );
          return;
        }
      }

      throw error;
    }
  }

  private async loadTemplate(): Promise<V1Job> {
    if (this.cachedTemplate) {
      return this.cachedTemplate;
    }

    const templatePath = process.env.K8S_CLI_JOB_TEMPLATE_PATH;
    if (!templatePath) {
      this.cachedTemplate = this.defaultTemplate();
      return this.cachedTemplate;
    }

    const raw = await fs.readFile(templatePath, 'utf8');
    const parsed = JSON.parse(raw) as V1Job;
    this.cachedTemplate = parsed;
    return parsed;
  }

  private defaultTemplate(): V1Job {
    const image = process.env.CLI_JOB_IMAGE || process.env.CLI_IMAGE;
    if (!image) {
      throw new Error(
        'Kubernetes CLI jobs require CLI_JOB_IMAGE (or CLI_IMAGE) when no job template path is provided.',
      );
    }

    const memoryLimit = process.env.K8S_CLI_JOB_MEMORY_LIMIT;
    const cpuLimit = process.env.K8S_CLI_JOB_CPU_LIMIT;
    const resources =
      memoryLimit || cpuLimit
        ? {
            limits: {
              ...(memoryLimit ? { memory: memoryLimit } : {}),
              ...(cpuLimit ? { cpu: cpuLimit } : {}),
            },
          }
        : undefined;

    return {
      apiVersion: 'batch/v1',
      kind: 'Job',
      spec: {
        backoffLimit: this.intEnv('K8S_CLI_JOB_BACKOFF_LIMIT', 1),
        ttlSecondsAfterFinished: this.intEnv('K8S_CLI_JOB_TTL_SECONDS', 1800),
        activeDeadlineSeconds: this.intEnv(
          'K8S_CLI_JOB_ACTIVE_DEADLINE_SECONDS',
          3600,
        ),
        template: {
          spec: {
            restartPolicy: 'Never',
            serviceAccountName:
              process.env.K8S_CLI_JOB_SERVICE_ACCOUNT || undefined,
            containers: [
              {
                name: 'cli',
                image,
                imagePullPolicy:
                  process.env.CLI_JOB_IMAGE_PULL_POLICY || 'IfNotPresent',
                ...(resources ? { resources } : {}),
              },
            ],
          },
        },
      },
    };
  }

  private buildJobFromTemplate(
    template: V1Job,
    params: {
      sourceId: string;
      mode: CliJobMode;
      runnerId?: string;
      recipe?: Record<string, unknown>;
      outputRestUrl?: string;
      hasSuccessfulRuns?: boolean;
      sandboxInputPath?: string;
      sandboxDetectorsPath?: string;
    },
  ): V1Job {
    const job = JSON.parse(JSON.stringify(template)) as V1Job;
    const jobAny = job as any;
    const nameSuffix = crypto
      .randomBytes(3)
      .toString('hex')
      .slice(0, 6)
      .toLowerCase();
    const runnerToken = (params.runnerId || params.sourceId).replace(
      /[^a-z0-9-]/gi,
      '',
    );
    const baseName =
      `classifyre-${params.mode}-${runnerToken.slice(0, 24)}-${nameSuffix}`.toLowerCase();
    const jobName = baseName.slice(0, 63).replace(/-+$/g, '');

    jobAny.apiVersion = 'batch/v1';
    jobAny.kind = 'Job';
    jobAny.metadata = jobAny.metadata || {};
    jobAny.metadata.name = jobName;
    jobAny.metadata.namespace = this.namespace;
    jobAny.metadata.labels = {
      ...(jobAny.metadata.labels || {}),
      'app.kubernetes.io/managed-by': 'classifyre-api',
      'app.kubernetes.io/component': 'cli-job',
      'classifyre.source-id': params.sourceId,
      ...(params.runnerId ? { 'classifyre.runner-id': params.runnerId } : {}),
    };

    jobAny.spec = jobAny.spec || {};
    jobAny.spec.template = jobAny.spec.template || {};
    jobAny.spec.template.metadata = jobAny.spec.template.metadata || {};
    jobAny.spec.template.metadata.labels = {
      ...(jobAny.spec.template.metadata.labels || {}),
      ...(jobAny.metadata.labels || {}),
    };
    jobAny.spec.template.spec = jobAny.spec.template.spec || {};
    jobAny.spec.template.spec.restartPolicy =
      jobAny.spec.template.spec.restartPolicy || 'Never';
    if (jobAny.spec.template.spec.priorityClassName === '') {
      delete jobAny.spec.template.spec.priorityClassName;
    }

    const container =
      jobAny.spec.template.spec.containers?.[0] ||
      ({
        name: 'cli',
      } as V1Container);
    if (!jobAny.spec.template.spec.containers?.length) {
      jobAny.spec.template.spec.containers = [container];
    }

    const envMap = new Map<string, V1EnvVar>();
    for (const env of container.env || []) {
      if (env?.name) {
        envMap.set(env.name, env);
      }
    }

    if (params.recipe) {
      const recipeB64 = Buffer.from(
        JSON.stringify(params.recipe, null, 2),
        'utf8',
      ).toString('base64');
      envMap.set('RECIPE_B64', { name: 'RECIPE_B64', value: recipeB64 });
    }
    envMap.set('SOURCE_ID', { name: 'SOURCE_ID', value: params.sourceId });

    if (params.runnerId) {
      envMap.set('RUNNER_ID', { name: 'RUNNER_ID', value: params.runnerId });
    }
    if (params.outputRestUrl) {
      envMap.set('CLASSIFYRE_OUTPUT_REST_URL', {
        name: 'CLASSIFYRE_OUTPUT_REST_URL',
        value: params.outputRestUrl,
      });
    }
    if (typeof params.hasSuccessfulRuns === 'boolean') {
      envMap.set('CLASSIFYRE_SOURCE_HAS_SUCCESSFUL_RUN', {
        name: 'CLASSIFYRE_SOURCE_HAS_SUCCESSFUL_RUN',
        value: params.hasSuccessfulRuns ? '1' : '0',
      });
    }
    if (params.sandboxInputPath) {
      envMap.set('SANDBOX_INPUT_PATH', {
        name: 'SANDBOX_INPUT_PATH',
        value: params.sandboxInputPath,
      });
    }
    if (params.sandboxDetectorsPath) {
      envMap.set('SANDBOX_DETECTORS_PATH', {
        name: 'SANDBOX_DETECTORS_PATH',
        value: params.sandboxDetectorsPath,
      });
    }

    const workDir = process.env.K8S_CLI_JOB_WORKDIR || '/app/apps/cli';
    envMap.set('CLASSIFYRE_CLI_AUTO_INSTALL_OPTIONAL_DEPS', {
      name: 'CLASSIFYRE_CLI_AUTO_INSTALL_OPTIONAL_DEPS',
      value: process.env.CLASSIFYRE_CLI_AUTO_INSTALL_OPTIONAL_DEPS || '1',
    });

    if (process.env.UV_CACHE_DIR) {
      this.setEnvValue(envMap, 'UV_CACHE_DIR', process.env.UV_CACHE_DIR);
    }

    container.env = Array.from(envMap.values());
    container.command = ['/bin/sh', '-lc'];
    container.args = [this.buildJobCommand(params.mode, workDir)];

    return job;
  }

  private buildJobCommand(mode: CliJobMode, workDir: string): string {
    const command =
      mode === 'extract'
        ? [
            '"$PYTHON_BIN" -m src.main extract /tmp/recipe.json',
            '--output-type rest',
            '--output-rest-url "$OUTPUT_REST_URL"',
            '--output-batch-size "$OUTPUT_BATCH_SIZE"',
            '--source-id "$SOURCE_ID"',
            '--runner-id "$RUNNER_ID"',
            '--managed-runner',
          ].join(' ')
        : mode === 'test'
          ? '"$PYTHON_BIN" -m src.main test /tmp/recipe.json'
          : '"$PYTHON_BIN" -m src.main sandbox "$SANDBOX_INPUT_PATH" --detectors-file "$SANDBOX_DETECTORS_PATH"';

    const prelude = ['set -eu'];
    if (mode !== 'sandbox') {
      prelude.push('printf "%s" "$RECIPE_B64" | base64 -d > /tmp/recipe.json');
    }
    if (mode === 'extract') {
      prelude.push('RUNNER_ID="${RUNNER_ID:-}"');
      prelude.push('SOURCE_ID="${SOURCE_ID:-}"');
      prelude.push(
        'OUTPUT_REST_URL="${CLASSIFYRE_OUTPUT_REST_URL:-http://127.0.0.1:8000}"',
      );
      prelude.push('OUTPUT_BATCH_SIZE="${CLASSIFYRE_OUTPUT_BATCH_SIZE:-20}"');
    }

    return [
      ...prelude,
      `cd ${workDir}`,
      'if [ -x ".venv/bin/python" ]; then PYTHON_BIN=".venv/bin/python"; else PYTHON_BIN="$(command -v python3 || command -v python)"; fi',
      command,
    ].join('; ');
  }

  private async waitForJobCompletion(
    namespace: string,
    jobName: string,
    onLogChunk?: CliJobLogHandler,
  ): Promise<{
    succeeded: boolean;
    exitCode?: number;
    output: string;
    failureContext?: string;
  }> {
    if (!this.batchApi) {
      throw new Error('Kubernetes batch API is not initialized');
    }

    const deadlineMs =
      Date.now() + this.intEnv('K8S_CLI_JOB_WAIT_TIMEOUT_SECONDS', 3600) * 1000;
    const pollMs = this.intEnv('K8S_CLI_JOB_POLL_INTERVAL_MS', 2000);
    let latestOutput = '';

    while (Date.now() <= deadlineMs) {
      latestOutput = await this.syncJobLogs(
        namespace,
        jobName,
        latestOutput,
        onLogChunk,
      );
      const response = await (this.batchApi as any).readNamespacedJob({
        namespace,
        name: jobName,
      });
      const job = this.unwrapBody<V1Job>(response);
      const status = job.status;
      if ((status?.succeeded || 0) > 0) {
        latestOutput = await this.syncJobLogs(
          namespace,
          jobName,
          latestOutput,
          onLogChunk,
        );
        return { succeeded: true, exitCode: 0, output: latestOutput };
      }
      if ((status?.failed || 0) > 0) {
        const pod = await this.findJobPod(namespace, jobName);
        const exitCode = this.extractExitCodeFromPod(pod);
        latestOutput = await this.syncJobLogs(
          namespace,
          jobName,
          latestOutput,
          onLogChunk,
        );
        const failureContext = await this.buildFailureContext(
          namespace,
          pod,
          exitCode,
        );
        return {
          succeeded: false,
          exitCode,
          output: latestOutput,
          failureContext,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    throw new Error(
      `Timed out waiting for CLI Job ${namespace}/${jobName} completion`,
    );
  }

  private async readJobLogs(
    namespace: string,
    jobName: string,
  ): Promise<string> {
    if (!this.coreApi) {
      throw new Error('Kubernetes core API is not initialized');
    }

    const pod = await this.findJobPod(namespace, jobName);
    if (!pod?.metadata?.name) {
      return '';
    }

    const containerName = pod.spec?.containers?.[0]?.name;
    const response = await (this.coreApi as any).readNamespacedPodLog({
      namespace,
      name: pod.metadata.name,
      container: containerName,
      timestamps: false,
    });
    const body = this.unwrapBody<string>(response);
    if (typeof body === 'string') {
      return body;
    }
    if (body && typeof (body as any).toString === 'function') {
      return (body as any).toString();
    }
    return '';
  }

  private async syncJobLogs(
    namespace: string,
    jobName: string,
    previousOutput: string,
    onLogChunk?: CliJobLogHandler,
  ): Promise<string> {
    let latestOutput = previousOutput;

    try {
      latestOutput = await this.readJobLogs(namespace, jobName);
    } catch (error: any) {
      if (!this.isLogUnavailable(error)) {
        throw error;
      }
      return previousOutput;
    }

    if (!onLogChunk || latestOutput === previousOutput) {
      return latestOutput;
    }

    const nextChunk = latestOutput.startsWith(previousOutput)
      ? latestOutput.slice(previousOutput.length)
      : latestOutput;
    if (nextChunk) {
      await onLogChunk(nextChunk);
    }

    return latestOutput;
  }

  private async findJobPod(
    namespace: string,
    jobName: string,
  ): Promise<V1Pod | undefined> {
    if (!this.coreApi) {
      return undefined;
    }

    const response = await (this.coreApi as any).listNamespacedPod({
      namespace,
      labelSelector: `job-name=${jobName}`,
    });
    const podList = this.unwrapBody<V1PodList>(response);
    const pods = [...(podList.items || [])];
    pods.sort((a, b) => {
      const aTime = a.metadata?.creationTimestamp
        ? new Date(a.metadata.creationTimestamp).getTime()
        : 0;
      const bTime = b.metadata?.creationTimestamp
        ? new Date(b.metadata.creationTimestamp).getTime()
        : 0;
      return bTime - aTime;
    });
    return pods[0];
  }

  private extractExitCodeFromPod(pod?: V1Pod): number | undefined {
    const statuses = pod?.status?.containerStatuses || [];
    for (const status of statuses) {
      const exitCode = status.state?.terminated?.exitCode;
      if (typeof exitCode === 'number') {
        return exitCode;
      }
    }
    return undefined;
  }

  private extractTerminationReason(pod?: V1Pod): string | undefined {
    const statuses = pod?.status?.containerStatuses || [];
    for (const status of statuses) {
      const reason =
        status.state?.terminated?.reason ||
        status.lastState?.terminated?.reason;
      if (reason) {
        return reason;
      }
    }
    return undefined;
  }

  private async fetchPodWarningEvents(
    namespace: string,
    podName: string,
  ): Promise<string> {
    if (!this.coreApi) {
      return '';
    }
    try {
      const response = await (this.coreApi as any).listNamespacedEvent({
        namespace,
        fieldSelector: `involvedObject.name=${podName},type=Warning`,
      });
      const eventList = this.unwrapBody<any>(response);
      const items: any[] = eventList?.items || [];
      if (items.length === 0) {
        return '';
      }
      return items
        .map((e: any) =>
          `  [${e.reason ?? 'Unknown'}] ${e.message ?? ''}`.trimEnd(),
        )
        .join('\n');
    } catch {
      return '';
    }
  }

  private async buildFailureContext(
    namespace: string,
    pod: V1Pod | undefined,
    exitCode: number | undefined,
  ): Promise<string> {
    const lines: string[] = [];

    const reason = this.extractTerminationReason(pod);
    if (reason) {
      lines.push(`Termination reason: ${reason}`);
    }

    if (pod?.metadata?.name) {
      const events = await this.fetchPodWarningEvents(
        namespace,
        pod.metadata.name,
      );
      if (events) {
        lines.push(`Kubernetes warning events:\n${events}`);
      }
    }

    if (lines.length === 0 && exitCode !== undefined) {
      lines.push(`Pod exited with code ${exitCode}`);
    }

    return lines.join('\n\n');
  }

  private intEnv(name: string, defaultValue: number): number {
    const raw = process.env[name];
    if (!raw) {
      return defaultValue;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? defaultValue : parsed;
  }

  private resolveCleanupPolicy(): JobCleanupPolicy {
    const raw = (
      process.env.K8S_CLI_JOB_CLEANUP_POLICY ||
      process.env.CLASSIFYRE_K8S_CLI_JOB_CLEANUP_POLICY ||
      'always'
    )
      .trim()
      .toLowerCase();

    if (raw === 'none' || raw === 'failed' || raw === 'always') {
      return raw;
    }

    this.logger.warn(
      `Unknown K8S_CLI_JOB_CLEANUP_POLICY="${raw}", falling back to "always".`,
    );
    return 'always';
  }

  private shouldCleanupJob(reason: 'success' | 'failure' | 'error'): boolean {
    switch (this.cleanupPolicy) {
      case 'always':
        return true;
      case 'failed':
        return reason !== 'success';
      case 'none':
      default:
        return false;
    }
  }

  private async deleteJobBestEffort(
    namespace: string,
    jobName: string,
  ): Promise<void> {
    if (!this.batchApi) {
      return;
    }

    try {
      await (this.batchApi as any).deleteNamespacedJob({
        name: jobName,
        namespace,
        propagationPolicy: 'Background',
      });
    } catch (error: any) {
      if (this.isNotFound(error)) {
        return;
      }
      this.logger.warn(
        `Failed to clean up CLI Job ${namespace}/${jobName}: ${error?.message || error}`,
      );
    }
  }

  private setEnvValue(
    envMap: Map<string, V1EnvVar>,
    name: string,
    value?: string,
  ): void {
    if (!value) {
      return;
    }
    envMap.set(name, { name, value });
  }

  private unwrapBody<T>(response: any): T {
    if (response?.body !== undefined) {
      return response.body as T;
    }
    if (response?.response?.body !== undefined) {
      return response.response.body as T;
    }
    return response as T;
  }

  private isAlreadyExists(error: any): boolean {
    const status =
      error?.response?.statusCode || error?.statusCode || error?.status;
    if (status === 409) {
      return true;
    }
    const reason = error?.body?.reason || error?.response?.body?.reason;
    return reason === 'AlreadyExists';
  }

  private isNotFound(error: any): boolean {
    const status =
      error?.response?.statusCode || error?.statusCode || error?.status;
    if (status === 404) {
      return true;
    }
    const reason = error?.body?.reason || error?.response?.body?.reason;
    return reason === 'NotFound';
  }

  private isLogUnavailable(error: any): boolean {
    const status =
      error?.response?.statusCode || error?.statusCode || error?.status;
    const message =
      error?.body?.message ||
      error?.response?.body?.message ||
      error?.message ||
      '';
    if (status === 404) {
      return true;
    }
    if (status === 400) {
      return (
        typeof message === 'string' &&
        /waiting to start|PodInitializing|ContainerCreating|container .+ is not available/i.test(
          message,
        )
      );
    }
    if (typeof message === 'string') {
      return /waiting to start|PodInitializing|ContainerCreating|container .+ is not available/i.test(
        message,
      );
    }
    return false;
  }

  private async ensureKubernetesClients(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    if (this.batchApi && this.coreApi) {
      return;
    }

    const k8sModule =
      this.k8sModule || (await import('@kubernetes/client-node'));
    this.k8sModule = k8sModule;

    const kubeConfig = new k8sModule.KubeConfig();
    if (process.env.KUBECONFIG || process.env.K8S_KUBECONFIG) {
      kubeConfig.loadFromFile(
        process.env.KUBECONFIG || process.env.K8S_KUBECONFIG!,
      );
    } else {
      kubeConfig.loadFromCluster();
    }

    this.kc = kubeConfig;
    this.batchApi = kubeConfig.makeApiClient(k8sModule.BatchV1Api);
    this.coreApi = kubeConfig.makeApiClient(k8sModule.CoreV1Api);
  }
}
