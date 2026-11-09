import type { IamConfig } from './iam-config';
import { MembershipService } from './membership.service';

const config = {
  adminUrl: 'http://iam/admin/realms/classifyre',
  internalRealmUrl: 'http://iam/realms/classifyre',
  apiClientId: 'classifyre-api',
  apiClientSecret: 's',
} as IamConfig;

describe('MembershipService cache', () => {
  let now: number;
  let down: boolean;
  let userLookups: number;

  const fetchImpl = ((url: string) => {
    if (url.endsWith('/token')) {
      return Promise.resolve(
        Response.json({ access_token: 't', expires_in: 3600 }),
      );
    }
    if (down) return Promise.resolve(new Response('', { status: 503 }));
    if (url.includes('/users/')) {
      userLookups += 1;
      return Promise.resolve(
        Response.json({ enabled: true, firstName: 'Ada', lastName: 'K' }),
      );
    }
    return Promise.resolve(
      Response.json([{ id: 'o1', alias: 'acme', name: 'Acme' }]),
    );
  }) as typeof fetch;

  beforeEach(() => {
    now = 1_000_000;
    down = false;
    userLookups = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());

  it('looks a person up once for many requests at the same moment', async () => {
    const membership = new MembershipService(config, fetchImpl);
    const answers = await Promise.all(
      Array.from({ length: 20 }, () => membership.membership('u1')),
    );
    expect(userLookups).toBe(1);
    expect(answers[19].displayName).toBe('Ada K');
  });

  it('serves the last answer while the identity server is briefly down, then refuses', async () => {
    const membership = new MembershipService(config, fetchImpl);
    await membership.membership('u1');
    down = true;

    now += 5 * 60_000; // past the one-minute cache, within the grace period
    await expect(membership.membership('u1')).resolves.toMatchObject({
      enabled: true,
    });

    now += 20 * 60_000; // past the grace period: stale access is not trusted
    await expect(membership.membership('u1')).rejects.toThrow(/failed/);
  });
});
