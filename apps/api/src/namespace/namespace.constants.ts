/**
 * Namespace (tenant) identity primitives shared across the request pipeline,
 * the registry, and the worker manager.
 *
 * A namespace is identified in every URL by a human **slug** (e.g. `acme-corp`
 * in `/acme-corp/sources` or `/acme-corp/mcp`). Its data lives in a dedicated
 * Postgres schema `ns_<slug>` (dashes → underscores, since dashes are not legal
 * in a bare SQL identifier), while pg-boss jobs live in `pgboss_<slug>`.
 */
import { createHash } from 'node:crypto';

/**
 * First path segments that are NEVER a namespace slug and must pass through the
 * `rewriteUrl` strip + `onRequest` resolver untouched.
 *
 * Keep this in sync with:
 *  - `SwaggerModule.setup('api', …)` in `main.ts` (the `api` prefix),
 *  - the health route (`/ping`, `/health`),
 *  - the registry controller (`@Controller('namespaces')`).
 */
export const RESERVED_PREFIXES = new Set<string>([
  '', // bare `/`
  'api', // Swagger UI + `/api/health/pressure` + `/api/mcp`
  'api-json', // Swagger's generated OpenAPI JSON document
  'api-yaml', // Swagger's generated OpenAPI YAML document
  'ping', // health probe
  'health', // health endpoints
  'namespaces', // namespace registry CRUD
  'socket.io', // Socket.IO transport handshake path
  'favicon.ico',
]);

/**
 * A valid slug: lowercase alphanumerics and single dashes, 1–50 chars, no
 * leading/trailing dash. Mirrors the desktop slugify rules so the same names
 * work in both deployments.
 */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

/** Postgres schema that holds a namespace's application data. */
export function schemaForSlug(slug: string): string {
  return `ns_${slug.replace(/-/g, '_')}`;
}

/** Postgres schema that holds a namespace's pg-boss job tables. */
export function pgBossSchemaForSlug(slug: string): string {
  const normalized = slug.replace(/[^a-z0-9_]/g, '_');
  const candidate = `pgboss_${normalized}`;
  if (candidate.length <= 50) return candidate;

  // pg-boss limits schema identifiers to 50 characters. Plain truncation
  // aliases distinct long slugs onto the same job schema, which lets one
  // tenant consume another tenant's jobs. Keep a stable 64-bit digest suffix
  // so the shortened identifier remains effectively collision-free.
  const suffix = createHash('sha256').update(slug).digest('hex').slice(0, 16);
  return `pgboss_${normalized.slice(0, 26)}_${suffix}`;
}

/**
 * Derive a URL-safe slug from a human name (best-effort; callers should still
 * validate with {@link SLUG_RE} and resolve collisions).
 */
export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
}

/** Shape stored in CLS and decorated onto the Fastify request. */
export interface NamespaceContext {
  namespaceId: string;
  slug: string;
  schemaName: string;
}

/** CLS store keys. */
export const CLS_SCHEMA = 'schemaName';
export const CLS_NAMESPACE_ID = 'namespaceId';
export const CLS_SLUG = 'slug';
