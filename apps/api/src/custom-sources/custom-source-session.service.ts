import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { connect, createServer } from 'net';
import { ClsService } from 'nestjs-cls';
import {
  CLS_DATABASE_LANE,
  CLS_NAMESPACE_ID,
  CLS_SCHEMA,
  CLS_SLUG,
} from '../namespace/namespace.constants';
import { PrismaService } from '../prisma.service';
import { MaskedConfigCryptoService } from '../masked-config-crypto.service';
import { CliRunnerService } from '../cli-runner/cli-runner.service';
import { KubernetesCliJobService } from '../cli-runner/kubernetes-cli-job.service';
import { CustomSourceNotebookService } from './custom-source-notebook.service';

export const SESSION_STATUS = {
  starting: 'STARTING',
  ready: 'READY',
  failed: 'FAILED',
  stopped: 'STOPPED',
} as const;

/** How long a session may sit without a proxied request before it is reaped. */
const IDLE_TIMEOUT_SECONDS = Number(
  process.env.CLASSIFYRE_NOTEBOOK_IDLE_TIMEOUT_SECONDS || 30 * 60,
);

export interface SessionView {
  id: string;
  status: string;
  /** Browser-facing path the editor is served under. Never the pod endpoint. */
  path: string;
  error?: string;
  startedAt: Date;
}

/**
 * Lifecycle of the interactive notebook editor.
 *
 * A session is a running marimo server plus the row that lets the API find it
 * again: a Kubernetes Job reached by pod IP, or a local child process on
 * loopback. Both are addressed the same way from the browser, which is what
 * keeps the web component free of runtime branching.
 *
 * Sessions hold real resources, so nothing here assumes a user will press Stop.
 * A reaper ends idle ones, and startup reconciles rows left behind by an API
 * restart.
 */
@Injectable()
export class CustomSourceSessionService {
  private readonly logger = new Logger(CustomSourceSessionService.name);

  /**
   * Proxy targets, cached in process.
   *
   * The websocket upgrade path cannot await a database read - @fastify/http-proxy
   * resolves its upstream synchronously - so the target has to be in memory by
   * the time the socket opens. It always is: the browser loads the editor over
   * HTTP first, and that path (which *can* await) warms this map. The database
   * row remains the durable record; this is only the fast lookup.
   */
  private readonly targets = new Map<
    string,
    { endpoint: string; token: string }
  >();

  constructor(
    private readonly cls: ClsService,
    private readonly prisma: PrismaService,
    private readonly maskedConfigCrypto: MaskedConfigCryptoService,
    private readonly notebooks: CustomSourceNotebookService,
    private readonly cliRunner: CliRunnerService,
    private readonly kubernetesJobs: KubernetesCliJobService,
  ) {}

  // No onModuleInit and no background timer here, deliberately.
  //
  // `PrismaService` is a CLS-scoped proxy: every tenant read must happen inside
  // a resolved namespace, and bootstrap and `setInterval` callbacks have none.
  // Touching it from either throws "PrismaService accessed outside a namespace
  // context" - which is the guard doing its job, not a bug to work around.
  //
  // Nothing is lost by dropping them, because a session already expires without
  // the API's help:
  //   * the CLI session process exits on its own --idle-timeout;
  //   * its Kubernetes Job carries activeDeadlineSeconds and
  //     ttlSecondsAfterFinished, so the pod is collected after it ends;
  //   * a stale row is recognised on read (see `isStale`) inside a request,
  //     where a namespace *is* resolved.

  // ── public API ───────────────────────────────────────────────────────

  static browserPath(sourceId: string, sessionId: string): string {
    return `/custom-sources/${sourceId}/session/${sessionId}/app`;
  }

  private static targetKey(sourceId: string, sessionId: string): string {
    return `${sourceId}:${sessionId}`;
  }

  /**
   * The synchronous lookup the websocket upgrade uses. Returns undefined until
   * an HTTP request for the same session has warmed the cache.
   */
  cachedTarget(
    sourceId: string,
    sessionId: string,
  ): { endpoint: string; token: string } | undefined {
    return this.targets.get(
      CustomSourceSessionService.targetKey(sourceId, sessionId),
    );
  }

