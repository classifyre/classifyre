import { preferQueued } from './namespace-registry.service';

/**
 * The cross-namespace runner queue's fairness policy.
 *
 * Tested here rather than through the registry because this comparator *is*
 * the policy — the SQL around it only supplies the numbers. Getting it wrong
 * is invisible until a tenant is starved: in the GENESIS session a register
 * sweep whose two previous runs took 26 minutes and 13.9 hours meant nothing
 * in three other namespaces could run at all, and global FIFO was working
 * exactly as designed (field report P1).
 */
describe('preferQueued', () => {
  const at = (iso: string) => new Date(iso);

  const head = (over: Partial<Parameters<typeof preferQueued>[0]> = {}) => ({
    runnerId: 'r',
    triggeredAt: at('2026-09-17T12:00:00Z'),
    lane: 1,
    lastServedAt: at('2026-09-17T11:00:00Z'),
    ...over,
  });

  it('gives a namespace served longer ago the slot, however new its ticket', () => {
    // The exact shape of the bug: the sweeping tenant re-enqueues every 15
    // minutes so it always holds the oldest ticket, and under global FIFO it
    // therefore always won.
    const waiting = head({
      runnerId: 'german-run',
      triggeredAt: at('2026-09-17T12:55:57Z'),
      lastServedAt: null,
    });
    const sweeper = head({
      runnerId: 'register-sweep',
      triggeredAt: at('2026-09-17T12:55:22Z'),
      lastServedAt: at('2026-09-17T12:40:00Z'),
    });

    expect(preferQueued(waiting, sweeper)).toBe(true);
    expect(preferQueued(sweeper, waiting)).toBe(false);
  });

  it('treats never having run as the longest wait of all', () => {
    const fresh = head({ lastServedAt: null });
    const served = head({ lastServedAt: at('1999-01-01T00:00:00Z') });

    expect(preferQueued(fresh, served)).toBe(true);
    expect(preferQueued(served, fresh)).toBe(false);
  });

  it('puts someone waiting at a screen ahead of a sweep', () => {
    // A MANUAL run or a source's first run, even from the namespace that was
    // served most recently: nobody is watching a scheduled sweep.
    const manual = head({
      lane: 0,
      lastServedAt: at('2026-09-17T12:59:00Z'),
      triggeredAt: at('2026-09-17T13:00:00Z'),
    });
    const sweep = head({ lane: 1, lastServedAt: null });

    expect(preferQueued(manual, sweep)).toBe(true);
  });

  it('falls back to the older ticket when the lane and the wait match', () => {
    const older = head({ triggeredAt: at('2026-09-17T12:00:00Z') });
    const newer = head({ triggeredAt: at('2026-09-17T12:30:00Z') });

    expect(preferQueued(older, newer)).toBe(true);
    expect(preferQueued(newer, older)).toBe(false);
  });

  it('is a strict order: nothing outranks itself', () => {
    // A non-strict comparator would let the reduce flip between two equal
    // heads and the same runner could be claimed twice.
    const only = head();
    expect(preferQueued(only, { ...only })).toBe(false);
  });
});
