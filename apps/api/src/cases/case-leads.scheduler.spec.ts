import { CaseActivityService } from '../case-activity.service';
import { CaseLeadsScheduler } from './case-leads.scheduler';
import { CASE_LEADS_QUEUE } from './case-leads.constants';

describe('CaseLeadsScheduler', () => {
  const boss = { send: jest.fn() };
  const pgBoss = { getBossAsync: jest.fn(() => Promise.resolve(boss)) };

  beforeEach(() => {
    jest.clearAllMocks();
    boss.send.mockResolvedValue('job-1');
  });

  it('coalesces the refreshes a change asks for and lets the change commit first', async () => {
    await new CaseLeadsScheduler(pgBoss as never).request('case-1', 'x');

    expect(boss.send).toHaveBeenCalledWith(
      CASE_LEADS_QUEUE,
      { caseId: 'case-1', reason: 'x' },
      expect.objectContaining({
        singletonKey: 'case-leads:case-1',
        singletonSeconds: 30,
        singletonNextSlot: true,
        startAfter: 15,
      }),
    );
  });

  it('does not ask the queue again for a change it already covers', async () => {
    const scheduler = new CaseLeadsScheduler(pgBoss as never);

    await scheduler.request('case-1', 'finding_added');
    await scheduler.request('case-1', 'finding_added');
    await scheduler.request('case-2', 'finding_added');

    expect(boss.send).toHaveBeenCalledTimes(2);
  });

  it('throttles board reads without queueing behind them', async () => {
    await new CaseLeadsScheduler(pgBoss as never).requestOnRead('case-1');

    const options = boss.send.mock.calls[0][2];
    expect(options).toEqual(
      expect.objectContaining({
        singletonKey: 'case-leads-read:case-1',
        singletonSeconds: 600,
      }),
    );
    expect(options.singletonNextSlot).toBeUndefined();
  });

  it('leaves a demo instance as curated', async () => {
    await new CaseLeadsScheduler(
      pgBoss as never,
      {
        isDemoMode: true,
      } as never,
    ).requestOnRead('case-1');

    expect(boss.send).not.toHaveBeenCalled();
  });

  it('never fails the change that asked', async () => {
    boss.send.mockRejectedValue(
      new Error('Queue case-leads.refresh does not exist'),
    );

    await expect(
      new CaseLeadsScheduler(pgBoss as never).request('case-1', 'x'),
    ).resolves.toBeUndefined();
  });
});

describe('CaseActivityService → lead refresh', () => {
  const prisma = {
    caseActivity: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
  };
  const leads = { request: jest.fn() };
  const service = new CaseActivityService(prisma as never, leads as never);

  beforeEach(() => {
    jest.clearAllMocks();
    leads.request.mockResolvedValue(undefined);
    prisma.caseActivity.findFirst.mockResolvedValue(null);
  });

  it('asks for a refresh when evidence joins the case', async () => {
    await service.record('case-1', 'FINDING_ADDED', {}, 'ana');

    expect(leads.request).toHaveBeenCalledWith('case-1', 'finding_added');
  });

  it('asks after an automatic pull folded into the timeline', async () => {
    await service.recordCoalesced(
      'case-1',
      'INQUIRY_PULLED',
      {},
      'inquiry-auto-pull',
      { key: 'q-1', merge: (_previous, next) => next },
    );

    expect(leads.request).toHaveBeenCalledWith('case-1', 'inquiry_pulled');
  });

  it('stays quiet for activity that cannot change the leads', async () => {
    await service.record('case-1', 'THREAD_CREATED', {}, 'ana');
    // Its own entry must never start another refresh.
    await service.record('case-1', 'LEADS_GENERATED', {}, 'case-leads');

    expect(leads.request).not.toHaveBeenCalled();
  });
});
