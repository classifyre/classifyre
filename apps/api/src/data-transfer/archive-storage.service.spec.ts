import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { ArchiveStorageService } from './archive-storage.service';

/**
 * The upload handle round-trips through the client — the API returns it from
 * the upload endpoint and the client posts it back to start the import — so
 * everything that resolves one has to assume it is hostile.
 */
describe('ArchiveStorageService handles', () => {
  let dir: string;
  let storage: ArchiveStorageService;
  const originalDir = process.env.DATA_TRANSFER_DIR;
  const originalBucket = process.env.S3_BUCKET;

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cfyre-storage-'));
    process.env.DATA_TRANSFER_DIR = dir;
    delete process.env.S3_BUCKET;
    storage = new ArchiveStorageService();
    await storage.onModuleInit();
  });

  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
    if (originalDir === undefined) delete process.env.DATA_TRANSFER_DIR;
    else process.env.DATA_TRANSFER_DIR = originalDir;
    if (originalBucket === undefined) delete process.env.S3_BUCKET;
    else process.env.S3_BUCKET = originalBucket;
  });

  it('resolves a handle it issued back to the same file', async () => {
    const allocated = await storage.allocate('ns_acme', 'archive.cfyre');
    await fsp.writeFile(allocated, 'x');

    const handle = storage.handleFor(allocated);
    expect(handle).not.toContain('/');
    await expect(storage.materialize('ns_acme', handle)).resolves.toBe(
      allocated,
    );
    await expect(storage.available('ns_acme', handle)).resolves.toBe(true);
  });

  it('refuses to escape the namespace directory', async () => {
    const secret = path.join(dir, 'secret.txt');
    await fsp.writeFile(secret, 'do not read me');

    for (const handle of [
      '../secret.txt',
      '../../secret.txt',
      '/etc/passwd',
      'ns_other/../../secret.txt',
    ]) {
      await expect(storage.materialize('ns_acme', handle)).resolves.toBeNull();
    }

    // And the file it was aiming at is untouched.
    await expect(fsp.readFile(secret, 'utf8')).resolves.toBe('do not read me');
  });

  it('keeps one namespace from reading another namespace archive', async () => {
    const theirs = await storage.allocate('ns_other', 'archive.cfyre');
    await fsp.writeFile(theirs, 'x');
    const handle = storage.handleFor(theirs);

    await expect(storage.materialize('ns_acme', handle)).resolves.toBeNull();
    await expect(storage.materialize('ns_other', handle)).resolves.toBe(theirs);
  });

  it('reports a missing archive rather than throwing', async () => {
    await expect(
      storage.materialize('ns_acme', 'nope.cfyre'),
    ).resolves.toBeNull();
    await expect(storage.available('ns_acme', 'nope.cfyre')).resolves.toBe(
      false,
    );
    await expect(storage.size('ns_acme', 'nope.cfyre')).resolves.toBe(0);
    // Removing something that is already gone is not an error.
    await expect(
      storage.remove('ns_acme', 'nope.cfyre'),
    ).resolves.toBeUndefined();
  });

  it('drops every archive for a namespace being torn down', async () => {
    const first = await storage.allocate('ns_acme', 'one.cfyre');
    const second = await storage.allocate('ns_acme', 'two.cfyre');
    await fsp.writeFile(first, 'x');
    await fsp.writeFile(second, 'y');

    await storage.removeSchema('ns_acme');

    await expect(storage.exists(first)).resolves.toBe(false);
    await expect(storage.exists(second)).resolves.toBe(false);
  });

  it('uses the filesystem when a directory is configured, even with a bucket set', async () => {
    // A shared volume is the escape hatch for installs that have one; it must
    // win over object storage rather than silently doing both.
    process.env.S3_BUCKET = 'should-be-ignored';
    const withDir = new ArchiveStorageService();
    await withDir.onModuleInit();
    expect(withDir.usesObjectStorage).toBe(false);
  });
});
