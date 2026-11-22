import {
  ScramExchange,
  scramClient,
  scramVerifier,
} from '../sql-connections/scram';
import {
  MAX_WAITERS,
  SignInLockout,
  challengeVerifier,
  decoyVerifier,
  refusalMessage,
  refusalReason,
} from './sign-in';
import { inCidr, isCidr } from './sql-gateway.service';

const secret = Buffer.alloc(32, 7);

describe('sign-in without giving names away', () => {
  it('challenges an unknown name with the same salt every time', () => {
    const first = decoyVerifier(secret, 'ns-1', 'nobody');
    const again = decoyVerifier(secret, 'ns-1', 'NOBODY');
    expect(again).toEqual(first);
    expect(first.iterations).toBe(4096);
    expect(Buffer.from(first.salt, 'base64')).toHaveLength(16);
  });

  it('gives different names and workspaces different salts', () => {
    const a = decoyVerifier(secret, 'ns-1', 'ana');
    expect(decoyVerifier(secret, 'ns-1', 'bo').salt).not.toBe(a.salt);
    expect(decoyVerifier(secret, 'ns-2', 'ana').salt).not.toBe(a.salt);
    expect(decoyVerifier(Buffer.alloc(32, 8), 'ns-1', 'ana').salt).not.toBe(
      a.salt,
    );
  });

  it('matches no password', () => {
    const server = new ScramExchange(decoyVerifier(secret, 'ns-1', 'nobody'));
    const client = scramClient('nobody', 'anything');
    const first = server.start(client.first);
    expect(() => server.finish(client.final(first).message)).toThrow();
  });

  it('uses the connection’s verifier when it has one, else the decoy', () => {
    const real = scramVerifier('pw');
    const decoy = decoyVerifier(secret, 'ns-1', 'x');
    expect(
      challengeVerifier({ status: 'active', verifier: real }, () => decoy),
    ).toBe(real);
    expect(
      challengeVerifier({ status: 'pending', verifier: null }, () => decoy),
    ).toBe(decoy);
    expect(challengeVerifier(null, () => decoy)).toBe(decoy);
  });

  it('tells a wrong password nothing about the connection', () => {
    const generic = 'password authentication failed for user "ana_bi"';
    for (const status of [
      'active',
      'pending',
      'expired',
      'revoked',
      null,
    ] as const) {
      expect(refusalMessage('ana_bi', false, status)).toBe(generic);
    }
    expect(refusalMessage('ana_bi', true, 'revoked')).toBe(
      'This SQL connection was revoked.',
    );
    expect(refusalMessage('ana_bi', true, 'expired')).toBe(
      'This SQL connection has expired.',
    );
  });

  it('keeps the real reason for the audit trail only', () => {
    expect(refusalReason(false, null, 'Wrong password.')).toBe('unknown user');
    expect(refusalReason(false, 'active', 'Wrong password.')).toBe(
      'Wrong password.',
    );
    expect(refusalReason(false, 'pending', 'Wrong password.')).toMatch(
      /^pending/,
    );
    expect(refusalReason(true, 'revoked', 'x')).toBe('revoked');
  });
});

describe('SignInLockout', () => {
  it('locks a key after ten failures within the window, then lets it go', () => {
    let now = 0;
    const lockout = new SignInLockout(1000, 10, () => now);
    for (let i = 0; i < 9; i++) lockout.fail('u:ana');
    expect(lockout.isLocked('u:ana')).toBe(false);
    lockout.fail('u:ana');
    expect(lockout.isLocked('u:ana')).toBe(true);
    expect(lockout.isLocked('ip:1.2.3.4')).toBe(false);
    now = 1001;
    expect(lockout.isLocked('u:ana')).toBe(false);
  });

  it('reports a locked key once per window', () => {
    let now = 0;
    const lockout = new SignInLockout(1000, 1, () => now);
    lockout.fail('k');
    expect(lockout.shouldReport('k')).toBe(true);
    expect(lockout.shouldReport('k')).toBe(false);
    now = 1500;
    expect(lockout.shouldReport('k')).toBe(true);
  });
});

describe('inCidr', () => {
  it('matches IPv4, IPv4-mapped IPv6 and IPv6 networks', () => {
    expect(inCidr('10.42.0.7', '10.42.0.0/16')).toBe(true);
    expect(inCidr('::ffff:10.42.0.7', '10.42.0.0/16')).toBe(true);
    expect(inCidr('10.43.0.7', '10.42.0.0/16')).toBe(false);
    expect(inCidr('2001:db8::1', '2001:db8::/32')).toBe(true);
    expect(inCidr('2001:db9::1', '2001:db8::/32')).toBe(false);
    expect(inCidr('10.0.0.1', '2001:db8::/32')).toBe(false);
  });
});

