import { Readable } from 'node:stream';

import {
  ArchiveStoreService,
  ArchiveTooLargeError,
  CHUNK_BYTES,
} from './archive-store.service';
import type { PrismaService } from '../prisma.service';

/**
 * Guards the streaming upload path.
 *
 * A 250 MB import used to buffer 250 MB of heap before writing a single row,
 * which on a memory-capped API pod is an OOM rather than an import. Streaming
 * fixes that, but only if the chunks it emits stay dense, ordered and correctly
 * sized however the source happens to be diced up — the reader reassembles them
 * by ordinal and has no way to detect a gap. That is what these cover, along
 * with the two ways a real upload ends badly: too big, and cut off.
 */
describe('ArchiveStoreService.writeStream', () => {
  interface Written {
    ordinal: number;
    data: Buffer;
  }

  function makeStore(): { store: ArchiveStoreService; written: Written[] } {
    const written: Written[] = [];
    const prisma = {
      dataTransferChunk: {
        create: ({ data }: { data: { ordinal: number; data: Uint8Array } }) => {
          written.push({
            ordinal: data.ordinal,
            data: Buffer.from(data.data),
          });
          return Promise.resolve();
        },
      },
    } as unknown as PrismaService;

    return { store: new ArchiveStoreService(prisma), written };
  }

  /** `total` bytes delivered in `pieceSize` slices, like a socket would. */
  function pieces(total: number, pieceSize: number): AsyncIterable<Buffer> {
    return Readable.from(
      (function* () {
        let emitted = 0;
        while (emitted < total) {
          const size = Math.min(pieceSize, total - emitted);
          // Distinct byte per piece so reassembly errors are visible.
          yield Buffer.alloc(size, emitted % 251);
          emitted += size;
        }
      })(),
    ) as AsyncIterable<Buffer>;
  }

  const order = (written: Written[]): Buffer =>
    Buffer.concat(
      [...written]
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((chunk) => chunk.data),
    );

  it('splits a stream into dense, ordered chunks of the configured size', async () => {
    const { store, written } = makeStore();
    const total = CHUNK_BYTES * 2 + 1234;

    const result = await store.writeStream('job-1', pieces(total, 64 * 1024));

    expect(result.bytes).toBe(total);
    expect(result.chunks).toBe(3);
    expect(written).toHaveLength(3);

    const ordinals = written
      .map((chunk) => chunk.ordinal)
      .sort((a, b) => a - b);
    expect(ordinals).toEqual([0, 1, 2]);
    // Only the last chunk may be short — a sparse or ragged run would make the
    // reader reassemble the archive wrong.
    const sorted = [...written].sort((a, b) => a.ordinal - b.ordinal);
    expect(sorted[0].data).toHaveLength(CHUNK_BYTES);
    expect(sorted[1].data).toHaveLength(CHUNK_BYTES);
    expect(sorted[2].data).toHaveLength(1234);
    expect(order(written)).toHaveLength(total);
  });

  it('handles a source whose pieces are larger than one chunk', async () => {
    const { store, written } = makeStore();
    const total = CHUNK_BYTES * 3;

    const result = await store.writeStream(
      'job-1',
      pieces(total, CHUNK_BYTES * 2 + 7),
    );

    expect(result.chunks).toBe(3);
    expect(order(written)).toHaveLength(total);
  });

  it('reports progress as whole chunks land', async () => {
    const { store } = makeStore();
    const seen: number[] = [];

    await store.writeStream('job-1', pieces(CHUNK_BYTES * 2, 1024 * 1024), {
      onProgress: (bytes) => seen.push(bytes),
    });

    expect(seen.length).toBeGreaterThan(0);
    // Monotonic, and the last call is the final total — a client watching this
    // must never see it go backwards or stop short.
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    expect(seen[seen.length - 1]).toBe(CHUNK_BYTES * 2);
  });

  it('stops at the size ceiling instead of storing an oversized archive', async () => {
    const { store } = makeStore();

    await expect(
      store.writeStream('job-1', pieces(CHUNK_BYTES * 4, 512 * 1024), {
        maxBytes: CHUNK_BYTES * 2,
      }),
    ).rejects.toBeInstanceOf(ArchiveTooLargeError);
  });

  it('stops when the source itself fails, without an unhandled rejection', async () => {
    const { store } = makeStore();
    const source = Readable.from(
      (function* () {
        yield Buffer.alloc(CHUNK_BYTES);
        throw new Error('socket closed');
      })(),
    ) as AsyncIterable<Buffer>;

    await expect(store.writeStream('job-1', source)).rejects.toThrow(
      'socket closed',
    );
  });

  it('reads back exactly what a Node stream fed it', async () => {
    const { store, written } = makeStore();
    const payload = Buffer.concat([
      Buffer.alloc(CHUNK_BYTES, 0xab),
      Buffer.from('tail bytes'),
    ]);

    await store.writeStream(
      'job-1',
      Readable.from([payload.subarray(0, 10), payload.subarray(10)]),
    );

    expect(order(written).equals(payload)).toBe(true);
  });
});
