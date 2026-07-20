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
import { CustomDetectorsService } from './custom-detectors.service';
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
    private readonly customDetectorsService: CustomDetectorsService,
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

  async getScenarioInput(
    detectorId: string,
    scenarioId: string,
  ): Promise<string> {
    const scenario = await this.prisma.customDetectorTestScenario.findFirst({
      where: { id: scenarioId, detectorId },
      select: { inputText: true },
    });
    if (!scenario) {
      throw new NotFoundException(`Test scenario ${scenarioId} not found`);
    }
    return scenario.inputText;
  }

  // ── Run ───────────────────────────────────────────────────────────────────

  async runScenarios(
    detectorId: string,
    triggeredBy: TestTrigger = 'MANUAL',
    scenarioIds?: string[],
  ): Promise<RunTestsResponseDto> {
    const detector = await this.prisma.customDetector.findUnique({
      where: { id: detectorId },
      include: {
        testScenarios: {
          ...(scenarioIds && scenarioIds.length > 0
            ? { where: { id: { in: scenarioIds } } }
            : {}),
          orderBy: { createdAt: 'asc' },
        },
      },
      // key and name are on the model but not in `include` — they come from select
      // by default all scalar fields are returned by findUnique
    });

    if (!detector) {
      throw new NotFoundException(`Detector ${detectorId} not found`);
    }

    if (scenarioIds && scenarioIds.length > 0) {
      const found = new Set(detector.testScenarios.map((s) => s.id));
      const missing = scenarioIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        throw new NotFoundException(
          `Test scenario(s) not found for detector ${detectorId}: ${missing.join(', ')}`,
        );
      }
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
        scenario: this.toScenarioDto({ ...scenario, results: [result] }),
        result: this.toResultDto(result),
      });
    }

    return {
      detectorId,
      triggeredBy,
      results,
      summary: { total: results.length, passed, failed, errored },
    };
  }

  /**
   * Evaluate a detector pipeline against ad-hoc sample text (no saved scenario).
   * Used by the detector-authoring agent to verify that a saved detector — or a
   * draft pipeline schema before it is ever created — actually fires.
   */
  async evaluateSample(
    detector: {
      key: string;
      name: string;
      pipelineSchema: Record<string, unknown>;
      aiProviderConfigId?: string | null;
    },
    sampleText: string,
  ): Promise<Record<string, unknown>> {
    const pipelineSchema =
      await this.customDetectorsService.injectLlmProviderRuntime(
        detector.pipelineSchema,
        detector.aiProviderConfigId ?? null,
      );
    return this.evaluateViaCli({ ...detector, pipelineSchema }, sampleText);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async runOneScenario(
    detector: {
      id: string;
      key: string;
      name: string;
      pipelineSchema: unknown;
      aiProviderConfigId: string | null;
      version: number;
    },
    scenario: { id: string; inputText: string; expectedOutcome: unknown },
    triggeredBy: TestTrigger,
  ) {
    const start = Date.now();

    try {
      // LLM detectors need resolved provider credentials injected before
      // dispatch — the same step the real scan path performs. Without it the
      // CLI drops the detector and reports zero findings with no error.
      const pipelineSchema =
        await this.customDetectorsService.injectLlmProviderRuntime(
          detector.pipelineSchema as Record<string, unknown>,
          detector.aiProviderConfigId,
        );
      const actualOutput = await this.evaluateViaCli(
        {
          key: detector.key,
          name: detector.name,
          pipelineSchema,
        },
        scenario.inputText,
        { detectorId: detector.id, scenarioId: scenario.id },
      );

      const expected = scenario.expectedOutcome as Record<string, unknown>;
      const schema = detector.pipelineSchema as Record<string, unknown>;
      const { status, explanation } = this.compareOutcome(
        schema,
        expected,
        actualOutput,
      );

      const result = await this.prisma.customDetectorTestResult.create({
        data: {
          scenarioId: scenario.id,
          detectorId: detector.id,
          status,
          actualOutput: actualOutput as any,
          // On FAIL, errorMessage carries the expected-vs-actual explanation so
          // the result is diagnosable without reverse-engineering the comparator.
          errorMessage: status === 'FAIL' ? explanation : null,
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

  private async evaluateViaCli(
    detector: {
      key: string;
      name: string;
      pipelineSchema: Record<string, unknown>;
    },
    inputText: string,
    scenario?: { detectorId: string; scenarioId: string },
  ): Promise<Record<string, unknown>> {
    const runId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const detectorEntry = {
      type: 'CUSTOM',
      enabled: true,
      config: {
        custom_detector_key: detector.key,
        name: detector.name,
        pipeline_schema: detector.pipelineSchema,
      },
    };

    let stdout: string;

    if (this.kubernetesCliJobService?.isEnabled() && scenario) {
      const baseUrl = (
        process.env.CLASSIFYRE_INTERNAL_API_URL ||
        process.env.CLASSIFYRE_OUTPUT_REST_URL ||
        'http://127.0.0.1:8000'
      ).replace(/\/$/, '');
      const inputUrl = `${baseUrl}/custom-detectors/${encodeURIComponent(scenario.detectorId)}/test-scenarios/${encodeURIComponent(scenario.scenarioId)}/input`;
      const result = await this.kubernetesCliJobService.runFileEvaluationJob({
        evaluationId: scenario.scenarioId,
        inputUrl,
        fileExtension: '.txt',
        detectors: [detectorEntry],
      });
      if (result.exitCode !== 0) {
        throw new Error(
          `CLI exited with code ${result.exitCode}: ${result.output}`,
        );
      }
      stdout = result.output;
    } else {
      // Local mode: write temp files and run CLI subprocess directly.
      const tmpDir = process.env.TEMP_DIR || os.tmpdir();
      const textFile = path.join(tmpDir, `detector-test-${runId}.txt`);
      const detectorsFile = path.join(
        tmpDir,
        `detector-test-${runId}-detectors.json`,
      );
      try {
        await fs.mkdir(tmpDir, { recursive: true });
        await fs.writeFile(textFile, inputText, 'utf8');
        await fs.writeFile(
          detectorsFile,
          JSON.stringify([detectorEntry], null, 2),
        );
        const cliPath = this.getCliPath();
        // Desktop relocates the venv out of the bundle; VENV_PATH points at it.
        const venvPath = process.env.VENV_PATH
          ? path.normalize(process.env.VENV_PATH)
          : path.join(cliPath, '.venv');
        const venvPython =
          process.platform === 'win32'
            ? path.join(venvPath, 'Scripts', 'python.exe')
            : path.join(venvPath, 'bin', 'python');
        const command =
          `cd ${shellEscape(cliPath)} && ` +
          `uv run --locked --no-dev --python ${shellEscape(venvPython)} ` +
          `python -m src.main evaluate-file ${shellEscape(textFile)} --detectors-file ${shellEscape(detectorsFile)}`;

        // Allow up to 3 min: first run installs optional dep groups + loads
        // the model into memory, which can take 90–120 s on a cold start.
        // Subsequent runs reuse the cached model and finish in ~10–15 s.
        const result = await execAsync(command, { timeout: 180_000 });
        stdout = result.stdout;
      } finally {
        await fs.unlink(textFile).catch(() => undefined);
        await fs.unlink(detectorsFile).catch(() => undefined);
      }
    }

    const parsed = parseCliOutput(stdout);

    // The CLI logs-and-drops detectors that fail to initialize (bad schema,
    // missing credentials) and still exits 0 — surface that as an error
    // instead of reporting a clean zero-findings result.
    if (parsed.detectorErrors.length > 0) {
      throw new Error(
        `Detector failed to initialize in CLI: ${parsed.detectorErrors.join('; ')}`,
      );
    }

    return {
      findings: parsed.findings,
      findingsCount: parsed.findings.length,
      matched: parsed.findings.length > 0,
    };
  }

  private getCliPath(): string {
    if (process.env.CLI_PATH) {
      const raw = process.env.CLI_PATH;
      if (path.isAbsolute(raw)) return raw;
      const apiRoot = path.resolve(__dirname, '../..');
      return path.resolve(apiRoot, raw);
    }
    const env = process.env.ENVIRONMENT || 'development';
    if (env === 'development' || env === 'desktop') {
      return path.join(__dirname, '../../../cli');
    }
    throw new Error(
      'Local detector execution is only available in development or desktop mode',
    );
  }

  // Compare expected vs actual — returns PASS/FAIL plus a human-readable
  // explanation of any mismatch. Dispatches on pipeline schema type; falls
  // back to expected outcome shape. Accepts both the flat scenario shapes
  // ({shouldMatch}, {label, minConfidence}, {entities: [{label, text}]}) and
  // the nested pipeline-output shape
  // ({classification: {task: {label, confidence}}}, {entities: {label: [{value}]}}).
  private compareOutcome(
    pipelineSchema: Record<string, unknown>,
    rawExpected: Record<string, unknown>,
    actual: Record<string, unknown>,
  ): { status: 'PASS' | 'FAIL'; explanation: string | null } {
    const schemaType = (pipelineSchema.type as string | undefined) ?? '';
    const expected = normalizeExpectedOutcome(rawExpected);
    const findings = Array.isArray(actual.findings) ? actual.findings : [];

    if (schemaType === 'REGEX') {
      const shouldMatch = Boolean(expected.shouldMatch);
      const didMatch = Boolean(actual.matched);
      if (shouldMatch === didMatch)
        return { status: 'PASS', explanation: null };
      return {
        status: 'FAIL',
        explanation: shouldMatch
          ? 'Expected the pattern to match, but no findings were produced.'
          : `Expected no match, but ${findings.length} finding(s) were produced: ${summarizeFindings(findings)}.`,
      };
    }

    // For GLINER2/LLM and unknown types: infer comparison from expected shape.
    if ('label' in expected) {
      const expectedLabel = normalizeLabel(
        (expected.label as string | undefined) ?? '',
      );
      const minConf =
        typeof expected.minConfidence === 'number' ? expected.minConfidence : 0;

      const hit = findings.some((f: unknown) => {
        const finding = f as Record<string, unknown>;
        const metadata =
          (finding.metadata as Record<string, unknown> | undefined) ?? {};

        // finding_type uses the label_id with "class:" prefix, e.g.
        // "class:european_country". Both sides are normalised (lowercase,
        // underscores → spaces) so "european_country", "European country"
        // and "european country" all compare equal.
        const rawType =
          (finding.finding_type as string | undefined) ??
          (finding.findingType as string | undefined) ??
          '';
        const normalizedType = normalizeLabel(rawType.replace(/^class:/i, ''));

        // metadata.label_name carries the original human-readable label name
        // (e.g. "European country"). Fall back to top-level label_name for
        // older CLI output formats that emitted it there directly.
        const labelName = normalizeLabel(
          (metadata.label_name as string | undefined) ??
            (finding.label_name as string | undefined) ??
            '',
        );

        const labelMatch =
          normalizedType === expectedLabel || labelName === expectedLabel;
        const conf =
          typeof finding.confidence === 'number' ? finding.confidence : 1;
        return labelMatch && conf >= minConf;
      });

      if (hit) return { status: 'PASS', explanation: null };
      return {
        status: 'FAIL',
        explanation:
          `Expected a finding labeled "${String(expected.label)}"` +
          (minConf > 0 ? ` with confidence >= ${minConf}` : '') +
          (findings.length > 0
            ? `; actual findings: ${summarizeFindings(findings)}.`
            : '; no findings were produced.'),
      };
    }

    if ('entities' in expected) {
      const expectedEntities = Array.isArray(expected.entities)
        ? (expected.entities as Array<Record<string, unknown>>)
        : [];

      const missing = expectedEntities.filter((exp) => {
        const expLabel = normalizeLabel(
          (exp.label as string | undefined) ?? '',
        );
        const expText = exp.text
          ? ((exp.text as string) ?? '').toLowerCase()
          : null;

        return !findings.some((f: unknown) => {
          const finding = f as Record<string, unknown>;
          const rawType =
            (finding.finding_type as string | undefined) ??
            (finding.findingType as string | undefined) ??
            '';
          // CLI prefixes ENTITY finding types with "entity:" (e.g. "entity:PERSON").
          // Strip it, then normalise both sides identically before comparing.
          const normalizedType = normalizeLabel(
            rawType.replace(/^entity:/i, ''),
          );
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

      if (missing.length === 0) return { status: 'PASS', explanation: null };
      const missingDesc = missing
        .map((m) => {
          const label = (m.label as string | undefined) ?? '?';
          const text = m.text as string | undefined;
          return `"${label}"${text ? ` containing "${text}"` : ''}`;
        })
        .join(', ');
      return {
        status: 'FAIL',
        explanation:
          `Expected entity/entities not found: ${missingDesc}` +
          (findings.length > 0
            ? `; actual findings: ${summarizeFindings(findings)}.`
            : '; no findings were produced.'),
      };
    }

    return {
      status: 'FAIL',
      explanation:
        'Unrecognized expected_outcome shape. Use {"shouldMatch": true|false} for REGEX, ' +
        '{"label": "...", "minConfidence": 0.6} for classifier/LLM detectors, or ' +
        '{"entities": [{"label": "...", "text": "..."}]} for entity detectors ' +
        '(the nested pipeline-output shape {"classification": {task: {label, confidence}}} / ' +
        '{"entities": {label: [{value}]}} is also accepted).',
    };
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

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// Labels compare case-insensitively with underscores treated as spaces, so
// "market_gaming_instruction" and "Market gaming instruction" are equal.
function normalizeLabel(s: string): string {
  return s.toLowerCase().trim().replace(/_/g, ' ');
}

/**
 * Normalize an expected outcome to the flat comparator shapes. Scenarios may
 * be written in the nested pipeline-output shape
 * ({classification: {task: {label, confidence}}}, {entities: {label: [{value}]}});
 * fold those into the flat {label, minConfidence} / {entities: [{label, text}]}
 * forms the comparator reads. Flat inputs pass through unchanged.
 */
function normalizeExpectedOutcome(
  expected: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...expected };

  const classification = expected.classification;
  if (
    !('label' in out) &&
    classification &&
    typeof classification === 'object' &&
    !Array.isArray(classification)
  ) {
    const tasks = Object.values(classification as Record<string, unknown>);
    const first = tasks.find(
      (t): t is Record<string, unknown> =>
        !!t && typeof t === 'object' && 'label' in t,
    );
    if (first) {
      out.label = first.label;
      if (
        typeof first.confidence === 'number' &&
        out.minConfidence === undefined
      ) {
        out.minConfidence = first.confidence;
      }
    }
  }

  const entities = out.entities;
  if (entities && typeof entities === 'object' && !Array.isArray(entities)) {
    const flat: Array<Record<string, unknown>> = [];
    for (const [label, matches] of Object.entries(
      entities as Record<string, unknown>,
    )) {
      if (Array.isArray(matches) && matches.length > 0) {
        for (const m of matches) {
          const rec =
            m && typeof m === 'object' ? (m as Record<string, unknown>) : {};
          flat.push({ label, text: rec.text ?? rec.value });
        }
      } else {
        flat.push({ label });
      }
    }
    out.entities = flat;
  }

  return out;
}

// Compact one-line description of actual findings for FAIL explanations.
function summarizeFindings(findings: unknown[], limit = 5): string {
  const parts = findings.slice(0, limit).map((f) => {
    const finding = (f ?? {}) as Record<string, unknown>;
    const type =
      (finding.finding_type as string | undefined) ??
      (finding.findingType as string | undefined) ??
      'unknown';
    const conf =
      typeof finding.confidence === 'number'
        ? ` (${finding.confidence.toFixed(2)})`
        : '';
    return `${type}${conf}`;
  });
  const more =
    findings.length > limit ? ` and ${findings.length - limit} more` : '';
  return `[${parts.join(', ')}]${more}`;
}

function parseCliOutput(stdout: string): {
  findings: unknown[];
  detectorErrors: string[];
} {
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
        const record = parsed as Record<string, unknown>;
        return {
          findings: record.findings as unknown[],
          detectorErrors: Array.isArray(record.detector_errors)
            ? (record.detector_errors as unknown[]).map(String)
            : [],
        };
      }
    } catch {
      // not JSON
    }
  }
  return { findings: [], detectorErrors: [] };
}
