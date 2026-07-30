import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  ARCHIVE_MAGIC,
  ARCHIVE_VERSION,
  ArchiveFormatError,
  ArchiveReader,
  ArchiveWriter,
  decodeValue,
  encodeValue,
  type ArchiveManifest,
} from './archive';

const manifest: ArchiveManifest = {
  kind: ARCHIVE_MAGIC,
  v: ARCHIVE_VERSION,
  createdAt: '2026-07-30T10:00:00.000Z',
  appVersion: '0.4.79',
  namespace: { name: 'acme', slug: 'acme' },
  scopes: ['sources', 'findings'],
  estimatedCounts: { source: 1, finding: 2 },
  secretsStripped: true,
};

describe('archive round trip', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cfyre-archive-'));
  });

  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  const archivePath = () => path.join(dir, 'test.cfyre');

  it('writes and reads records, preserving non-JSON runtime types', async () => {
    const writer = new ArchiveWriter(archivePath());
    await writer.writeManifest(manifest);
    await writer.writeRecord('source', {
      id: 's1',
      name: 'Wiki',
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
      fileSize: 9007199254740993n,
      blob: Buffer.from('hello'),
      config: { nested: { when: new Date('2026-02-01T00:00:00.000Z') } },
      tags: ['a', 'b'],
      missing: null,
    });
    await writer.writeFooter({ counts: { source: 1 }, stripped: {} });
    const result = await writer.close();

    expect(result.size).toBeGreaterThan(0);
    expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);

    const reader = new ArchiveReader(archivePath());
    const rows: Array<{ table: string; row: Record<string, unknown> }> = [];
    for await (const record of reader.read()) rows.push(record);

    expect(reader.manifest).toEqual(manifest);
    expect(reader.footer).toEqual({ counts: { source: 1 }, stripped: {} });
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

  it('reads the manifest without decompressing the whole archive', async () => {
    const writer = new ArchiveWriter(archivePath());
    await writer.writeManifest(manifest);
    for (let i = 0; i < 500; i += 1) {
      await writer.writeRecord('finding', { id: `f${i}`, label: 'email' });
    }
    await writer.writeFooter({ counts: { finding: 500 }, stripped: {} });
    await writer.close();

    await expect(
      new ArchiveReader(archivePath()).readManifest(),
    ).resolves.toEqual(manifest);
  });

  it('refuses an archive that ends without its footer', async () => {
    const writer = new ArchiveWriter(archivePath());
    await writer.writeManifest(manifest);
    await writer.writeRecord('source', { id: 's1' });
    await writer.close();

    const reader = new ArchiveReader(archivePath());
    await expect(
      (async () => {
        for await (const _ of reader.read()) void _;
      })(),
    ).rejects.toThrow(/truncated|footer/i);
  });

  it('refuses a file that is not an archive', async () => {
    await fsp.writeFile(archivePath(), 'not gzip at all');
    await expect(
      new ArchiveReader(archivePath()).readManifest(),
    ).rejects.toThrow(ArchiveFormatError);
  });

  it('refuses an archive from a newer format version', async () => {
    const writer = new ArchiveWriter(archivePath());
    await writer.writeManifest({ ...manifest, v: ARCHIVE_VERSION + 1 });
    await writer.writeFooter({ counts: {}, stripped: {} });
    await writer.close();

    await expect(
      new ArchiveReader(archivePath()).readManifest(),
    ).rejects.toThrow(/newer than this instance supports/);
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