  /**
   * Whether a row that still claims to be live has actually been abandoned.
   *
   * `lastSeenAt` is bumped by every proxied request, and the session process
   * ends itself after the same idle period, so a row older than that is
   * describing something that is no longer running - typically an API restart
   * that took its local child process with it.
   */
  private static isStale(session: { lastSeenAt: Date | null }): boolean {
    const lastSeen = session.lastSeenAt?.getTime() ?? 0;
    return Date.now() - lastSeen > IDLE_TIMEOUT_SECONDS * 1000;
  }

  async get(sourceId: string): Promise<SessionView | null> {
    const session = await this.prisma.customSourceSession.findUnique({
      where: { sourceId },
    });
    if (!session || session.status === SESSION_STATUS.stopped) {
      return null;
    }
    if (CustomSourceSessionService.isStale(session)) {
      // Reap here rather than on a timer: this is the one place we are
      // guaranteed to be inside a namespace context.
      this.logger.log(
        `Notebook session for source ${sourceId} went idle; cleaning it up`,
      );
      await this.stop(sourceId).catch((error) =>
        this.logger.warn(`Could not clean up stale session: ${error}`),
      );
      return null;
    }
    return {
      id: session.id,
      status: session.status,
      path: CustomSourceSessionService.browserPath(sourceId, session.id),
      error: session.errorMessage ?? undefined,
      startedAt: session.createdAt,
    };
  }

  /**
   * Start a session, or return the one already running.
   *
   * Idempotent on purpose: opening the editor in a second tab should attach to
   * the running server, not race a second pod into existence.
   */
  async start(sourceId: string): Promise<SessionView> {
    await this.notebooks.assertCustomSource(sourceId);

    const existing = await this.get(sourceId);
    if (existing && existing.status !== SESSION_STATUS.failed) {
      return existing;
    }

    await this.stop(sourceId).catch(() => undefined);

    const sessionId = randomUUID();
    const token = randomBytes(24).toString('hex');
    const path = CustomSourceSessionService.browserPath(sourceId, sessionId);

    await this.prisma.customSourceSession.upsert({
      where: { sourceId },
      create: {
        id: sessionId,
        sourceId,
        token,
        status: SESSION_STATUS.starting,
        lastSeenAt: new Date(),
      },
      update: {
        id: sessionId,
        token,
        status: SESSION_STATUS.starting,
        endpoint: null,
        jobName: null,
        processId: null,
        errorMessage: null,
        lastSeenAt: new Date(),
      },
    });

    // Launch in the background: building a sandbox venv takes minutes, and the
    // UI needs to render a "starting" state rather than hold a request open.
    //
    // The tenant is captured here and re-entered inside `launch`, rather than
    // relying on the request's context outliving the request. This work
    // continues long after the response is sent, and every database write it
    // makes still has to land in this namespace's schema.
    const tenant = {
      schema: this.cls.get<string>(CLS_SCHEMA),
      namespaceId: this.cls.get<string>(CLS_NAMESPACE_ID),
      slug: this.cls.get<string>(CLS_SLUG),
    };
    void this.runInTenant(tenant, () =>
      this.launch(sourceId, sessionId, token, path),
    ).catch((error) =>
      this.logger.error(`Notebook session ${sessionId} failed: ${error}`),
    );

    return {
      id: sessionId,
      status: SESSION_STATUS.starting,
      path,
      startedAt: new Date(),
    };
  }

  async stop(sourceId: string): Promise<void> {
    const session = await this.prisma.customSourceSession.findUnique({
      where: { sourceId },
    });
    if (!session) return;

    await this.terminate(session);
    this.targets.delete(
      CustomSourceSessionService.targetKey(sourceId, session.id),
    );
    await this.prisma.customSourceSession.update({
      where: { sourceId },
      data: { status: SESSION_STATUS.stopped, endpoint: null },
    });
  }

