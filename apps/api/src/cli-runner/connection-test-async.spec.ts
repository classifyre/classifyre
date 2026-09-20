import { CliRunnerService } from './cli-runner.service';

/**
 * The asynchronous connection test (GENESIS field report P2).
 *
 * The synchronous endpoint holds the request open for the whole test. On
 * Kubernetes the test pod first has to be scheduled: one measured call
 * returned after 422.5 s, of which the test itself was 3 s and the rest was
 * `Pending` behind a running scan. Behind any ingress with a 60 s timeout that
 * is a failed request while the job is still running.
 *
 * These pin the three properties a poll-based answer needs: it returns before
 * the test does, it survives the replica that started it, and it always
 * reaches a terminal state.
 */
describe('CliRunnerService connection test (async)', () => {
  function harness() {
    const rows = new Map<string, any>([
      ['src-1', { id: 'src-1', connectionTest: null }],
    ]);
    const prisma = {
      source: {
        findUnique: jest.fn(({ where }: any) =>
          Promise.resolve(rows.get(where.id) ?? null),
        ),
        update: jest.fn(({ where, data }: any) => {
          rows.set(where.id, { ...rows.get(where.id), ...data });
          return Promise.resolve(rows.get(where.id));
        }),
      },
    };
    const service = Object.create(
      CliRunnerService.prototype,
    ) as CliRunnerService;
    Object.assign(service, { prisma });
    return { service, prisma, rows };
  }

  /** Let the un-awaited background test run to completion. */
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  it('answers RUNNING before the test has finished', async () => {
    const h = harness();
    let finish: (value: unknown) => void = () => {};
    jest
      .spyOn(h.service, 'testConnection')
      .mockReturnValue(new Promise((resolve) => (finish = resolve)) as any);

    const started = await h.service.startConnectionTest('src-1', 'api');

    expect(started.status).toBe('RUNNING');
    expect(started.startedAt).toBeTruthy();
    expect(started.finishedAt).toBeNull();

    finish({ status: 'SUCCESS', message: 'modifieddata reachable' });
    await settle();
    expect((await h.service.getConnectionTest('src-1'))?.status).toBe(
      'SUCCESS',
    );
  });

  it("stores the connector's own message with the result", async () => {
    const h = harness();
    jest.spyOn(h.service, 'testConnection').mockResolvedValue({
      status: 'SUCCESS',
      message: 'modifieddata reachable: 20 updates in the last 7 days',
    });

    await h.service.startConnectionTest('src-1');
    await settle();

    const record = await h.service.getConnectionTest('src-1');
    expect(record).toMatchObject({
      status: 'SUCCESS',
      message: 'modifieddata reachable: 20 updates in the last 7 days',
    });
    expect(record?.finishedAt).toBeTruthy();
  });

  it('records a thrown test as a FAILURE rather than leaving it RUNNING', async () => {
    // A poll must always reach a terminal state; a spinner that never resolves
    // is the failure mode this endpoint exists to remove.
    const h = harness();
    jest
      .spyOn(h.service, 'testConnection')
      .mockRejectedValue(new Error('kubernetes job was evicted'));

    await h.service.startConnectionTest('src-1');
    await settle();

    expect(await h.service.getConnectionTest('src-1')).toMatchObject({
      status: 'FAILURE',
      message: expect.stringContaining('evicted'),
    });
  });

  it('joins a test already in flight instead of starting a second', async () => {
    const h = harness();
    const test = jest
      .spyOn(h.service, 'testConnection')
      .mockReturnValue(new Promise(() => {}) as any);

    const first = await h.service.startConnectionTest('src-1');
    const second = await h.service.startConnectionTest('src-1');

    expect(second.startedAt).toBe(first.startedAt);
    expect(test).toHaveBeenCalledTimes(1);
  });

  it('reports a test whose replica vanished, instead of spinning forever', async () => {
    const h = harness();
    h.rows.set('src-1', {
      id: 'src-1',
      connectionTest: {
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        finishedAt: null,
        message: null,
        result: null,
        triggeredBy: 'api',
      },
    });

    expect(await h.service.getConnectionTest('src-1')).toMatchObject({
      status: 'FAILURE',
      message: expect.stringContaining('lost'),
    });
  });

  it('lets a new test replace a stale one', async () => {
    const h = harness();
    h.rows.set('src-1', {
      id: 'src-1',
      connectionTest: {
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        finishedAt: null,
        message: null,
        result: null,
        triggeredBy: 'api',
      },
    });
    const test = jest
      .spyOn(h.service, 'testConnection')
      .mockResolvedValue({ status: 'SUCCESS' });

    await h.service.startConnectionTest('src-1');
    await settle();

    expect(test).toHaveBeenCalledTimes(1);
    expect((await h.service.getConnectionTest('src-1'))?.status).toBe(
      'SUCCESS',
    );
  });

  it('returns null for a source nobody has tested', async () => {
    const h = harness();
    expect(await h.service.getConnectionTest('src-1')).toBeNull();
  });
});
