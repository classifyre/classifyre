import { NotificationsService } from './notifications.service';
import { CLS_SLUG } from './namespace/namespace.constants';
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
    isRead: false,
    readAt: null,
    isImportant: false,
    metadata: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });

  const build = (slug: string | undefined, actionUrl: string | null) => {
    const prisma = {
      notification: { create: jest.fn().mockResolvedValue(row(actionUrl)) },
    };
    const cls = {
      get: jest.fn((key: string) => (key === CLS_SLUG ? slug : undefined)),
    };
    return new NotificationsService(prisma as any, cls as any);
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
    expect((await create(build('acme', 'https://example.com/x'))).actionUrl).toBe(
      'https://example.com/x',
    );
    expect((await create(build('acme', null))).actionUrl).toBeNull();
  });

  it('falls back to the raw URL outside a namespace context', async () => {
    const result = await create(build(undefined, '/scans/r1'));
    expect(result.actionUrl).toBe('/scans/r1');
  });
});
