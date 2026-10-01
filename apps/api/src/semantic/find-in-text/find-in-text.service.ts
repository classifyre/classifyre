import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { CustomDetectorsService } from '../../custom-detectors.service';
import { CustomDetectorTestsService } from '../../custom-detector-tests.service';
import { recordGlossaryActivity } from '../../glossary/glossary-activity';
import { BindingsService } from '../bindings/bindings.service';
import {
  FindInTextOptions,
  LabelChoice,
  buildFindInTextPattern,
  buildFindInTextScenarios,
  defaultLabels,
  hasUnprotectedScript,
  termLabelsHash,
} from './find-in-text';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

export interface FindInTextInput {
  labels?: LabelChoice[];
  wholeWords?: boolean;
  continuations?: boolean;
  severity?: string;
  sourceIds?: string[];
  /** Run the generated tests now (they shell out to the CLI evaluator). */
  runTests?: boolean;
  actor?: string;
}

/**
 * "Find in text" (SL2 §7, D10): turn a concept that appears only as words into
 * an ordinary, tested REGEX custom detector, bound to the term. No new engine —
 * the generated detector gets tests, scope, feedback and the scan cache like
 * any other, and a scan of an attached source re-runs only it on cached assets.
 */
@Injectable()
export class FindInTextService {
  private readonly logger = new Logger(FindInTextService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly detectors: CustomDetectorsService,
    private readonly tests: CustomDetectorTestsService,
    private readonly bindings: BindingsService,
  ) {}

  private async term(termId: string) {
    const term =
      (await this.prisma.glossaryTerm.findUnique({ where: { id: termId } })) ??
      (await this.prisma.glossaryTerm.findUnique({ where: { key: termId } }));
    if (!term) throw new NotFoundException(`Glossary term ${termId} not found`);
    return term;
  }

