import { previousCronOccurrence } from './cron-window';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

describe('previousCronOccurrence', () => {
  it('finds the last daily window in the schedule timezone', () => {
    // 06:15 Europe/Berlin in September is 04:15 UTC.
    const now = new Date('2026-09-20T09:00:00Z');
    expect(
      iso(previousCronOccurrence('15 6 * * *', 'Europe/Berlin', now)),
    ).toBe('2026-09-20T04:15:00.000Z');
  });

  it("goes back to yesterday when today's window has not arrived yet", () => {
    const now = new Date('2026-09-20T03:00:00Z');
    expect(
      iso(previousCronOccurrence('15 6 * * *', 'Europe/Berlin', now)),
    ).toBe('2026-09-19T04:15:00.000Z');
  });

  it('honours day-of-week (Sunday 01:30 Berlin)', () => {
    // 2026-09-20 is a Sunday; 01:30 Berlin = 23:30 UTC on Saturday.
    const now = new Date('2026-09-20T12:00:00Z');
    expect(
      iso(previousCronOccurrence('30 1 * * 0', 'Europe/Berlin', now)),
    ).toBe('2026-09-19T23:30:00.000Z');
  });

  it('matches a schedule due in the current minute', () => {
    const now = new Date('2026-09-20T04:15:30Z');
    expect(
      iso(previousCronOccurrence('15 6 * * *', 'Europe/Berlin', now)),
    ).toBe('2026-09-20T04:15:00.000Z');
  });

  it('survives the DST change (winter Berlin is UTC+1)', () => {
    const now = new Date('2026-11-02T09:00:00Z');
    expect(
      iso(previousCronOccurrence('15 6 * * *', 'Europe/Berlin', now)),
    ).toBe('2026-11-02T05:15:00.000Z');
  });

  it('supports steps, ranges and lists', () => {
    const now = new Date('2026-09-20T09:07:00Z');
    expect(iso(previousCronOccurrence('*/15 * * * *', 'UTC', now))).toBe(
      '2026-09-20T09:00:00.000Z',
    );
    expect(iso(previousCronOccurrence('0 8-10 * * *', 'UTC', now))).toBe(
      '2026-09-20T09:00:00.000Z',
    );
    expect(iso(previousCronOccurrence('0 3,21 * * *', 'UTC', now))).toBe(
      '2026-09-20T03:00:00.000Z',
    );
  });

  it('treats both day fields as OR, like cron does', () => {
    // Day-of-month 1 OR Monday. 2026-09-20 is a Sunday, so the last match is
    // Monday 2026-09-14... or the 1st of September, whichever is later.
    const now = new Date('2026-09-20T12:00:00Z');
    expect(iso(previousCronOccurrence('0 0 1 * 1', 'UTC', now))).toBe(
      '2026-09-14T00:00:00.000Z',
    );
  });

  it('returns null for a window outside the lookback (quarterly)', () => {
    const now = new Date('2026-09-20T12:00:00Z');
    expect(
      previousCronOccurrence('0 3 1 */3 *', 'Europe/Berlin', now),
    ).toBeNull();
  });

  it('returns null for an unsupported or malformed expression', () => {
    const now = new Date('2026-09-20T12:00:00Z');
    expect(previousCronOccurrence('bogus', 'UTC', now)).toBeNull();
    expect(previousCronOccurrence('0 0 * *', 'UTC', now)).toBeNull();
    expect(previousCronOccurrence('99 0 * * *', 'UTC', now)).toBeNull();
  });

  it('falls back to UTC for an unknown timezone rather than throwing', () => {
    const now = new Date('2026-09-20T09:00:00Z');
    expect(iso(previousCronOccurrence('0 6 * * *', 'Mars/Olympus', now))).toBe(
      '2026-09-20T06:00:00.000Z',
    );
  });
});
