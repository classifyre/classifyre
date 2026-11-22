import { SignInSlots, clientKey } from './sign-in-slots';

describe('SignInSlots', () => {
  it('counts each client by the address its PROXY header names, not the proxy', () => {
    // Behind a load balancer every socket comes from the proxy: counted by
    // that, one client's idle sockets would block everyone (re-review).
    const slots = new SignInSlots(64, 2);
    const a = [slots.enter()!, slots.enter()!];
    expect(a.map((t) => t.identify('203.0.113.7'))).toEqual([true, true]);
    const third = slots.enter()!;
    expect(third.identify('203.0.113.7')).toBe(false);
    third.leave();
    const other = slots.enter()!;
    expect(other.identify('198.51.100.9')).toBe(true);
    a[0].leave();
    const again = slots.enter()!;
    expect(again.identify('203.0.113.7')).toBe(true);
  });

  it('refuses sockets past the total, and frees one on leave, once', () => {
    const slots = new SignInSlots(2, 16);
    const first = slots.enter()!;
    slots.enter();
    expect(slots.enter()).toBeNull();
    first.leave();
    first.leave();
    expect(slots.active).toBe(1);
    expect(slots.enter()).not.toBeNull();
  });

  it('gives a waiting sign-in’s share of the total back while it waits', () => {
    const slots = new SignInSlots(1, 16);
    const waiter = slots.enter()!;
    waiter.identify('203.0.113.7');
    waiter.waiting(true);
    const next = slots.enter();
    expect(next).not.toBeNull();
    next!.leave();
    waiter.waiting(false);
    expect(slots.active).toBe(1);
    waiter.leave();
    expect(slots.active).toBe(0);
  });

  it('counts a sign-in that is gone while it waited once only', () => {
    const slots = new SignInSlots(4, 16);
    const ticket = slots.enter()!;
    ticket.waiting(true);
    ticket.leave();
    ticket.waiting(false);
    expect(slots.active).toBe(0);
  });

  it('counts an IPv6 client by its /64', () => {
    const slots = new SignInSlots(64, 1);
    expect(slots.enter()!.identify('2001:db8:1:2::a')).toBe(true);
    expect(slots.enter()!.identify('2001:db8:1:2:ffff::1')).toBe(false);
    expect(slots.enter()!.identify('2001:db8:1:3::a')).toBe(true);
    expect(slots.enter()!.identify('::ffff:203.0.113.7')).toBe(true);
    expect(slots.enter()!.identify('203.0.113.7')).toBe(false);
  });
});

describe('clientKey', () => {
  it('groups IPv6 by /64 and leaves IPv4 alone', () => {
    expect(clientKey('2001:0db8:0001:0002:0000:0000:0000:000a')).toBe(
      '2001:db8:1:2::/64',
    );
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7');
  });
});
