import { glossaryEvents } from '../glossary/glossary-events';
import { SemanticEventsListener } from './semantic-events.listener';

/**
 * Which glossary changes become linker work. A change that can alter what
 * links to a term and schedules no backfill leaves the links stale until the
 * nightly reconcile, which only samples.
 */
describe('SemanticEventsListener', () => {
  const scheduler = {
    scheduleBackfill: jest.fn().mockResolvedValue('job'),
    scheduleMapRebuild: jest.fn().mockResolvedValue(undefined),
    scheduleSuggestions: jest.fn().mockResolvedValue(undefined),
    scheduleVocabularyRefresh: jest.fn().mockResolvedValue(undefined),
    scheduleIncrementalForAssets: jest.fn().mockResolvedValue('job'),
  };
  const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) };

  beforeAll(() => {
    new SemanticEventsListener(prisma as never, scheduler as never);
  });
  beforeEach(() => jest.clearAllMocks());

  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const term = { termId: 't-1', key: 'gmbh', kind: 'CONCEPT' };

  it('walks nothing for a created binding and walks an approved one once', async () => {
    const binding = { bindingId: 'b-1', mode: 'OUTPUT' };
    glossaryEvents.emit({
      type: 'glossary.binding_changed',
      change: 'created',
      ...binding,
    });
    await settle();
    expect(scheduler.scheduleBackfill).not.toHaveBeenCalled();

    glossaryEvents.emit({
      type: 'glossary.binding_changed',
      change: 'approved',
      ...binding,
    });
    await settle();
    expect(scheduler.scheduleBackfill).toHaveBeenCalledTimes(1);
    expect(scheduler.scheduleBackfill).toHaveBeenCalledWith(
      expect.objectContaining({ bindingIds: ['b-1'] }),
    );
  });

  // A concept created APPROVED in a lookup scheme is what "Create concept"
  // does for an unmatched value: the lookup binding resolves it from then on.
  it('relinks when a term is created ready to link', async () => {
    glossaryEvents.emit({
      type: 'glossary.term_changed',
      change: 'created',
      linkingChanged: true,
      ...term,
    });
    await settle();
    expect(scheduler.scheduleBackfill).toHaveBeenCalledWith(
      expect.objectContaining({ termIds: ['t-1'] }),
    );
  });

  it('relinks on a scheme or kind change and not on an edit that changes neither', async () => {
    glossaryEvents.emit({
      type: 'glossary.term_changed',
      change: 'updated',
      linkingChanged: false,
      ...term,
    });
    await settle();
    expect(scheduler.scheduleBackfill).not.toHaveBeenCalled();

    glossaryEvents.emit({
      type: 'glossary.term_changed',
      change: 'updated',
      linkingChanged: true,
      ...term,
    });
    await settle();
    expect(scheduler.scheduleBackfill).toHaveBeenCalledTimes(1);
  });

  it.each(['approved', 'unapproved', 'deprecated', 'reinstated'] as const)(
    'relinks when a term is %s',
    async (change) => {
      glossaryEvents.emit({ type: 'glossary.term_changed', change, ...term });
      await settle();
      expect(scheduler.scheduleBackfill).toHaveBeenCalledTimes(1);
    },
  );
});
