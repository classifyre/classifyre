import { CustomSourceSessionService } from './custom-source-session.service';

/**
 * These tests exist because of one production failure mode.
 *
 * `PrismaService` is a CLS-scoped proxy: reading tenant data outside a resolved
 * namespace throws "PrismaService accessed outside a namespace context". An
 * earlier version of this service queried at `onModuleInit` and again on a
 * `setInterval`, and both crashed the API on boot under Skaffold - neither has
 * a namespace, and neither ever could.
 *
 * So the guard here is structural: the service must not touch Prisma outside a
 * request, and any detached work must re-enter the tenant explicitly.
 */
describe('CustomSourceSessionService', () => {
  /** A Prisma stand-in that behaves like the real CLS-scoped proxy. */
  function namespacedPrisma(schemaHolder: { schema?: string }) {
    return new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop === 'symbol') return undefined;
          if (!schemaHolder.schema) {
            throw new Error(
              `PrismaService accessed outside a namespace context (prop=${String(prop)}).`,
            );
          }
          return {
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            update: jest.fn().mockResolvedValue({}),
            upsert: jest.fn().mockResolvedValue({}),
          };
        },
      },
    );
  }

  function build(schemaHolder: { schema?: string }) {
    const store = new Map<string, unknown>();
    const cls = {
      get: (key: string) => (schemaHolder.schema ? store.get(key) : undefined),
      set: (key: string, value: unknown) => store.set(key, value),
      run: (fn: () => unknown) => fn(),
    };
    return new CustomSourceSessionService(
      cls as never,
      namespacedPrisma(schemaHolder) as never,
      {} as never,
      { assertCustomSource: jest.fn() } as never,
      {} as never,
      { isEnabled: () => false } as never,
    );
  }

  it('does not touch the database while being constructed', () => {
    // No namespace is resolved at construction, so any Prisma access throws.
    expect(() => build({ schema: undefined })).not.toThrow();
  });

  it('exposes no lifecycle hook that would run outside a request', () => {
    const service = build({ schema: undefined }) as unknown as Record<
      string,
      unknown
    >;
    // onModuleInit ran a query; onModuleDestroy only existed to clear the timer
    // that ran the same query every minute. Neither may come back.
    expect(service.onModuleInit).toBeUndefined();
    expect(service.onModuleDestroy).toBeUndefined();
    expect(service.reapIdleSessions).toBeUndefined();
  });

  it('builds a browser path that carries the source and session', () => {
    const path = CustomSourceSessionService.browserPath('src-1', 'sess-2');
    expect(path).toBe('/custom-sources/src-1/session/sess-2/app');
  });

  it('reads nothing from the cache for an unknown session', () => {
    const service = build({ schema: 'ns_abc' });
    expect(service.cachedTarget('src-1', 'sess-1')).toBeUndefined();
  });

  it('reads the database only once a namespace is resolved', async () => {
    const holder: { schema?: string } = { schema: undefined };
    const service = build(holder);

    await expect(service.get('src-1')).rejects.toThrow(
      /outside a namespace context/,
    );

    holder.schema = 'ns_abc';
    await expect(service.get('src-1')).resolves.toBeNull();
  });
});
