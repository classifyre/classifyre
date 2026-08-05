import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import multipart from '@fastify/multipart';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';

import { ArchiveStoreService } from './archive-store.service';
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
  const archiveBody = gzipSync(Buffer.from('{"kind":"archive"}\n'));

  const transfers = { downloadable: jest.fn() };
  // Chunked exactly as the real store hands the archive back.
  const store = {
    stream: () =>
      Readable.from([archiveBody.subarray(0, 4), archiveBody.subarray(4)]),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DataTransferController],
      providers: [
        { provide: DataTransferService, useValue: transfers },
        { provide: ArchiveStoreService, useValue: store },
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
  });

  beforeEach(() => transfers.downloadable.mockReset());

  it('serves the archive with its own name and content type', async () => {
    transfers.downloadable.mockResolvedValue({
      jobId: 'job-1',
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

/**
 * Boots the same controller against a real @fastify/multipart to check the
 * upload actually streams.
 *
 * This is the half of an import that used to fail before it had begun: the
 * handler called `part.toBuffer()`, so a 250 MB archive became 250 MB of heap
 * in the API process before a single byte reached the database. Nothing short
 * of a real multipart request over a real adapter proves the replacement, since
 * the whole change lives in how the body is consumed.
 *
 * Over a real socket rather than `app.inject`, because inject hands the whole
 * body over in one write — which is exactly the thing the change is supposed to
 * stop happening, so it cannot distinguish a fix from the bug.
 */
describe('DataTransferController upload', () => {
  let app: NestFastifyApplication;
  let port: number;
  const UPLOAD_LIMIT = 2 * 1024 * 1024;
  const BOUNDARY = 'cfyre-test-boundary';

  /** POST a multipart body written to the socket in `slices` separate writes. */
  function postArchive(
    archive: Buffer,
    fileName: string,
    slices = 8,
  ): Promise<{ status: number; body: string }> {
    const head = Buffer.from(
      `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
    );
    const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`);

    return new Promise((resolve, reject) => {
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: '/data-transfer/imports/upload',
          headers: {
            'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
            'content-length': head.length + archive.length + tail.length,
          },
        },
        (response) => {
          const parts: Buffer[] = [];
          response.on('data', (chunk: Buffer) => parts.push(chunk));
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              body: Buffer.concat(parts).toString(),
            }),
          );
        },
      );
      request.on('error', reject);

      request.write(head);
      const sliceSize = Math.ceil(archive.length / slices);
      for (let offset = 0; offset < archive.length; offset += sliceSize) {
        request.write(archive.subarray(offset, offset + sliceSize));
      }
      request.end(tail);
    });
  }

  /** Records what the service was handed, without ever joining it back up. */
  const received: { name?: string; bytes: number; pieces: number } = {
    bytes: 0,
    pieces: 0,
  };

  const transfers = {
    receiveUpload: jest.fn(
      async (fileName: string, source: AsyncIterable<Buffer>) => {
        received.name = fileName;
        for await (const chunk of source) {
          received.bytes += chunk.length;
          received.pieces += 1;
        }
        return { uploadId: 'upload-1', fileName, fileSize: received.bytes };
      },
    ),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DataTransferController],
      providers: [
        { provide: DataTransferService, useValue: transfers },
        { provide: ArchiveStoreService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    // Mirrors main.ts, except for a ceiling small enough to reach in a test.
    await app.register(multipart, {
      limits: { files: 1, fileSize: UPLOAD_LIMIT },
    });
    await app.init();
    await app.listen(0, '127.0.0.1');

    const address = app.getHttpAdapter().getInstance().server.address();
    port = typeof address === 'object' && address ? address.port : 0;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    transfers.receiveUpload.mockClear();
    received.name = undefined;
    received.bytes = 0;
    received.pieces = 0;
  });

  it('hands the archive to the service as a stream, not a buffer', async () => {
    // Incompressible, so the parser cannot coalesce it into one small piece.
    const archive = randomBytes(1024 * 1024);

    const response = await postArchive(
      archive,
      'Enron-email-2026-08-03-1344.cfyre',
    );

    expect(response.status).toBe(201);
    expect(received.name).toBe('Enron-email-2026-08-03-1344.cfyre');
    expect(received.bytes).toBe(archive.length);
    // The point of the whole change: the service saw the body as it arrived,
    // rather than being handed one finished Buffer after the last byte landed.
    expect(received.pieces).toBeGreaterThan(1);
    expect(JSON.parse(response.body)).toMatchObject({ uploadId: 'upload-1' });
  });

  it('refuses an upload cut off at the size limit instead of staging half of it', async () => {
    const response = await postArchive(
      randomBytes(UPLOAD_LIMIT * 2),
      'too-big.cfyre',
    );

    // The stream just ends early and looks like a complete archive to anything
    // that is not checking `truncated` — which is how a half-namespace gets
    // staged and then imported as though it were whole.
    expect(response.status).toBe(400);
    expect(response.body).toMatch(/size limit|cut off/i);
  });

  it('rejects a request with no file rather than staging an empty job', async () => {
    const form = new FormData();
    form.append('notAFile', 'hello');

    const response = await app.inject({
      method: 'POST',
      url: '/data-transfer/imports/upload',
      body: form,
    });

    expect(response.statusCode).toBe(400);
    expect(transfers.receiveUpload).not.toHaveBeenCalled();
  });
});
