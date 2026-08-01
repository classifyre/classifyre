import { Readable } from 'node:stream';

import {
  ARCHIVE_MAGIC,
  ARCHIVE_VERSION,
  ArchiveFormatError,
  ArchiveReader,
  ArchiveWriter,
  type ChunkSink,
  decodeValue,
  encodeValue,
  type ArchiveManifest,
} from './archive';

const manifest: ArchiveManifest = {
  kind: ARCHIVE_MAGIC,
  v: ARCHIVE_VERSION,
  createdAt: '2026-07-30T10:00:00.000Z',
  appVersion: '0.4.79',
  namespace: { name: 'Acme Investigations', slug: 'acme' },
  scopes: ['sources', 'findings'],
  estimatedCounts: { source: 1, finding: 2 },
  secretsStripped: true,
};

/** Small enough that even a tiny archive spans several chunk rows. */
const CHUNK = 1024;

describe('archive round trip', () => {
  let chunks: Buffer[];
  let sink: ChunkSink;

  beforeEach(() => {
    chunks = [];
    sink = (ordinal, data) => {
      // Ordinals must arrive dense and in order, or the reader reassembles the
      // archive wrong.
      expect(ordinal).toBe(chunks.length);
      chunks.push(Buffer.from(data));
      return Promise.resolve();
    };
  });

  const writer = () => new ArchiveWriter(sink, CHUNK);
  const reader = () => new ArchiveReader(() => Readable.from(chunks));
  const stored = () => Buffer.concat(chunks);

  it('writes and reads records, preserving non-JSON runtime types', async () => {
    const w = writer();
    await w.writeManifest(manifest);
    await w.writeRecord('source', {
      id: 's1',
      name: 'Wiki',
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
      fileSize: 9007199254740993n,
      blob: Buffer.from('hello'),
      config: { nested: { when: new Date('2026-02-01T00:00:00.000Z') } },
      tags: ['a', 'b'],
      missing: null,
    });
    await w.writeFooter({ counts: { source: 1 }, stripped: {} });
    const result = await w.close();

    expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
    // The reported size must match what actually reached the sink, or the
    // download's Content-Length truncates the file.
    expect(result.size).toBe(stored().length);
    expect(result.chunks).toBe(chunks.length);

    const r = reader();
    const rows: Array<{ table: string; row: Record<string, unknown> }> = [];
    for await (const record of r.read()) rows.push(record);

    expect(r.manifest).toEqual(manifest);
    expect(r.footer).toEqual({ counts: { source: 1 }, stripped: {} });
    expect(rows).toHaveLength(1);

    const row = rows[0].row;
    expect(rows[0].table).toBe('source');
    expect(row['createdAt']).toBeInstanceOf(Date);
    expect((row['createdAt'] as Date).toISOString()).toBe(
      '2026-01-02T03:04:05.000Z',
    );
    // Exactly the value, not a float that lost the last digit.
    expect(row['fileSize']).toBe(9007199254740993n);
    expect(Buffer.isBuffer(row['blob'])).toBe(true);
    expect((row['blob'] as Buffer).toString()).toBe('hello');
    expect(
      (
        (row['config'] as Record<string, Record<string, unknown>>)['nested'][
          'when'
        ] as Date
      ).toISOString(),
    ).toBe('2026-02-01T00:00:00.000Z');
    expect(row['tags']).toEqual(['a', 'b']);
    expect(row['missing']).toBeNull();
  });

  it('spans many chunks and reads every record back', async () => {
    const w = writer();
    await w.writeManifest(manifest);
    for (let i = 0; i < 5_000; i += 1) {
      await w.writeRecord('finding', { id: `f${i}`, label: 'email' });
    }
    await w.writeFooter({ counts: { finding: 5000 }, stripped: {} });
    const result = await w.close();

    // The point of chunking: a real archive is many rows, and every chunk but
    // the last is exactly the configured size.
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.length).toBe(CHUNK);
    }
    expect(result.size).toBe(stored().length);

    let seen = 0;
    for await (const _ of reader().read()) seen += 1;
    expect(seen).toBe(5_000);
  });

  it('reads the manifest without decompressing the whole archive', async () => {
    const w = writer();
    await w.writeManifest(manifest);
    for (let i = 0; i < 500; i += 1) {
      await w.writeRecord('finding', { id: `f${i}`, label: 'email' });
    }
    await w.writeFooter({ counts: { finding: 500 }, stripped: {} });
    await w.close();

    await expect(reader().readManifest()).resolves.toEqual(manifest);
  });

  it('refuses an archive that ends without its footer', async () => {
    const w = writer();
    await w.writeManifest(manifest);
    await w.writeRecord('source', { id: 's1' });
    await w.close();

    const r = reader();
    await expect(
      (async () => {
        for await (const _ of r.read()) void _;
      })(),
    ).rejects.toThrow(/truncated|footer/i);
  });

  it('refuses a file that is not an archive', async () => {
    await expect(
      ArchiveReader.fromBuffer(Buffer.from('not gzip at all')).readManifest(),
    ).rejects.toThrow(ArchiveFormatError);
  });

  it('refuses an archive from a newer format version', async () => {
    const w = writer();
    await w.writeManifest({ ...manifest, v: ARCHIVE_VERSION + 1 });
    await w.writeFooter({ counts: {}, stripped: {} });
    await w.close();

    await expect(reader().readManifest()).rejects.toThrow(
      /newer than this instance supports/,
    );
  });

  it('reads an in-memory upload exactly as a stored archive', async () => {
    const w = writer();
    await w.writeManifest(manifest);
    await w.writeRecord('source', { id: 's1' });
    await w.writeFooter({ counts: { source: 1 }, stripped: {} });
    await w.close();

    // The upload path parses the bytes before they are ever stored, so it has
    // to agree with the chunked path exactly.
    await expect(
      ArchiveReader.fromBuffer(stored()).readManifest(),
    ).resolves.toEqual(manifest);
  });

  it('fails the archive when a chunk cannot be stored', async () => {
    // A database that rejects a write must abort the export, not quietly
    // produce an archive with a hole in it.
    const failing = new ArchiveWriter(
      (ordinal) =>
        ordinal === 0
          ? Promise.reject(new Error('chunk write failed'))
          : Promise.resolve(),
      CHUNK,
    );
    await failing.writeManifest(manifest);
    for (let i = 0; i < 2_000; i += 1) {
      await failing
        .writeRecord('finding', { id: `f${i}`, label: 'email' })
        .catch(() => undefined);
    }
    await expect(failing.close()).rejects.toThrow(/chunk write failed/);
  });
});

describe('value encoding', () => {
  it('round-trips through JSON, which cannot hold these types natively', () => {
    const original = {
      when: new Date('2026-05-05T00:00:00.000Z'),
      big: 42n,
      bytes: Buffer.from([1, 2, 3]),
      list: [new Date('2026-06-06T00:00:00.000Z'), 7n],
      plain: { a: 1, b: 'two', c: false, d: null },
    };

    const restored = decodeValue(
      JSON.parse(JSON.stringify(encodeValue(original))),
    ) as typeof original;

    expect(restored.when).toBeInstanceOf(Date);
    expect(restored.when.toISOString()).toBe('2026-05-05T00:00:00.000Z');
    expect(restored.big).toBe(42n);
    expect(Buffer.from(restored.bytes).toString('hex')).toBe('010203');
    expect((restored.list[0] as Date).toISOString()).toBe(
      '2026-06-06T00:00:00.000Z',
    );
    expect(restored.list[1]).toBe(7n);
    expect(restored.plain).toEqual({ a: 1, b: 'two', c: false, d: null });
  });
});
