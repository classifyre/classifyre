import { Logger } from '@nestjs/common';
import type { FastifyInstance } from 'fastify';
import type { IncomingMessage } from 'node:http';
import type { ClsService } from 'nestjs-cls';
import { NamespaceRegistryService } from '../registry/namespace-registry.service';
import {
  CLS_DATABASE_LANE,
  RESERVED_PREFIXES,
  SLUG_RE,
  CLS_SCHEMA,
  CLS_NAMESPACE_ID,
  CLS_SLUG,
  type NamespaceContext,
  type DatabaseLane,
} from './namespace.constants';
import { PrismaClientManager } from '../prisma/prisma-client-manager';
import { transientDbErrorCode } from '../db/transient-db-error';
import { InternalApiKeyService } from '../internal-api-key.service';
import type { IdentityService } from '../identity/identity.service';
import { CLS_ACTOR } from '../identity/actor-context.service';
import {
  CLS_CAPABILITIES,
  CLS_RESOURCE_GRANTS,
} from '../identity/iam-access-policy';
import { RESOURCE_GRANTABLE_CAPABILITIES } from '../identity/access-policy';
import { resourceGrantsInWorkspace } from '../identity/grant-evaluation';
import {
  assertSameOrigin,
  authenticateOr,
} from '../identity/signed-in-request';

/**
 * Fastify raw request augmented by the namespace pipeline.
 * `classifyreSlug` is stashed pre-routing by {@link namespaceRewriteUrl};
 * `classifyreNs` is filled post-routing by the onRequest hook.
 */
export interface NamespaceRawRequest extends IncomingMessage {
  classifyreSlug?: string;
  classifyreNs?: NamespaceContext;
  classifyrePrismaPinned?: boolean;
  /** Lane this request was pinned on; re-applied by handlers that open their
   * own CLS context (the raw MCP handler) so they use the pool that is warm. */
  classifyreDatabaseLane?: DatabaseLane;
}

/**
 * Pre-routing URL rewrite (Fastify server option). Runs BEFORE route matching,
 * which is the only place we can strip the leading `/<slug>` so the existing
 * (namespace-blind) controller routes still match `/sources`, `/mcp`, etc.
 *
 * Purely syntactic: it never touches the database. It stashes the raw slug on
 * the request for the async onRequest hook to validate/resolve. Reserved first
 * segments (health, `api`, `namespaces`, …) pass through untouched.
 */
export function namespaceRewriteUrl(req: IncomingMessage): string {
  const original = req.url ?? '/';
  const qIndex = original.indexOf('?');
  const pathPart = qIndex === -1 ? original : original.slice(0, qIndex);
  const query = qIndex === -1 ? '' : original.slice(qIndex);

  const segments = pathPart.split('/'); // ['', '<first>', ...rest]
  const first = segments[1] ?? '';
  if (RESERVED_PREFIXES.has(first)) {
    return original;
  }

  (req as NamespaceRawRequest).classifyreSlug = first;
  const rest = segments.slice(2).join('/');
  return `/${rest}${query}`;
}

/**
 * Registers the async onRequest hook that resolves the stashed slug against the
 * registry and decorates the request with its {@link NamespaceContext}. Unknown
 * or malformed slugs get a 404 before any controller runs.
 *
 * Must be called on the raw Fastify instance after the Nest app is created (so
 * `NamespaceRegistryService` can be resolved from DI).
 */
export function registerNamespaceHook(
  fastify: FastifyInstance,
  registry: NamespaceRegistryService,
  cls: ClsService,
  prismaManager: PrismaClientManager,
  internalApiKey: InternalApiKeyService,
  identity: IdentityService,
): void {
  const logger = new Logger('NamespaceHook');

  fastify.addHook('onRequest', async (request, reply) => {
    // Enter a CLS context bound to this request's async execution. `enterWith`
    // (rather than nestjs-cls's mounted middleware, which runs before this hook
    // resolves the namespace) is the reliable way to populate the store on
    // Fastify: the entered context propagates into the route handler. Every
    // request gets a context so `cls.get()` never throws; only namespaced
    // requests get a schema.
    cls.enter();

    const raw = request.raw as NamespaceRawRequest;
    const slug = raw.classifyreSlug;
    if (!slug) {
      // Reserved route (health, swagger, registry CRUD): no namespace context.
      return;
    }

    if (!SLUG_RE.test(slug)) {
      await reply
        .code(404)
        .send({ error: 'Not Found', message: `Unknown namespace '${slug}'` });
      return;
    }

    let ns: NamespaceContext | null = null;
    try {
      ns = await registry.resolve(slug);
    } catch (error) {
      // This hook runs before Nest, so `PrismaExceptionFilter` never sees the
      // failure — classify it here or a database blip in the registry turns
      // every request on the page into an unretryable 500.
      const transientCode = transientDbErrorCode(error);
      if (transientCode) {
        logger.warn(
          `Registry temporarily unavailable resolving '${slug}' [${transientCode}]: ${String(error)}`,
        );
        await reply.code(503).header('Retry-After', '5').send({
          statusCode: 503,
          error: 'Service Unavailable',
          message:
            'Database is temporarily unavailable — please retry in a moment.',
          code: transientCode,
        });
        return;
      }
      logger.error(`Failed to resolve namespace '${slug}': ${String(error)}`);
      await reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to resolve namespace.',
      });
      return;
    }

    if (!ns) {
      await reply
        .code(404)
        .send({ error: 'Not Found', message: `Unknown namespace '${slug}'` });
      return;
    }

    if (
      !(await authorizeWorkspaceRequest(
        identity,
        cls,
        request,
        reply,
        ns,
        internalApiKey,
      ))
    ) {
      return;
    }

    cls.set(CLS_SCHEMA, ns.schemaName);
    cls.set(CLS_NAMESPACE_ID, ns.namespaceId);
    cls.set(CLS_SLUG, ns.slug);
    const databaseLane = databaseLaneForRequest(
      request.headers,
      internalApiKey,
    );
    cls.set(CLS_DATABASE_LANE, databaseLane);
    // Also expose on the request for the raw MCP handler (not a Nest route).
    raw.classifyreNs = ns;
    raw.classifyreDatabaseLane = databaseLane;
    (request as unknown as { classifyreNs?: NamespaceContext }).classifyreNs =
      ns;
    // Protect the tenant client from LRU eviction until this request has
    // completely finished (important on API-only pods with many tenants).
    prismaManager.pin(ns.schemaName, databaseLane);
    raw.classifyrePrismaPinned = true;
  });

  fastify.addHook('onResponse', (request) => {
    releasePrismaPin(request.raw, prismaManager);
  });
  fastify.addHook('onRequestAbort', (request) => {
    releasePrismaPin(request.raw, prismaManager);
  });
}

