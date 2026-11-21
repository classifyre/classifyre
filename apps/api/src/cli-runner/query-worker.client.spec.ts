import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  QUERY_RESULT_MARKER,
  QueryWorkerClient,
  queryWorkerConfig,
} from './query-worker.client';

const TOKEN = 'test-token-0123456789abcdef';

type Handler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: string,
) => void;

/** A stand-in for apps/cli/src/query/worker.py on a free local port. */
async function fakeWorker(handler: Handler): Promise<{
  url: string;
  requests: Array<{ headers: http.IncomingHttpHeaders; body: string }>;
  close: () => Promise<void>;
}> {
  const requests: Array<{ headers: http.IncomingHttpHeaders; body: string }> =
    [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ headers: req.headers, body });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

const params = {
  runId: 'run-1',
  request: { runId: 'run-1', sql: 'SELECT 1' },
  timeoutSeconds: 30,
};

function client(url: string, overflow?: 'job' | 'refuse'): QueryWorkerClient {
  process.env.QUERY_WORKER_URL = url;
  process.env.QUERY_WORKER_TOKEN = TOKEN;
  if (overflow) process.env.QUERY_WORKER_OVERFLOW = overflow;
  else delete process.env.QUERY_WORKER_OVERFLOW;
  return new QueryWorkerClient();
}

describe('QueryWorkerClient', () => {
  const originalEnv = process.env;
  let worker: Awaited<ReturnType<typeof fakeWorker>> | null = null;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.QUERY_WORKER_URL;
    delete process.env.QUERY_WORKER_TOKEN;
  });

  afterEach(async () => {
    await worker?.close();
    worker = null;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('configuration', () => {
    it('is off without a URL', async () => {
      const off = new QueryWorkerClient();
      expect(off.enabled).toBe(false);
      await expect(off.run(params)).resolves.toBeNull();
    });

    it('refuses a URL without a usable token, or another overflow', () => {
      expect(() =>
        queryWorkerConfig({ QUERY_WORKER_URL: 'http://w:8090' }),
      ).toThrow(/QUERY_WORKER_TOKEN/);
      expect(() =>
        queryWorkerConfig({
          QUERY_WORKER_URL: 'ftp://w',
          QUERY_WORKER_TOKEN: TOKEN,
        }),
      ).toThrow(/http/);
      expect(() =>
        queryWorkerConfig({
          QUERY_WORKER_URL: 'http://w:8090',
          QUERY_WORKER_TOKEN: TOKEN,
          QUERY_WORKER_OVERFLOW: 'queue',
        }),
      ).toThrow(/OVERFLOW/);
      expect(
        queryWorkerConfig({
          QUERY_WORKER_URL: 'http://w:8090',
          QUERY_WORKER_TOKEN: TOKEN,
        }),
      ).toMatchObject({ overflow: 'job' });
    });
  });

  it('returns what a query Job prints, signed with the token', async () => {
    const payload = { status: 'success', rowCount: 1 };
    worker = await fakeWorker((_req, res) =>
      json(res, 200, { outcome: 'done', exitCode: 0, payload, worker: 'w-1' }),
    );
    const result = await client(worker.url).run(params);
    expect(result).toEqual({
      output: `${QUERY_RESULT_MARKER} ${JSON.stringify(payload)}`,
      exitCode: 0,
      worker: 'w-1',
    });
    expect(worker.requests).toHaveLength(1);
    expect(worker.requests[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(worker.requests[0].body)).toEqual(params.request);
  });

  it('tries again when a pod is busy, then leaves the query to a Job', async () => {
    worker = await fakeWorker((_req, res) => json(res, 503, { code: 'busy' }));
    await expect(client(worker.url).run(params)).resolves.toBeNull();
    expect(worker.requests).toHaveLength(3);
  });

  it('takes the second pod when the first is busy', async () => {
    let calls = 0;
    worker = await fakeWorker((_req, res) =>
      ++calls === 1
        ? json(res, 503, { code: 'busy' })
        : json(res, 200, {
            outcome: 'done',
            exitCode: 0,
            payload: { status: 'success' },
          }),
    );
    const result = await client(worker.url).run(params);
    expect(result?.exitCode).toBe(0);
    expect(worker.requests).toHaveLength(2);
  });

  it('does not retry a draining pod', async () => {
    worker = await fakeWorker((_req, res) =>
      json(res, 503, { code: 'draining' }),
    );
    await expect(client(worker.url).run(params)).resolves.toBeNull();
    expect(worker.requests).toHaveLength(1);
  });

  it('fails a query nobody takes when overflow is refuse', async () => {
    worker = await fakeWorker((_req, res) => json(res, 503, { code: 'busy' }));
    const result = await client(worker.url, 'refuse').run(params);
    expect(result?.exitCode).toBe(1);
    expect(result?.output).toContain('"code":"busy"');
  });

  it('leaves the query to a Job when no worker answers', async () => {
    worker = await fakeWorker(() => undefined);
    const url = worker.url;
    await worker.close();
    worker = null;
    await expect(client(url).run(params)).resolves.toBeNull();
  });

  it('leaves the query to a Job when the worker refuses the token', async () => {
    worker = await fakeWorker((_req, res) =>
      json(res, 401, { code: 'unauthorized' }),
    );
    await expect(client(worker.url).run(params)).resolves.toBeNull();
  });

  it('fails, not reruns, a query whose worker went away mid-run', async () => {
    worker = await fakeWorker((req) => req.socket.destroy());
    const result = await client(worker.url).run(params);
    expect(result?.exitCode).toBe(1);
    expect(result?.output).toContain('stopped answering');
    expect(worker.requests).toHaveLength(1);
  });

  it('cancels by dropping the request, which the worker sees', async () => {
    let closed!: () => void;
    const seen = new Promise<void>((resolve) => (closed = resolve));
    worker = await fakeWorker((req) => req.socket.on('close', () => closed()));
    const queries = client(worker.url);
    const running = queries.run(params);
    await new Promise((r) => setTimeout(r, 100));
    expect(queries.cancel('run-1')).toBe(true);
    await expect(running).resolves.toEqual({
      output: '',
      exitCode: 1,
      worker: null,
    });
    await seen;
    expect(queries.cancel('run-1')).toBe(false);
  });

  it.each([
    [{ outcome: 'timeout', exitCode: null, payload: null }, /"code":"timeout"/],
    [{ outcome: 'crashed', exitCode: -9, payload: null }, /ran out of memory/],
    [{ outcome: 'crashed', exitCode: 3, payload: null }, /exit 3/],
    [{ outcome: 'stopped', exitCode: null, payload: null }, /shut down/],
  ])('says what happened when no payload came (%o)', async (answer, text) => {
    worker = await fakeWorker((_req, res) => json(res, 200, answer));
    const result = await client(worker.url).run(params);
    expect(result?.exitCode).toBe(1);
    expect(result?.output.startsWith(QUERY_RESULT_MARKER)).toBe(true);
    expect(result?.output).toMatch(text);
  });
});
