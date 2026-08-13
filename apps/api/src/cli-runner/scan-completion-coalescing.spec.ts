import { CliRunnerService } from './cli-runner.service';
import {
  INQUIRY_MATCH_COALESCE_SECONDS,
  INQUIRY_MATCH_QUEUE,
} from '../matching/matching.constants';
import {
  CORRELATION_QUEUE,
  CORRELATION_SCAN_COALESCE_SECONDS,
} from '../correlation/correlation.constants';

jest.mock('@kubernetes/client-node', () => ({
  KubeConfig: class {
    loadFromFile() {}
    loadFromCluster() {}
    makeApiClient() {
      return {};
    }
  },
  BatchV1Api: class {},
  CoreV1Api: class {},
}));

/**
 * A completed scan enqueues two follow-up jobs, both meant to debounce per
 * source. They carried a `singletonKey` and nothing else, which in pg-boss 12
 * debounces nothing at all: `singleton_on` is derived only from
 * `singletonSeconds`, and the dedupe index `job_i4` is partial on
 * `singleton_on IS NOT NULL`. Neither queue is created with a policy, so both
 * are `standard` and the key alone had no index to enforce it — every scan got
 * its own job, and the comment claiming otherwise made that invisible.
 */
describe('scan-completion follow-up jobs coalesce per source', () => {
  const send = jest.fn().mockResolvedValue('job-id');

  const buildService = () => {
    send.mockClear();
    const pgBoss = {
      getBossAsync: jest.fn().mockResolvedValue({ send }),
    };
    return new CliRunnerService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      pgBoss as any,
      undefined,
    );
  };

  const enqueue = async () => {
    const service = buildService();
    await (service as any).enqueueQuestionMatching('source-1', 'runner-1');
    return Object.fromEntries(
      send.mock.calls.map(([queue, data, opts]) => [queue, { data, opts }]),
    );
  };

  it('gives the correlation job a singleton window, not just a key', async () => {
    const calls = await enqueue();
    expect(calls[CORRELATION_QUEUE].opts).toMatchObject({
      singletonKey: 'correlation:source-1',
      singletonSeconds: CORRELATION_SCAN_COALESCE_SECONDS,
      singletonNextSlot: true,
    });
  });

  it('gives the inquiry-matching job the same treatment', async () => {
    const calls = await enqueue();
    expect(calls[INQUIRY_MATCH_QUEUE].opts).toMatchObject({
      singletonKey: 'source-1',
      singletonSeconds: INQUIRY_MATCH_COALESCE_SECONDS,
      singletonNextSlot: true,
    });
  });

  /**
   * Deferral, not deletion. A pair of rapid rescans must still produce two
   * correlation passes — `singletonNextSlot` moves the loser to the following
   * slot, whereas omitting it would drop the job and lose that runner's assets
   * until some later scan happened to touch them again.
   */
  it('defers rather than drops on collision', async () => {
    const calls = await enqueue();
    for (const queue of [CORRELATION_QUEUE, INQUIRY_MATCH_QUEUE]) {
      expect(calls[queue].opts.singletonNextSlot).toBe(true);
    }
  });

  it('still carries the runner id both jobs are scoped to', async () => {
    const calls = await enqueue();
    for (const queue of [CORRELATION_QUEUE, INQUIRY_MATCH_QUEUE]) {
      expect(calls[queue].data).toEqual({
        sourceId: 'source-1',
        runnerId: 'runner-1',
      });
    }
  });
});
