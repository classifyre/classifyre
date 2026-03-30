import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PrismaService } from './prisma.service';
import { KubernetesCliJobService } from './cli-runner/kubernetes-cli-job.service';
import {
  createTestScenarioSchema,
  type RunTestsResponseDto,
  type TestResultDto,
  type TestScenarioDto,
  type TestTrigger,
} from './dto/custom-detector-tests.dto';

const execAsync = promisify(exec);

@Injectable()
export class CustomDetectorTestsService {
  private readonly logger = new Logger(CustomDetectorTestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly kubernetesCliJobService?: KubernetesCliJobService,
  ) {}

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async listScenarios(detectorId: string): Promise<TestScenarioDto[]> {
    await this.assertDetectorExists(detectorId);

    const rows = await this.prisma.customDetectorTestScenario.findMany({
      where: { detectorId },
      orderBy: { createdAt: 'asc' },
      include: {
        results: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    return rows.map((row) => this.toScenarioDto(row));
  }

  async createScenario(
    detectorId: string,
    body: unknown,
  ): Promise<TestScenarioDto> {
    await this.assertDetectorExists(detectorId);
    const dto = createTestScenarioSchema.parse(body);

    const row = await this.prisma.customDetectorTestScenario.create({
      data: {
        detectorId,
        name: dto.name,
        description: dto.description,
        inputText: dto.inputText,
        expectedOutcome: dto.expectedOutcome as any,
      },
      include: { results: { take: 0 } },
    });

    return this.toScenarioDto({ ...row, results: [] });
  }

  async deleteScenario(detectorId: string, scenarioId: string): Promise<void> {
    const row = await this.prisma.customDetectorTestScenario.findUnique({
      where: { id: scenarioId },
    });
    if (!row || row.detectorId !== detectorId) {
      throw new NotFoundException(`Test scenario ${scenarioId} not found`);
    }
    await this.prisma.customDetectorTestScenario.delete({
      where: { id: scenarioId },
    });
  }

  // ── Run ───────────────────────────────────────────────────────────────────

  async runScenarios(
    detectorId: string,
    triggeredBy: TestTrigger = 'MANUAL',
  ): Promise<RunTestsResponseDto> {
    const detector = await this.prisma.customDetector.findUnique({
      where: { id: detectorId },
      include: {
        testScenarios: {
          orderBy: { createdAt: 'asc' },
        },
      },
      // key and name are on the model but not in `include` — they come from select
      // by default all scalar fields are returned by findUnique
    });

    if (!detector) {
      throw new NotFoundException(`Detector ${detectorId} not found`);
    }

    const results: RunTestsResponseDto['results'] = [];
    let passed = 0;
    let failed = 0;
    let errored = 0;

    for (const scenario of detector.testScenarios) {
      const result = await this.runOneScenario(detector, scenario, triggeredBy);

      if (result.status === 'PASS') passed++;
      else if (result.status === 'FAIL') failed++;
      else errored++;

      results.push({
        scenario: this.toScenarioDto({ ...scenario, results: [result as any] }),
        result: this.toResultDto(result as any),
      });
    }

    return {
      detectorId,
      triggeredBy,
      results,
      summary: { total: results.length, passed, failed, errored },
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async runOneScenario(
    detector: {
      id: string;
      key: string;
      name: string;
      method: string;
      config: unknown;
      version: number;
    },
    scenario: { id: string; inputText: string; expectedOutcome: unknown },
    triggeredBy: TestTrigger,
  ) {
    const start = Date.now();

    try {
      let actualOutput: Record<string, unknown>;

      if (detector.method === 'RULESET') {
        actualOutput = this.evaluateRuleset(
          detector.config as Record<string, unknown>,
          scenario.inputText,
        );
      } else {
        actualOutput = await this.evaluateViaCli(
          {
            key: detector.key,
            name: detector.name,
            method: detector.method,
            config: detector.config as Record<string, unknown>,
          },
          scenario.inputText,
        );
      }

      const expected = scenario.expectedOutcome as Record<string, unknown>;
      const status = this.compareOutcome(
        detector.method,
        expected,
        actualOutput,
      );

      const result = await this.prisma.customDetectorTestResult.create({
        data: {
          scenarioId: scenario.id,
          detectorId: detector.id,
          status,
          actualOutput: actualOutput as any,
          durationMs: Date.now() - start,
          detectorVersion: detector.version,
          triggeredBy,
        },
      });

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(`Test scenario ${scenario.id} errored: ${errorMessage}`);

      const result = await this.prisma.customDetectorTestResult.create({
        data: {
          scenarioId: scenario.id,
          detectorId: detector.id,
          status: 'ERROR',
          actualOutput: { error: errorMessage },
          errorMessage,
          durationMs: Date.now() - start,
          detectorVersion: detector.version,
          triggeredBy,
        },
      });

      return result;
    }
  }

  // RULESET: evaluate in-process — fast, deterministic, no CLI needed
  private evaluateRuleset(
    config: Record<string, unknown>,
    inputText: string,
  ): Record<string, unknown> {
    const ruleset = (config.ruleset ?? {}) as Record<string, unknown>;
    const regexRules = Array.isArray(ruleset.regex_rules)
      ? (ruleset.regex_rules as Array<Record<string, unknown>>)
      : [];
    const keywordRules = Array.isArray(ruleset.keyword_rules)
      ? (ruleset.keyword_rules as Array<Record<string, unknown>>)
      : [];

    const firedRules: Array<{ id: string; name: string; type: string }> = [];

    for (const rule of regexRules) {
      const id = (rule.id as string | undefined) ?? '';
      const name = (rule.name as string | undefined) ?? '';
      const pattern = (rule.pattern as string | undefined) ?? '';
      const flags = (rule.flags as string | undefined) ?? '';

      try {
        const regex = new RegExp(pattern, flags);
        if (regex.test(inputText)) {
          firedRules.push({ id, name, type: 'regex' });
        }
      } catch {
        // invalid regex — skip
      }
    }

    for (const rule of keywordRules) {
      const id = (rule.id as string | undefined) ?? '';
      const name = (rule.name as string | undefined) ?? '';
      const caseSensitive = Boolean(rule.case_sensitive ?? false);
      const keywords = Array.isArray(rule.keywords)
        ? (rule.keywords as string[])
        : [];

      const flags = caseSensitive ? '' : 'i';
      const hit = keywords.some((kw) => {
        try {
          return new RegExp(`\\b${escapeRegex(kw)}\\b`, flags).test(inputText);
        } catch {
          return false;
        }
      });

      if (hit) {
        firedRules.push({ id, name, type: 'keyword' });
      }
    }

    return {
      matched: firedRules.length > 0,
      firedRules,
      totalRules: regexRules.length + keywordRules.length,
    };
  }

  // CLASSIFIER / ENTITY: write temp file and call CLI sandbox via K8s job or local process
  private async evaluateViaCli(
    detector: {
      key: string;
      name: string;
      method: string;
      config: Record<string, unknown>;
    },
    inputText: string,
  ): Promise<Record<string, unknown>> {
    const runId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const useK8s = this.kubernetesCliJobService?.isEnabled() ?? false;

    const tmpDir = useK8s
      ? this.getDetectorTestSharedDir(runId)
      : process.env.TEMP_DIR || os.tmpdir();

    const textFile = path.join(
      tmpDir,
      useK8s ? 'input.txt' : `detector-test-${runId}.txt`,
    );
    const detectorsFile = path.join(
      tmpDir,
      useK8s ? 'detectors.json' : `detector-test-${runId}-detectors.json`,
    );

    try {
      await fs.mkdir(tmpDir, { recursive: true });
      await fs.writeFile(textFile, inputText, 'utf8');

      // Use the same detectors.json format as the sandbox runner.
      // CLI CustomDetectorConfig requires custom_detector_key, name, and method
      // inside the `config` dict.
      const detectorEntry = {
        type: 'CUSTOM',
        enabled: true,
        config: {
          ...detector.config,
          custom_detector_key: detector.key,
          name: detector.name,
          method: detector.method,
        },
      };
      await fs.writeFile(
        detectorsFile,
        JSON.stringify([detectorEntry], null, 2),
      );

      let stdout: string;

      if (useK8s) {
        const result = await this.kubernetesCliJobService!.runSandboxJob({
          runId,
          inputFilePath: textFile,
          detectorsFilePath: detectorsFile,
        });
        if (result.exitCode !== 0) {
          throw new Error(
            `CLI exited with code ${result.exitCode}: ${result.output}`,
          );
        }
        stdout = result.output;
      } else {
        const cliPath = this.getCliPath();
        const venvPython = path.join(cliPath, '.venv', 'bin', 'python');
        const command =
          `cd ${shellEscape(cliPath)} && ` +
          `uv run --locked --python ${shellEscape(venvPython)} ` +
          `python -m src.main sandbox ${shellEscape(textFile)} --detectors-file ${shellEscape(detectorsFile)}`;

        const result = await execAsync(command, { timeout: 60_000 });
        stdout = result.stdout;
      }

      const parsed = parseCliOutput(stdout);

      return {
        findings: parsed.findings,
        findingsCount: parsed.findings.length,
        matched: parsed.findings.length > 0,
      };
    } finally {
      if (useK8s) {
        await fs
          .rm(tmpDir, { recursive: true, force: true })
          .catch(() => undefined);
      } else {
        await fs.unlink(textFile).catch(() => undefined);
        await fs.unlink(detectorsFile).catch(() => undefined);
      }
    }
  }

  private getDetectorTestSharedDir(runId: string): string {
    const rootDir = path.resolve(
      process.env.RUNNER_LOGS_DIR ||
        path.join(process.cwd(), 'var', 'runner-logs'),
    );
    return path.join(rootDir, 'detector-tests', runId);
  }

  private getCliPath(): string {
    if (process.env.CLI_PATH) {
      const raw = process.env.CLI_PATH;
      if (path.isAbsolute(raw)) return raw;
      const apiRoot = path.resolve(__dirname, '../..');
      return path.resolve(apiRoot, raw);
    }
    const env = process.env.ENVIRONMENT || 'development';
    return env === 'development'
      ? path.join(__dirname, '../../../cli')
      : '/app/cli';
  }

  // Compare expected vs actual — returns PASS or FAIL
  private compareOutcome(
    method: string,
    expected: Record<string, unknown>,
    actual: Record<string, unknown>,
  ): 'PASS' | 'FAIL' {
    if (method === 'RULESET') {
      const shouldMatch = Boolean(expected.shouldMatch);
      const didMatch = Boolean(actual.matched);
      return shouldMatch === didMatch ? 'PASS' : 'FAIL';
    }

    if (method === 'CLASSIFIER') {
      const expectedLabel = (
        (expected.label as string | undefined) ?? ''
      ).toLowerCase();
      const minConf =
        typeof expected.minConfidence === 'number' ? expected.minConfidence : 0;

      const findings = Array.isArray(actual.findings) ? actual.findings : [];
      const hit = findings.some((f: unknown) => {
        const finding = f as Record<string, unknown>;
        const rawType =
          (finding.finding_type as string | undefined) ??
          (finding.findingType as string | undefined) ??
          '';
        // CLI prefixes CLASSIFIER finding types with "class:" (e.g. "class:sports").
        // Strip it before comparing against the user-provided label.
        const normalizedType = rawType.toLowerCase().replace(/^class:/, '');
        const labelMatch = normalizedType === expectedLabel;
        const conf =
          typeof finding.confidence === 'number' ? finding.confidence : 1;
        return labelMatch && conf >= minConf;
      });

      return hit ? 'PASS' : 'FAIL';
    }

    if (method === 'ENTITY') {
      const expectedEntities = Array.isArray(expected.entities)
        ? (expected.entities as Array<Record<string, unknown>>)
        : [];
      const findings = Array.isArray(actual.findings) ? actual.findings : [];

      const allFound = expectedEntities.every((exp) => {
        const expLabel = (
          (exp.label as string | undefined) ?? ''
        ).toLowerCase();
        const expText = exp.text
          ? ((exp.text as string) ?? '').toLowerCase()
          : null;

        return findings.some((f: unknown) => {
          const finding = f as Record<string, unknown>;
          const rawType =
            (finding.finding_type as string | undefined) ??
            (finding.findingType as string | undefined) ??
            '';
          // CLI prefixes ENTITY finding types with "entity:" (e.g. "entity:PERSON").
          // Strip it before comparing against the user-provided label.
          const normalizedType = rawType.toLowerCase().replace(/^entity:/, '');
          const labelMatch = normalizedType === expLabel;
          if (!labelMatch) return false;
          if (expText === null) return true;
          const rawContent =
            (finding.matched_content as string | undefined) ??
            (finding.matchedContent as string | undefined) ??
            '';
          return rawContent.toLowerCase().includes(expText);
        });
      });

      return allFound ? 'PASS' : 'FAIL';
    }

    return 'FAIL';
  }

  private async assertDetectorExists(detectorId: string): Promise<void> {
    const exists = await this.prisma.customDetector.findUnique({
      where: { id: detectorId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException(`Detector ${detectorId} not found`);
    }
  }

  private toScenarioDto(row: {
    id: string;
    detectorId: string;
    name: string;
    description?: string | null;
    inputText: string;
    expectedOutcome: unknown;
    createdAt: Date;
    updatedAt: Date;
    results: Array<{
      id: string;
      scenarioId: string;
      status: string;
      actualOutput: unknown;
      errorMessage?: string | null;
      durationMs?: number | null;
      detectorVersion: number;
      triggeredBy: string;
      createdAt: Date;
    }>;
  }): TestScenarioDto {
    const lastResult = row.results[0];
    return {
      id: row.id,
      detectorId: row.detectorId,
      name: row.name,
      description: row.description,
      inputText: row.inputText,
      expectedOutcome: row.expectedOutcome as Record<string, unknown>,
      lastResult: lastResult ? this.toResultDto(lastResult) : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toResultDto(result: {
    id: string;
    scenarioId: string;
    status: string;
    actualOutput: unknown;
    errorMessage?: string | null;
    durationMs?: number | null;
    detectorVersion: number;
    triggeredBy: string;
    createdAt: Date;
  }): TestResultDto {
    return {
      id: result.id,
      scenarioId: result.scenarioId,
      status: result.status as TestResultDto['status'],
      actualOutput: result.actualOutput as Record<string, unknown>,
      errorMessage: result.errorMessage,
      durationMs: result.durationMs,
      detectorVersion: result.detectorVersion,
      triggeredBy: result.triggeredBy as TestResultDto['triggeredBy'],
      createdAt: result.createdAt.toISOString(),
    };
  }
}

// ── Pure helpers (no side effects) ───────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function parseCliOutput(stdout: string): { findings: unknown[] } {
  const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        'findings' in parsed &&
        Array.isArray((parsed as Record<string, unknown>).findings)
      ) {
        return parsed as { findings: unknown[] };
      }
    } catch {
      // not JSON
    }
  }
  return { findings: [] };
}
