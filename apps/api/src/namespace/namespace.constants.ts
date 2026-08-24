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
 * `rewriteUrl` strip + `onRequest` resolver untouched. Doubles as the set of
 * slugs the registry refuses to create, so a workspace can never be given a
 * name that its own URL cannot address.
 *
 * Keep this in sync with:
 *  - `SwaggerModule.setup('docs', …)` in `main.ts` (`docs`, `docs-json`,
 *    `docs-yaml`),
 *  - the health route (`/ping`, `/health`),
 *  - the registry controller (`@Controller('namespaces')`),
 *  - every top-level route of the web app (`apps/web/app/*`) and the matching
 *    `RESERVED_ROUTE_PREFIXES` in `packages/api-client/src/client.ts` — a slug
 *    that collides with one of those is shadowed by the static route and the
 *    workspace becomes unreachable in the UI.
 */
export const RESERVED_PREFIXES = new Set<string>([
  '', // bare `/`
  'api', // `/api/health/pressure` + `/api/mcp`
  'ping', // health probe
  'health', // health endpoints
  'namespaces', // namespace registry CRUD
  'socket.io', // Socket.IO transport handshake path
  'favicon.ico',
  // Swagger UI and its generated OpenAPI documents. Mounted at `/docs` rather
  // than `/api` because the ingress strips the `/api` prefix before the request
  // reaches this process — see `SwaggerModule.setup` in `main.ts`. On the API
  // this is `/docs`; from a browser it is `<host>/api/docs`.
  'docs-json',
  'docs-yaml',
  // Web app top-level routes (apps/web/app/*). `docs` is shared: the web serves
  // the bundled documentation site there, the API serves Swagger UI.
  'docs',
  'remote', // desktop's embedded remote-workspace browser
  'classifyre-usr', // analytics proxy route
  '_next', // Next.js build assets
]);

/**
 * Slugs the registry must also refuse, but which are NOT API routes and so must
 * keep going through the namespace strip/resolve pipeline.
 *
 * `sitemap` is a web-only top level (`/sitemap/<namespace>/<file>.xml`, see
 * `apps/web/app/sitemap/[...segments]/route.ts`). A workspace named `sitemap`
 * would be shadowed by that static segment in the UI, while on the API side
 * `/sitemap` is a perfectly ordinary namespace-scoped controller reached as
 * `/<namespace>/sitemap` — putting it in {@link RESERVED_PREFIXES} would make
 * an unscoped `/sitemap` bypass namespace resolution and hit tenant code with
 * no schema. Extensions (`sitemap.xml`, `robots.txt`) need no entry: SLUG_RE
 * already rejects dots.
 */
export const RESERVED_WEB_PREFIXES = new Set<string>(['sitemap']);

/** True when `slug` collides with a reserved API or web route segment. */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_PREFIXES.has(slug) || RESERVED_WEB_PREFIXES.has(slug);
}

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

/**
 * Database workload lane used to keep user-facing requests responsive while
 * scans and other internal callbacks are writing heavily.
 *
 * Both lanes target the same namespace schema, but they use separate bounded
 * pools. The split is a capacity reservation, not a consistency boundary.
 */
export type DatabaseLane = 'interactive' | 'background';

/** CLS store keys. */
export const CLS_SCHEMA = 'schemaName';
export const CLS_NAMESPACE_ID = 'namespaceId';
export const CLS_SLUG = 'slug';
export const CLS_DATABASE_LANE = 'databaseLane';
