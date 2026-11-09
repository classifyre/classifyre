import { NotificationsService } from './notifications.service';
import { CLS_NAMESPACE_ID, CLS_SLUG } from './namespace/namespace.constants';
import { CLS_PERSON } from './identity/iam-access-policy';
import { NotificationType } from './types/notification.types';

/**
 * Producers (CLI runner, autopilot) store namespace-relative action URLs.
 * The web app routes every tenant page under `/<slug>/…`, so the API must
 * qualify them on the way out — otherwise clicking a notification navigates to
 * `/scans/<id>`, where `scans` is read as the namespace slug.
 */
describe('NotificationsService action URLs', () => {
  const row = (actionUrl: string | null) => ({
    id: 'n1',
    type: 'SYSTEM',
    event: 'scan.completed',
    severity: 'INFO',
    title: 't',
    message: 'm',
    actionUrl,
    sourceId: null,
    runnerId: null,
    findingId: null,
    triggeredBy: null,
    isImportant: false,
    audienceGroupIds: [],
    metadata: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });

  const build = (slug: string | undefined, actionUrl: string | null) => {
    const prisma = {
      notification: { create: jest.fn().mockResolvedValue(row(actionUrl)) },
      notificationAudience: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const cls = {
      isActive: () => true,
      get: jest.fn((key: string) => (key === CLS_SLUG ? slug : undefined)),
    };
    const tenancy = { workspaceTenancy: jest.fn().mockResolvedValue(null) };
    return new NotificationsService(prisma as any, cls as any, tenancy as any);
  };

  const create = (service: NotificationsService) =>
    service.create({
      type: NotificationType.SYSTEM,
      event: 'scan.completed',
      severity: 'INFO',
      title: 't',
      message: 'm',
    } as any);

  it('prefixes a namespace-relative action URL with the active slug', async () => {
    const result = await create(build('acme', '/scans/r1'));
    expect(result.actionUrl).toBe('/acme/scans/r1');
  });

  it('keeps a query string intact', async () => {
    const result = await create(
      build('acme', '/findings?source=s1&status=RESOLVED'),
    );
    expect(result.actionUrl).toBe('/acme/findings?source=s1&status=RESOLVED');
  });

  it('does not double-prefix an already qualified URL', async () => {
    const result = await create(build('acme', '/acme/scans/r1'));
    expect(result.actionUrl).toBe('/acme/scans/r1');
  });

  it('leaves absolute URLs and nulls untouched', async () => {
    expect(
      (await create(build('acme', 'https://example.com/x'))).actionUrl,
    ).toBe('https://example.com/x');
    expect((await create(build('acme', null))).actionUrl).toBeNull();
  });

  it('falls back to the raw URL outside a namespace context', async () => {
    const result = await create(build(undefined, '/scans/r1'));
    expect(result.actionUrl).toBe('/scans/r1');
  });
});

describe('NotificationsService audiences', () => {
  const ADA = { actorRef: 'user:ada', groupIds: ['finance', 'root'] };

  function build(person: typeof ADA | null, audience: string[] | null) {
    const created: unknown[] = [];
    const emitted: unknown[] = [];
    const prisma = {
      notification: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve({
            ...data,
            id: 'n1',
            source: null,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          });
        }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      notificationAudience: {
        findUnique: jest
          .fn()
          .mockResolvedValue(audience ? { groupIds: audience } : null),
      },
    };
    const cls = {
      isActive: () => true,
      get: jest.fn((key: string) =>
        key === CLS_PERSON ? person : key === CLS_NAMESPACE_ID ? 'ns-1' : null,
      ),
    };
    const tenancy = {
      workspaceTenancy: jest
        .fn()
        .mockResolvedValue({ tenantId: 't1', ownerGroupId: 'finance' }),
    };
    const gateway = {
      emitNotificationCreated: (_n: unknown, groups: string[]) =>
        emitted.push(groups),
    };
    const service = new NotificationsService(
      prisma as any,
      cls as any,
      tenancy as any,
      gateway as any,
    );
    return { service, prisma, created, emitted };
  }

  const notify = (service: NotificationsService) =>
    service.create({
      type: NotificationType.SCAN,
      event: 'scan.completed',
      severity: 'INFO',
      title: 't',
      message: 'm',
    } as any);

  it('sends to the owning group when no groups are chosen', async () => {
    const { service, created, emitted } = build(ADA, null);
    await notify(service);
    expect(created[0]).toMatchObject({ audienceGroupIds: [] });
    expect(emitted).toEqual([['finance']]);
  });

  it('fixes the chosen groups on the notification', async () => {
    const { service, created, emitted } = build(ADA, ['ap', 'audit']);
    await notify(service);
    expect(created[0]).toMatchObject({ audienceGroupIds: ['ap', 'audit'] });
    expect(emitted).toEqual([['ap', 'audit']]);
  });

  it("lists what was sent to the person's groups, and owner-wide ones only to owner members", async () => {
    const { service, prisma } = build(ADA, null);
    await service.findAll({});
    const where = prisma.notification.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"hasSome":["finance","root"]');
    expect(JSON.stringify(where)).toContain('"isEmpty":true');
    expect(JSON.stringify(where)).toContain('"dismissedAt":{"not":null}');
  });

  it('does not show owner-wide notifications to people outside the owning group', async () => {
    const { service, prisma } = build(
      { actorRef: 'user:bo', groupIds: ['sales'] },
      null,
    );
    await service.findAll({});
    const where = prisma.notification.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain('isEmpty');
  });

  it('answers only signed-in people', async () => {
    const { service } = build(null, null);
    await expect(service.findAll({} as any)).rejects.toThrow(/signed-in/);
  });

  it('refuses to mark what the person cannot see', async () => {
    const { service } = build(ADA, null);
    await expect(service.markRead('n-other')).rejects.toThrow(/not found/);
  });
});