  /** What the dialog shows before anything is created: labels, pattern, tests. */
  async preview(termId: string, input: FindInTextInput = {}) {
    const term = await this.term(termId);
    const defaults = defaultLabels(term);
    const labels = input.labels?.length
      ? this.mergeLabels(defaults.labels, input.labels)
      : defaults.labels;
    const options: FindInTextOptions = {
      wholeWords: input.wholeWords ?? true,
      continuations: input.continuations ?? false,
    };
    let pattern: string | null = null;
    let error: string | null = null;
    try {
      pattern = buildFindInTextPattern(labels, options);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const scenarios = buildFindInTextScenarios(
      labels,
      defaults.excluded.map((e) => e.value),
      options,
    );
    const existing = await this.prisma.customDetector.findMany({
      where: { generatedFromTermId: term.id },
      select: { id: true, key: true, name: true, generatedLabelsHash: true },
    });
    return {
      term: {
        id: term.id,
        key: term.key,
        term: term.term,
        kind: term.kind,
        status: term.status,
      },
      labels,
      excluded: defaults.excluded,
      options,
      pattern,
      error,
      scenarios,
      warnings: labels
        .filter((label) => label.checked && hasUnprotectedScript(label.value))
        .map((label) => ({
          code: 'UNPROTECTED_SCRIPT',
          message: `"${label.value}" contains letters outside Latin; word boundaries are not protected for it in v1.`,
        })),
      detectors: existing.map((d) => ({
        ...d,
        outOfDate: d.generatedLabelsHash !== termLabelsHash(term),
      })),
    };
  }

  /** Labels the caller chose, validated against what the term actually has. */
  private mergeLabels(
    defaults: LabelChoice[],
    chosen: LabelChoice[],
  ): LabelChoice[] {
    const allowed = new Map(defaults.map((d) => [`${d.type}:${d.value}`, d]));
    const out: LabelChoice[] = [];
    for (const label of chosen) {
      const known = allowed.get(`${label.type}:${label.value}`);
      if (!known) {
        throw new BadRequestException(
          `"${label.value}" is not a label of this term. Hidden aliases are never matched in text.`,
        );
      }
      out.push({ ...known, checked: Boolean(label.checked) });
    }
    for (const d of defaults) {
      if (!out.some((o) => o.type === d.type && o.value === d.value)) {
        out.push({ ...d, checked: false });
      }
    }
    return out;
  }

  async create(termId: string, input: FindInTextInput = {}) {
    const term = await this.term(termId);
    const preview = await this.preview(termId, input);
    if (!preview.pattern)
      throw new BadRequestException(preview.error ?? 'No pattern');
    const severity = (input.severity ?? 'info').toLowerCase();
    if (!SEVERITIES.includes(severity)) {
      throw new BadRequestException(
        `severity is one of ${SEVERITIES.join(', ')}`,
      );
    }
    const patternName = term.key;
    const pipelineSchema = {
      type: 'REGEX',
      patterns: {
        [patternName]: {
          pattern: preview.pattern,
          group: 1,
          severity,
          case_sensitive: true,
          description: `Labels of the glossary term "${term.term}" (${term.key}).`,
        },
      },
    };
    const key = `glossary-${term.key}`
      .replace(/[^a-z0-9_-]+/g, '_')
      .slice(0, 120);
    const existing = await this.prisma.customDetector.findUnique({
      where: { key },
    });
    let detectorId: string;
    let detectorKey: string;
    if (existing) {
      // Regenerating: a new version, so the scan cache re-runs it.
      const updated = await this.detectors.update(existing.id, {
        pipelineSchema,
        description: `Generated by "Find in text" from the glossary term ${term.term}.`,
      });
      detectorId = updated.id;
      detectorKey = updated.key;
      await this.prisma.customDetector.update({
        where: { id: existing.id },
        data: {
          generatedFromTermId: term.id,
          generatedLabelsHash: termLabelsHash(term),
        },
      });
      await this.prisma.customDetectorTestScenario.deleteMany({
        where: { detectorId },
      });
    } else {
      const created = await this.detectors.create({
        name: `Find: ${term.term}`.slice(0, 200),
        key,
        description: `Generated by "Find in text" from the glossary term ${term.term}.`,
        pipelineSchema,
        isActive: true,
      });
      detectorId = created.id;
      detectorKey = created.key;
      await this.prisma.customDetector.update({
        where: { id: detectorId },
        data: {
          generatedFromTermId: term.id,
          generatedLabelsHash: termLabelsHash(term),
        },
      });
    }

    for (const scenario of preview.scenarios) {
      await this.tests.createScenario(detectorId, {
        name: scenario.name.slice(0, 200),
        description: 'Generated by "Find in text".',
        inputText: scenario.inputText,
        expectedOutcome: { shouldMatch: scenario.shouldMatch },
      });
    }
    let testResults: unknown = null;
    if (input.runTests) {
      try {
        testResults = await this.tests.runScenarios(detectorId, 'MANUAL');
      } catch (error) {
        testResults = {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    // The binding: OUTPUT (CUSTOM, <key>, regex:<term-key>) → term.
    let bindingId: string | null = null;
    try {
      const binding = await this.bindings.create(
        {
          mode: 'OUTPUT',
          output: {
            detectorType: 'CUSTOM',
            customDetectorKey: detectorKey,
            findingType: `regex:${patternName}`,
          },
          termId: term.id,
        },
        {
          origin: 'OPERATOR',
          status: 'APPROVED',
          actor: input.actor ?? 'operator',
          note: 'Generated by "Find in text".',
        },
      );
      bindingId = binding.id;
    } catch (error) {
      const response = (error as { response?: { bindingId?: string } })
        .response;
      if (response?.bindingId) bindingId = response.bindingId;
      else throw error;
    }

    const attached: string[] = [];
    for (const sourceId of input.sourceIds ?? []) {
      const source = await this.prisma.source.findUnique({
        where: { id: sourceId },
      });
      if (!source) continue;
      const config = (source.config ?? {}) as Record<string, unknown>;
      const ids = Array.isArray(config.custom_detectors)
        ? (config.custom_detectors as unknown[]).map(String)
        : [];
      if (!ids.includes(detectorId)) {
        await this.prisma.source.update({
          where: { id: sourceId },
          data: {
            config: {
              ...config,
              custom_detectors: [...ids, detectorId],
            },
          },
        });
      }
      attached.push(sourceId);
    }

    await recordGlossaryActivity(this.prisma, {
      type: 'BINDING_CREATED',
      termId: term.id,
      bindingId,
      actor: input.actor ?? 'operator',
      payload: {
        findInText: true,
        detectorId,
        detectorKey,
        pattern: preview.pattern,
        options: { ...preview.options },
        labels: preview.labels
          .filter((l) => l.checked)
          .map((l) => `${l.type}:${l.value}`),
        attached,
      },
    });
    return {
      customDetectorId: detectorId,
      customDetectorKey: detectorKey,
      bindingId,
      pattern: preview.pattern,
      scenarios: preview.scenarios.length,
      testResults,
      attachedSourceIds: attached,
    };
  }

  /** Generated detectors for a term, with "out of date" and "edited by hand" flags. */
  async status(termId: string) {
    const term = await this.term(termId);
    const rows = await this.prisma.customDetector.findMany({
      where: { generatedFromTermId: term.id },
    });
    const out: Array<{
      id: string;
      key: string;
      name: string;
      isActive: boolean;
      version: number;
      outOfDate: boolean;
      editedByHand: boolean;
      deprecatedTerm: boolean;
    }> = [];
    for (const row of rows) {
      const generated = await this.prisma.glossaryActivity.findFirst({
        where: {
          termId: term.id,
          type: 'BINDING_CREATED',
          payload: { path: ['detectorId'], equals: row.id },
        },
        orderBy: { createdAt: 'desc' },
      });
      const schema = row.pipelineSchema as {
        pipeline_schema?: { patterns?: Record<string, { pattern?: string }> };
      } & {
        patterns?: Record<string, { pattern?: string }>;
      };
      const patterns =
        schema.pipeline_schema?.patterns ?? schema.patterns ?? {};
      const current = patterns[term.key]?.pattern ?? null;
      const recorded =
        (generated?.payload as { pattern?: string } | null)?.pattern ?? null;
      out.push({
        id: row.id,
        key: row.key,
        name: row.name,
        isActive: row.isActive,
        version: row.version,
        outOfDate: row.generatedLabelsHash !== termLabelsHash(term),
        editedByHand: Boolean(recorded && current && recorded !== current),
        deprecatedTerm: term.status === 'DEPRECATED',
      });
    }
    return out;
  }
}
