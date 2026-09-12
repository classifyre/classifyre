import { FindingStatus, Severity } from '@prisma/client';
import { HistoryEventType } from './finding-history.types';
import {
  historyEntryForStorage,
  historyForStorage,
  lastEntry,
  lastEntryOfType,
  renderHistory,
} from './finding-history';

/**
 * The contract is that the API response did not change.
 *
 * History stopped being stored as full objects to save ~143 MB of the 213 MB it
 * occupied across 816,436 entries, so what is worth testing is that both the old
 * and the new stored shapes render to what a client used to receive — and that
 * the three readers who ask "what was the last X" still get an answer from
 * either shape. That last part is not cosmetic: `findingHasManualStatusOverride`
 * is what stops a scan re-opening a finding an operator resolved.
 */
describe('finding history', () => {
  const detected = {
    timestamp: new Date('2026-09-01T10:00:00.000Z'),
    runnerId: 'runner-1',
    eventType: HistoryEventType.DETECTED,
    status: FindingStatus.OPEN,
    severity: Severity.HIGH,
    confidence: 0.99,
  };

  it('writes codes and short keys', () => {
    expect(historyEntryForStorage(detected)).toEqual({
      t: '2026-09-01T10:00:00.000Z',
      e: 'D',
      r: 'runner-1',
      s: 'OPEN',
      v: 'HIGH',
      c: 0.99,
    });
  });

  it('drops the location it used to copy off the finding', () => {
    // 607,227 entries carried one, duplicating the finding's own column, and
    // no reader has ever touched it.
    const stored = historyEntryForStorage({
      ...detected,
      location: { path: 'custom://x/y', start: 1, end: 9 },
    });
    expect(stored).not.toHaveProperty('location');
    expect(renderHistory([stored])[0]).not.toHaveProperty('location');
  });

  it('codes the sentences the system writes for itself', () => {
    const stored = historyEntryForStorage({
      ...detected,
      eventType: HistoryEventType.RESOLVED,
      status: FindingStatus.RESOLVED,
      changeReason: 'Detection no longer present in scan',
    });
    expect(stored.x).toBe('#gone');
    expect(renderHistory([stored])[0].changeReason).toBe(
      'Detection no longer present in scan',
    );
  });

  it("keeps an operator's own words verbatim", () => {
    const stored = historyEntryForStorage({
      ...detected,
      eventType: HistoryEventType.STATUS_CHANGED,
      status: FindingStatus.FALSE_POSITIVE,
      changeReason: 'Derived from a 1000x unit-scale error in the filed XML',
      changedBy: 'analyst-1',
    });
    expect(stored.x).toBe(
      'Derived from a 1000x unit-scale error in the filed XML',
    );
    expect(renderHistory([stored])[0]).toMatchObject({
      changeReason: 'Derived from a 1000x unit-scale error in the filed XML',
      changedBy: 'analyst-1',
    });
  });

  it('round-trips to the shape the API has always returned', () => {
    const [rendered] = renderHistory(historyForStorage([detected]));
    expect(rendered).toEqual({
      timestamp: new Date('2026-09-01T10:00:00.000Z'),
      runnerId: 'runner-1',
      eventType: HistoryEventType.DETECTED,
      status: FindingStatus.OPEN,
      severity: Severity.HIGH,
      confidence: 0.99,
    });
  });

  it('passes rows written before the change through untouched', () => {
    // There is no backfill, so a corpus written by an older version has to keep
    // reading exactly as it did.
    const legacy = {
      timestamp: '2026-08-29T22:13:51.111Z',
      runnerId: '969ccf72-898a-4a7e-b8d7-4217569b489b',
      eventType: 'DETECTED',
      status: 'OPEN',
      severity: 'INFO',
      confidence: 1,
      location: { path: 'custom://x/person-1' },
    };
    expect(renderHistory([legacy])).toEqual([legacy]);
  });

  it('reads a mixed column, which is what every corpus becomes', () => {
    const legacy = {
      timestamp: '2026-08-29T22:13:51.111Z',
      runnerId: 'r0',
      eventType: 'DETECTED',
      status: 'OPEN',
    };
    const rendered = renderHistory([
      legacy,
      historyEntryForStorage({
        ...detected,
        eventType: HistoryEventType.RESOLVED,
        status: FindingStatus.RESOLVED,
      }),
    ]);
    expect(rendered.map((entry) => entry.eventType)).toEqual([
      'DETECTED',
      HistoryEventType.RESOLVED,
    ]);
  });

  it('survives anything that is not an entry', () => {
    expect(renderHistory(null)).toEqual([]);
    expect(renderHistory('nonsense')).toEqual([]);
    expect(renderHistory([null, 42, {}, { t: 'x' }])).toEqual([]);
  });

  describe('lastEntryOfType', () => {
    const manualResolve = historyEntryForStorage({
      ...detected,
      eventType: HistoryEventType.STATUS_CHANGED,
      status: FindingStatus.RESOLVED,
      changeReason: 'Manual status change',
    });
    const laterRedetect = historyEntryForStorage({
      ...detected,
      eventType: HistoryEventType.RE_DETECTED,
    });

    it('finds the manual override that stops a scan re-opening a finding', () => {
      const found = lastEntryOfType(
        [historyEntryForStorage(detected), manualResolve, laterRedetect],
        HistoryEventType.STATUS_CHANGED,
      );
      expect(found?.status).toBe(FindingStatus.RESOLVED);
    });

    it('finds it in the legacy shape too', () => {
      const found = lastEntryOfType(
        [
          {
            timestamp: '2026-08-30T09:20:54.769Z',
            runnerId: 'r1',
            eventType: 'STATUS_CHANGED',
            status: 'RESOLVED',
          },
        ],
        HistoryEventType.STATUS_CHANGED,
      );
      expect(found?.status).toBe(FindingStatus.RESOLVED);
    });

    it('takes the LAST one, not the first', () => {
      const reopened = historyEntryForStorage({
        ...detected,
        eventType: HistoryEventType.STATUS_CHANGED,
        status: FindingStatus.OPEN,
      });
      const found = lastEntryOfType(
        [manualResolve, reopened],
        HistoryEventType.STATUS_CHANGED,
      );
      expect(found?.status).toBe(FindingStatus.OPEN);
    });

    it('returns nothing when the type never occurred', () => {
      expect(
        lastEntryOfType([laterRedetect], HistoryEventType.SEVERITY_CHANGED),
      ).toBeUndefined();
      expect(
        lastEntryOfType(null, HistoryEventType.STATUS_CHANGED),
      ).toBeUndefined();
    });
  });

  describe('lastEntry', () => {
    it('renders the reason so a code compares against its sentence', () => {
      // `noteRetainedForCitation` compares the last reason against the sentence
      // it is about to write; against a stored code that test never matches and
      // it appends one entry per scan, forever.
      const note =
        'Detector removed from source configuration, but this finding is kept ' +
        'because a case cites it or an active inquiry watches it';
      const stored = historyEntryForStorage({
        ...detected,
        eventType: HistoryEventType.RE_DETECTED,
        changeReason: note,
      });
      expect(stored.x).toBe('#retained');
      expect(lastEntry([stored])?.changeReason).toBe(note);
    });

    it('is undefined for an empty history', () => {
      expect(lastEntry([])).toBeUndefined();
      expect(lastEntry(undefined)).toBeUndefined();
    });
  });
});
