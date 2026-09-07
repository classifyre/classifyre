import { EmbeddingProviderService } from './embedding-provider.service';

/**
 * What reaches onnxruntime, and how much of it at once.
 *
 * The provider is a singleton owning ONE forked child for the whole process,
 * and that child answers messages concurrently — every message starts its own
 * `extractor()` call. So two things had to be true before the worker's memory
 * was bounded, and neither was:
 *
 *  1. a single call must carry a bounded number of padded rows;
 *  2. calls must not overlap, or the bound is per-caller rather than a
 *     ceiling. On classifyre-dev up to MAX_CONCURRENT_NAMESPACE_JOBS=4
 *     namespace handlers hold a worker slot at once, with interactive query
 *     embedding arriving on top.
 *
 * These drive the private `embedLocal` against a stub child, so what is
 * asserted is exactly what would have been written to the real one.
 */
describe('local inference bounds', () => {
  interface Sent {
    id: number;
    texts: string[];
  }

  function harness(cfgOverrides: Record<string, unknown> = {}) {
    const sent: Sent[] = [];
    const service = Object.create(
      EmbeddingProviderService.prototype,
    ) as EmbeddingProviderService;
    const priv = service as unknown as {
      embedLocal: (
        texts: string[],
        cfg?: Record<string, unknown>,
      ) => Promise<number[][]>;
    };

    Object.assign(service, {
      logger: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
      now: () => 1_000_000,
      consecutiveWorkerFailures: 0,
      breakerTrips: 0,
      disabledUntil: undefined,
      pending: new Map(),
      sequence: 0,
      requestErrorCount: 0,
      inferenceQueue: Promise.resolve(),
      config: { maxBatchChars: 64_000 },
      ensureWorker: () => ({
        send: (message: Sent) => sent.push(message),
      }),
    });

    /** Answer the oldest outstanding request, as the real 'message' handler does. */
    const answer = () => {
      const pending = (
        service as unknown as {
          pending: Map<number, { resolve: (v: number[][]) => void }>;
        }
      ).pending;
      const [id, request] = [...pending][0] ?? [];
      if (id === undefined || !request) return false;
      pending.delete(id);
      const texts = sent.find((message) => message.id === id)?.texts ?? [];
      request.resolve(texts.map(() => [0.1, 0.2]));
      return true;
    };

    /** Let queued microtasks run, then answer whatever is now in flight. */
    const drain = async (rounds = 200) => {
      for (let i = 0; i < rounds; i += 1) {
        await Promise.resolve();
        if (!answer()) await Promise.resolve();
      }
    };

    const cfg = {
      model: 'm',
      revision: 'r',
      pooling: 'mean',
      normalize: true,
      dtype: 'q8',
      device: 'cpu',
      intraOpThreads: 2,
      cacheDir: '/tmp/cache',
      allowRemoteModels: false,
      batchSize: 32,
      ...cfgOverrides,
    };

    return { service, priv, sent, cfg, drain };
  }

  it('never sends the whole fetch that killed the worker in one call', async () => {
    // The shape measured on classifyre-dev: 32 pg-boss jobs x ~64 chunks,
    // flattened by the handler into one provider call.
    const h = harness();
    const texts = Array.from({ length: 2000 }, () => 'x'.repeat(558));

    const embedded = h.priv.embedLocal(texts, h.cfg);
    await h.drain();
    const vectors = await embedded;

    expect(vectors).toHaveLength(2000);
    expect(h.sent.length).toBeGreaterThan(1);
    for (const message of h.sent) {
      expect(message.texts.length).toBeLessThanOrEqual(32);
    }
    // Every chunk still embedded, in order — callers zip by index.
    expect(h.sent.flatMap((message) => message.texts)).toEqual(texts);
  });

  it('shrinks the call as chunks get longer, since padding is the cost', async () => {
    const h = harness();
    const texts = Array.from({ length: 64 }, () => 'x'.repeat(8000));

    const embedded = h.priv.embedLocal(texts, h.cfg);
    await h.drain();
    await embedded;

    // A row-count limit alone would have sent 32 rows here — the same count as
    // a batch of 100-character chunks, at 80x the padded footprint.
    for (const message of h.sent) {
      const longest = Math.max(...message.texts.map((text) => text.length));
      expect(message.texts.length * longest).toBeLessThanOrEqual(64_000);
    }
  });

  it('holds a second caller until the first is done', async () => {
    // Four namespace handlers plus interactive query embedding share this one
    // child. Overlapping them multiplies the native peak by the number of
    // callers, which is how a bounded batch stops being a ceiling.
    const h = harness();
    const first = h.priv.embedLocal(['a'], h.cfg);
    const second = h.priv.embedLocal(['b'], h.cfg);

    await Promise.resolve();
    await Promise.resolve();
    expect(h.sent).toHaveLength(1);

    await h.drain();
    await Promise.all([first, second]);
    expect(h.sent.map((message) => message.texts)).toEqual([['a'], ['b']]);
  });

  it('lets the queue keep moving after a failed request', async () => {
    // A failure must not wedge every caller behind it: the child dies under
    // memory pressure often enough that this is the normal path, not an edge.
    const h = harness();
    const failing = h.priv.embedLocal(['a'], h.cfg);
    await Promise.resolve();
    await Promise.resolve();

    const pending = (
      h.service as unknown as {
        pending: Map<number, { reject: (e: Error) => void }>;
      }
    ).pending;
    const [id, request] = [...pending][0];
    pending.delete(id);
    request.reject(new Error('worker exited'));
    await expect(failing).rejects.toThrow('worker exited');

    const next = h.priv.embedLocal(['b'], h.cfg);
    await h.drain();
    await expect(next).resolves.toHaveLength(1);
  });

  it('sends nothing at all for no texts', async () => {
    const h = harness();
    await expect(h.priv.embedLocal([], h.cfg)).resolves.toEqual([]);
    expect(h.sent).toHaveLength(0);
  });
});