  /**
   * Resolve a proxy target, and record that the session is still in use.
   *
   * The token is returned so the proxy can present it to marimo; it never
   * reaches the browser.
   */
  async resolveTarget(
    sourceId: string,
    sessionId: string,
  ): Promise<{ endpoint: string; token: string }> {
    const session = await this.prisma.customSourceSession.findUnique({
      where: { sourceId },
    });

    if (!session || session.id !== sessionId) {
      throw new NotFoundException(
        'That notebook session is no longer running.',
      );
    }
    if (session.status !== SESSION_STATUS.ready || !session.endpoint) {
      throw new BadRequestException(
        session.errorMessage || 'The notebook session is still starting.',
      );
    }

    // Fire-and-forget: a proxied request should not wait on a write, and losing
    // one heartbeat only risks reaping a session a minute early.
    void this.prisma.customSourceSession
      .update({ where: { sourceId }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);

    const target = { endpoint: session.endpoint, token: session.token };
    this.targets.set(
      CustomSourceSessionService.targetKey(sourceId, sessionId),
      target,
    );
    return target;
  }

  // ── internals ────────────────────────────────────────────────────────

  /**
   * Run detached work inside a specific namespace.
   *
   * Mirrors NamespaceWorkerManager.runInNamespace. The 'background' lane keeps
   * a long session launch off the pool the request path uses.
   */
  private runInTenant<T>(
    tenant: { schema?: string; namespaceId?: string; slug?: string },
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.cls.run(() => {
      if (tenant.schema) this.cls.set(CLS_SCHEMA, tenant.schema);
      if (tenant.namespaceId)
        this.cls.set(CLS_NAMESPACE_ID, tenant.namespaceId);
      if (tenant.slug) this.cls.set(CLS_SLUG, tenant.slug);
      this.cls.set(CLS_DATABASE_LANE, 'background');
      return fn();
    });
  }

  private isKubernetes(): boolean {
    return (
      (process.env.ENVIRONMENT || '').toLowerCase() === 'kubernetes' &&
      this.kubernetesJobs.isEnabled()
    );
  }

  private async launch(
    sourceId: string,
    sessionId: string,
    token: string,
    basePath: string,
  ): Promise<void> {
    try {
      const source = await this.prisma.source.findUniqueOrThrow({
        where: { id: sourceId },
        select: { config: true },
      });
      const config = this.maskedConfigCrypto.decryptMaskedConfig(
        (source.config ?? {}) as Record<string, unknown>,
      );

      if (this.isKubernetes()) {
        const handle = await this.kubernetesJobs.runInteractiveJob({
          sourceId,
          sessionId,
          recipe: config,
          outputRestUrl: this.cliRunner.notebookCallbackUrl(),
          notebookToken: token,
          baseUrl: basePath,
          idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
        });
        await this.markReady(sourceId, sessionId, handle.endpoint, {
          jobName: handle.jobName,
          jobNamespace: handle.namespace,
        });
        return;
      }

      const port = await findFreePort();
      const local = await this.cliRunner.startLocalNotebookSession({
        sourceId,
        config,
        port,
        baseUrl: basePath,
        token,
        idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
      });
      await waitForPort(port);
      await this.markReady(sourceId, sessionId, local.endpoint, {
        processId: local.pid,
      });
    } catch (error: any) {
      await this.prisma.customSourceSession
        .updateMany({
          where: { sourceId, id: sessionId },
          data: {
            status: SESSION_STATUS.failed,
            errorMessage: String(error?.message || error),
          },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  private async markReady(
    sourceId: string,
    sessionId: string,
    endpoint: string,
    extra: Record<string, unknown>,
  ): Promise<void> {
    // updateMany with the id in the filter: if the user restarted the session
    // while this one was booting, the newer row must win.
    const { count } = await this.prisma.customSourceSession.updateMany({
      where: { sourceId, id: sessionId },
      data: {
        status: SESSION_STATUS.ready,
        endpoint,
        lastSeenAt: new Date(),
        ...extra,
      },
    });
    if (count === 0) {
      this.logger.warn(
        `Notebook session ${sessionId} was superseded while starting; stopping it`,
      );
      await this.terminate({ ...extra, endpoint } as never);
    }
  }

  private async terminate(session: {
    jobName?: string | null;
    jobNamespace?: string | null;
    processId?: number | null;
  }): Promise<void> {
    try {
      if (session.jobName) {
        await this.kubernetesJobs.stopInteractiveJob(
          session.jobName,
          session.jobNamespace ?? undefined,
        );
      } else if (session.processId) {
        this.cliRunner.stopLocalNotebookSession(session.processId);
      }
    } catch (error) {
      this.logger.warn(`Could not stop a notebook session cleanly: ${error}`);
    }
  }
}

/** Ask the OS for an unused loopback port. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate a port')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

/** Wait until something is listening, so the proxy never fires too early. */
export async function waitForPort(
  port: number,
  timeoutMs = 300_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const probe = connect({ port, host: '127.0.0.1' });
      probe.on('connect', () => {
        probe.destroy();
        resolve(true);
      });
      probe.on('error', () => resolve(false));
    });
    if (open) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `The notebook editor did not start listening within ${Math.round(timeoutMs / 1000)}s.`,
  );
}
