import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';

import { DataTransferController } from './data-transfer.controller';
import { DataTransferService } from './data-transfer.service';

/**
 * Boots the real controller on a real Fastify adapter and hits the download
 * route, because the bug this guards against — a browser saving `download.json`
 * instead of the archive — is invisible to a unit test of the handler body. It
 * only shows up in what actually reaches the wire: the status, the
 * `Content-Type` and the `Content-Disposition` filename.
 */
describe('DataTransferController download', () => {
  let app: NestFastifyApplication;
  let dir: string;
  let archivePath: string;
  const archiveBody = gzipSync(Buffer.from('{"kind":"archive"}\n'));

  const transfers = {
    downloadable: jest.fn(),
  };

  beforeAll(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cfyre-dl-'));
    archivePath = path.join(dir, 'archive.cfyre');
    await fsp.writeFile(archivePath, archiveBody);

    const moduleRef = await Test.createTestingModule({
      controllers: [DataTransferController],
      providers: [
        { provide: DataTransferService, useValue: transfers },
        { provide: ClsService, useValue: { get: () => 'ns_test' } },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await fsp.rm(dir, { recursive: true, force: true });
  });

  beforeEach(() => transfers.downloadable.mockReset());

  it('serves the archive with its own name and content type', async () => {
    transfers.downloadable.mockResolvedValue({
      path: archivePath,
      fileName: 'all-sources-test-2026-07-31.cfyre',
      size: archiveBody.length,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/data-transfer/exports/job-1/download',
    });

    expect(response.statusCode).toBe(200);
    // Any of these three going missing is what makes a browser invent
    // `download.json` from the URL's last segment.
    expect(response.headers['content-type']).toBe('application/gzip');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="all-sources-test-2026-07-31.cfyre"',
    );
    expect(response.headers['content-length']).toBe(String(archiveBody.length));
    expect(response.rawPayload.equals(archiveBody)).toBe(true);
  });

  it('answers a missing archive with a JSON error, not a broken file', async () => {
    transfers.downloadable.mockRejectedValue(
      new NotFoundException('The archive has expired'),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/data-transfer/exports/job-1/download',
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    // The client has to read this and say so, rather than save it to disk.
    expect(response.json()).toMatchObject({
      message: 'The archive has expired',
    });
  });
});
