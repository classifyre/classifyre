/**
 * Namespace (tenant) identity primitives shared across the request pipeline,
 * the registry, and the worker manager.
 *
 * A namespace is addressed in URLs by either its immutable **UUID** (used by
 * all internal service-to-service calls, e.g. the managed CLI posting findings
 * to `/<uuid>/runners/...`) or a human, editable **slug** (used by the web app,
 * e.g. `/acme-corp/sources`). Both resolve to the same tenant.
 *
 * Tenant data lives in a Postgres schema derived from the immutable UUID
 * (`ns_<uuid>`), and pg-boss jobs in `pgboss_<uuid>`. Deriving from the UUID
 * (not the slug) keeps the slug freely editable without touching any schema.
 */

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

/**
 * Normalize a namespace UUID into a bare SQL identifier fragment: dashes are
 * not legal in an unquoted identifier, so strip them (a UUID is already
 * lowercase hex, safe as an identifier body).
 */
function idToken(id: string): string {
  return id.replace(/-/g, '');
}

/** Postgres schema that holds a namespace's application data (`ns_<uuid>`). */
export function schemaForId(id: string): string {
  return `ns_${idToken(id)}`;
}

/**
 * Postgres schema that holds a namespace's pg-boss job tables (`pgboss_<uuid>`).
 * `pgboss_` + 32 hex chars = 39 chars, always within pg-boss's 50-char limit,
 * and collision-free by construction — no truncation/hashing needed.
 */
export function pgBossSchemaForId(id: string): string {
  return `pgboss_${idToken(id)}`;
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
