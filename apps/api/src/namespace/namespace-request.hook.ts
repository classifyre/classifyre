import { Logger } from '@nestjs/common';
import type { FastifyInstance } from 'fastify';
import type { IncomingMessage } from 'node:http';
import type { ClsService } from 'nestjs-cls';
import { NamespaceRegistryService } from '../registry/namespace-registry.service';
import {
  RESERVED_PREFIXES,
  SLUG_RE,
  CLS_SCHEMA,
  CLS_NAMESPACE_ID,
  CLS_SLUG,
  type NamespaceContext,
} from './namespace.constants';
import { PrismaClientManager } from '../prisma/prisma-client-manager';

/**
 * Fastify raw request augmented by the namespace pipeline.
 * `classifyreSlug` is stashed pre-routing by {@link namespaceRewriteUrl};
 * `classifyreNs` is filled post-routing by the onRequest hook.
 */
export interface NamespaceRawRequest extends IncomingMessage {
  classifyreSlug?: string;
  classifyreNs?: NamespaceContext;
  classifyrePrismaPinned?: boolean;
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

    cls.set(CLS_SCHEMA, ns.schemaName);
    cls.set(CLS_NAMESPACE_ID, ns.namespaceId);
    cls.set(CLS_SLUG, ns.slug);
    // Also expose on the request for the raw MCP handler (not a Nest route).
    raw.classifyreNs = ns;
    (request as unknown as { classifyreNs?: NamespaceContext }).classifyreNs =
      ns;
    // Protect the tenant client from LRU eviction until this request has
    // completely finished (important on API-only pods with many tenants).
    prismaManager.pin(ns.schemaName);
    raw.classifyrePrismaPinned = true;
  });

  fastify.addHook('onResponse', (request) => {
    releasePrismaPin(request.raw, prismaManager);
  });
  fastify.addHook('onRequestAbort', (request) => {
    releasePrismaPin(request.raw, prismaManager);
  });
}

function releasePrismaPin(
  raw: NamespaceRawRequest,
  prismaManager: PrismaClientManager,
): void {
  if (!raw.classifyrePrismaPinned || !raw.classifyreNs) return;
  raw.classifyrePrismaPinned = false;
  prismaManager.unpin(raw.classifyreNs.schemaName);
}