/**
 * With sign-in on, a workspace request needs a signed-in principal of the
 * workspace's tenant who can see it (docs/prd §8.1). Another tenant's
 * workspace and an invisible one both answer 404, exactly like a workspace
 * that does not exist. Leaves the principal's actor and capabilities in CLS
 * for the access guard. Scan callbacks (internal key) and MCP (its own
 * tokens) are not signed-in requests and pass through.
 */
async function authorizeWorkspaceRequest(
  identity: IdentityService,
  cls: ClsService,
  request: {
    raw: IncomingMessage;
    url: string;
    method: string;
    headers: Record<string, unknown>;
  },
  reply: { code(code: number): { send(body: unknown): unknown } },
  ns: NamespaceContext,
  internalApiKey: InternalApiKeyService,
): Promise<boolean> {
  if (internalApiKey.isInternalRequest(request.headers)) return true;
  if (request.url.split('?')[0] === '/mcp') return true;
  // A query job posting its result: it holds no key and no sign-in, only the
  // run's own token, which the route checks (data-query/query-run-token.ts).
  if (isQueryRunCallback(request)) return true;

  const principal = await authenticateOr(
    () => identity.authenticate(request.raw),
    {
      unauthorized: (body) => reply.code(401).send(body),
      unavailable: (body) => reply.code(503).send(body),
    },
  );
  if (!principal) return false;

  try {
    assertSameOrigin(
      principal,
      {
        method: request.method,
        headers: request.headers,
      },
      identity.config.appOrigin,
    );
  } catch {
    await reply.code(403).send({
      statusCode: 403,
      error: 'Forbidden',
      code: 'CROSS_ORIGIN',
      message: 'Changes are only accepted from the Classifyre app.',
    });
    return false;
  }

  const capabilities = await identity.capabilitiesIn(principal, ns.namespaceId);
  if (!capabilities?.has('workspace.view')) {
    await reply
      .code(404)
      .send({ error: 'Not Found', message: `Unknown namespace '${ns.slug}'` });
    return false;
  }
  cls.set(CLS_ACTOR, principal.actor);
  cls.set(CLS_CAPABILITIES, capabilities);
  cls.set(
    CLS_RESOURCE_GRANTS,
    Object.fromEntries(
      RESOURCE_GRANTABLE_CAPABILITIES.map((capability) => [
        capability,
        resourceGrantsInWorkspace(principal.grants, ns.namespaceId, capability),
      ]),
    ),
  );
  return true;
}

const QUERY_RUN_CALLBACK_RE = /^\/query-runs\/[0-9a-f-]{36}\/result$/i;

/** The one unauthenticated workspace route: a query job's result callback. */
export function isQueryRunCallback(request: {
  url: string;
  method: string;
  headers: Record<string, unknown>;
}): boolean {
  return (
    request.method === 'POST' &&
    QUERY_RUN_CALLBACK_RE.test(request.url.split('?')[0]) &&
    typeof request.headers['x-query-run-token'] === 'string'
  );
}

/**
 * CLI callbacks carry the per-install/per-deployment internal key and are
 * background workload. Public/browser requests never carry that key and stay
 * on the interactive pool reserved for UI latency.
 *
 * When no key is configured (`bun dev`, tests — never the all-in-one image or
 * the Helm chart, both of which always generate one) internal traffic is
 * indistinguishable from browser traffic and lands on the interactive lane.
 * In-process workers still set their lane directly, so the protection that
 * matters under load survives; only HTTP CLI callbacks lose it.
 */
export function databaseLaneForRequest(
  headers: Record<string, unknown> | undefined,
  internalApiKey: Pick<InternalApiKeyService, 'isInternalRequest'>,
): DatabaseLane {
  return internalApiKey.isInternalRequest(headers)
    ? 'background'
    : 'interactive';
}

function releasePrismaPin(
  raw: NamespaceRawRequest,
  prismaManager: PrismaClientManager,
): void {
  if (!raw.classifyrePrismaPinned || !raw.classifyreNs) return;
  raw.classifyrePrismaPinned = false;
  prismaManager.unpin(raw.classifyreNs.schemaName);
}