describe('malformed CIDRs', () => {
  it.each([
    '10.0.0.0/',
    'x/abc',
    '10.0.0.0/33',
    '10.0.0/8',
    '300.1.1.1',
    '',
    '::1/129',
    '1:2:3/64',
  ])('treats %p as no network at all', (cidr) => {
    expect(isCidr(cidr)).toBe(false);
    expect(inCidr('10.0.0.1', cidr)).toBe(false);
    expect(inCidr('2001:db8::1', cidr)).toBe(false);
  });

  it.each(['10.0.0.0/8', '10.1.2.3', '0.0.0.0/0', '2001:db8::/32', '::1'])(
    'accepts %p',
    (cidr) => expect(isCidr(cidr)).toBe(true),
  );
});

describe('one sign-in at a time per key', () => {
  const here = ['u:ns:bi:1.2.3.4', 'ip:1.2.3.4'];

  it('lets a second sign-in from the same place wait for the first, never run beside it', async () => {
    // A BI tool's connection pool opens several connections at once
    // (Metabase's c3p0, BIC M0): they sign in one after another.
    const lockout = new SignInLockout();
    const order: string[] = [];
    expect(await lockout.begin(here)).toBe(true);
    const second = lockout.begin(here).then((ok) => {
      order.push(`second ${ok}`);
      return ok;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push('first ends');
    lockout.end(here);
    expect(await second).toBe(true);
    expect(order).toEqual(['first ends', 'second true']);
    lockout.end(here);
  });

  it('counts the first sign-in’s failure before the waiting one is checked', async () => {
    const lockout = new SignInLockout(15 * 60_000, 1);
    expect(await lockout.begin(here)).toBe(true);
    const second = lockout.begin(here);
    lockout.fail(here[0]);
    lockout.end(here);
    expect(await second).toBe(true);
    expect(lockout.isLocked(here[0])).toBe(true);
    lockout.end(here);
  });

  it('gives up when the sign-in ahead takes too long', async () => {
    const lockout = new SignInLockout();
    expect(await lockout.begin(here)).toBe(true);
    expect(await lockout.begin(here, 30)).toBe(false);
    lockout.end(here);
    expect(await lockout.begin(here, 30)).toBe(true);
    lockout.end(here);
  });

  it('does not make other places wait', async () => {
    const lockout = new SignInLockout();
    expect(await lockout.begin(here)).toBe(true);
    expect(await lockout.begin(['u:ns:bi:5.6.7.8', 'ip:5.6.7.8'], 10)).toBe(
      true,
    );
    lockout.end(here);
  });

  it('lets only a few wait on one key; the rest are refused at once', async () => {
    // One address must not hold the sign-in slots every tenant shares.
    const lockout = new SignInLockout();
    expect(await lockout.begin(here)).toBe(true);
    const waiting = [1, 2].map(() => lockout.begin(here, 5_000, 2));
    const started = Date.now();
    expect(await lockout.begin(here, 5_000, 2)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
    lockout.end(here);
    expect(await waiting[0]).toBe(true);
    lockout.end(here);
    expect(await waiting[1]).toBe(true);
    lockout.end(here);
  });

  it('tells the caller while a sign-in waits, so it can give its slot back', async () => {
    const lockout = new SignInLockout();
    const seen: boolean[] = [];
    expect(await lockout.begin(here)).toBe(true);
    const second = lockout.begin(here, 5_000, 8, (on) => seen.push(on));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toEqual([true]);
    lockout.end(here);
    expect(await second).toBe(true);
    expect(seen).toEqual([true, false]);
    lockout.end(here);
  });

  it('lets at most MAX_WAITERS sign-ins wait in all', async () => {
    const lockout = new SignInLockout();
    expect(await lockout.begin(['k'])).toBe(true);
    const waiting = Array.from({ length: MAX_WAITERS }, () =>
      lockout.begin(['k'], 200, MAX_WAITERS + 1),
    );
    // Refused at once, not after the wait: every waiting place is taken.
    const started = Date.now();
    expect(await lockout.begin(['k'], 200, MAX_WAITERS + 1)).toBe(false);
    expect(Date.now() - started).toBeLessThan(100);
    expect(await Promise.all(waiting)).toEqual(
      Array<boolean>(MAX_WAITERS).fill(false),
    );
    lockout.end(['k']);
  });
});
