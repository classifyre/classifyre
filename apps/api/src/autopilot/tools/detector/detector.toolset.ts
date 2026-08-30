import { Injectable } from '@nestjs/common';
import { AgentDecisionAction, AiManagementMode } from '@prisma/client';
import { CustomDetectorsService } from '../../../custom-detectors.service';
import { CustomDetectorTestsService } from '../../../custom-detector-tests.service';
import { DecisionApplierService } from '../../decision-applier.service';
import { AgentSearchService } from '../../search/agent-search.service';
import { PrismaService } from '../../../prisma.service';
import { AiProviderConfigService } from '../../../ai-provider-config.service';
import {
  coveredByBuiltIn,
  detectorSimilarity,
  DETECTOR_DUPLICATE_OVERLAP,
  MAX_UNPROVEN_DETECTORS,
} from '../../detector-overlap';
import type { Tool, ToolContext, ToolGate } from '../tool.types';

/** One-line per-type required-field rules, surfaced to the model so it stops
 * producing malformed pipeline schemas. Mirrors validatePipelineSchema(). */
const PIPELINE_REQUIREMENTS = [
  'REGEX → patterns{<name>:{pattern,...}} (≥1 pattern)',
  'GLINER2 → entities{<label>:{description}} and/or classification{<task>:{labels[]}}',
  'LLM → system_prompt + labels[] (and an aiProviderConfigId; never provider_runtime)',
  'TEXT_CLASSIFICATION / IMAGE_CLASSIFICATION / OBJECT_DETECTION → model (HuggingFace id; IMAGE_CLASSIFICATION has a default)',
  'TAG → not authorable here: a TAG detector runs nothing and only records a fact a CUSTOM connector notebook asserts, so it can never find anything you have not already been told',
].join('; ');

/** Pipeline engines the agent may author, used for the examples filter enum.
 * TAG is deliberately absent: it detects nothing, and only a human writing a
 * CUSTOM connector notebook can supply the value that makes it produce a
 * finding. */
const PIPELINE_TYPES = [
  'REGEX',
  'GLINER2',
  'LLM',
  'TEXT_CLASSIFICATION',
  'IMAGE_CLASSIFICATION',
  'OBJECT_DETECTION',
];

function examplePipelineSchema(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const nested = record.pipeline_schema;
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : record;
}

/**
 * Detector-authoring tools. The autopilot can list, create, test, update,
 * deactivate, delete and train custom detectors (REGEX, GLINER2, HuggingFace
 * pipelines, or pure-LLM). All safety — pipeline-schema validation, the
 * mandatory AiProviderConfig FK for LLM detectors and the rejection of
 * client-supplied provider_runtime — is inherited from CustomDetectorsService.
 */
@Injectable()
export class DetectorToolset {
  constructor(
    private readonly detectors: CustomDetectorsService,
    private readonly tests: CustomDetectorTestsService,
    private readonly applier: DecisionApplierService,
    private readonly search: AgentSearchService,
    private readonly prisma: PrismaService,
    private readonly aiProviders: AiProviderConfigService,
  ) {}

  /**
   * Refuse a detector the system already has.
   *
   * Without this the authoring agent produced ten detectors in under three
   * hours, seven of them one idea rewritten — it re-approached the theme every
   * cycle instead of sharpening what it wrote last time — plus a phone-number
   * detector on a source where the built-in PII PHONE_NUMBER pattern was
   * already enabled. Neither the operator nor the corpus benefits from being
   * scanned twice for the same thing.
   */
  private async assertDetectorIsNew(input: {
    key?: string;
    name: string;
    pipelineSchema: unknown;
  }): Promise<void> {
    const proposal = {
      key: input.key ?? input.name,
      name: input.name,
      pipelineSchema: input.pipelineSchema,
    };

    const existing = await this.prisma.customDetector.findMany({
      where: { isActive: true },
      select: {
        id: true,
        key: true,
        name: true,
        pipelineSchema: true,
        _count: { select: { findings: true } },
      },
    });
    for (const candidate of existing) {
      const overlap = detectorSimilarity(proposal, candidate);
      if (overlap >= DETECTOR_DUPLICATE_OVERLAP) {
        throw new Error(
          `Refused: detector "${candidate.key}" already covers this ` +
            `(${Math.round(overlap * 100)}% overlap). Sharpen it with ` +
            `detector.update (id ${candidate.id}) instead of adding a second ` +
            `detector for the same idea — a operator triaging findings cannot ` +
            `tell two near-identical detectors apart, and both scan the corpus.`,
        );
      }
    }

    // Built-in patterns currently switched on across the instance's sources.
    const sources = await this.prisma.source.findMany({
      select: { config: true },
    });
    const enabled = new Set<string>();
    for (const source of sources) {
      const detectors = (source.config as { detectors?: unknown })?.detectors;
      if (!Array.isArray(detectors)) continue;
      for (const d of detectors) {
        const entry = d as {
          type?: string;
          enabled?: boolean;
          config?: { enabled_patterns?: unknown };
        };
        if (entry?.enabled === false) continue;
        const patterns = entry?.config?.enabled_patterns;
        if (Array.isArray(patterns)) {
          for (const p of patterns) {
            if (typeof p === 'string') enabled.add(p);
          }
        }
      }
    }
    // Instruments you have not read yet. A detector that has been active
    // through at least one re-scan and produced nothing is either wrong or
    // unnecessary, and authoring the next one before resolving it is how ten
    // detectors appeared in three hours with one of them ever firing.
    const unproven = existing.filter((c) => c._count.findings === 0);
    if (unproven.length >= MAX_UNPROVEN_DETECTORS) {
      throw new Error(
        `Refused: ${unproven.length} detectors you already authored have produced ` +
          `no findings at all (${unproven.map((u) => u.key).join(', ')}). Resolve ` +
          `those before adding another — detector.test them, fix them with ` +
          `detector.update, or detector.deactivate the ones that were a bad idea. ` +
          `Authoring a new detector every cycle without reading what the last one ` +
          `caught is not exploration, it is accumulation.`,
      );
    }

    const builtIn = coveredByBuiltIn(proposal, [...enabled]);
    if (builtIn) {
      throw new Error(
        `Refused: the built-in ${builtIn} pattern is already enabled on this ` +
          `instance and detects exactly this. Authoring a custom detector for ` +
          `it duplicates the scan and splits its findings across two detectors. ` +
          `If the built-in one is missing cases, say so in memory.write and ` +
          `tune the source's detector config instead.`,
      );
    }
  }

  private detectorGate = async (
    input: Record<string, unknown>,
    tc: ToolContext,
  ): Promise<ToolGate> => {
    const detectorId =
      typeof input.detectorId === 'string' ? input.detectorId : '';
    const mode = await this.applier.detectorGate(
      detectorId,
      tc.ctx.settings.autopilotDetectorEnabled,
    );
    return { mode, entityType: 'detector', entityId: detectorId };
  };

  list(): Tool[] {
    return [
      {
        name: 'detectors.list',
        description:
          'List custom detectors with id, key, name, pipeline type and active flag.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async () => {
          const rows = await this.detectors.list({ includeInactive: false });
          return rows.map((d) => ({
            id: d.id,
            key: d.key,
            name: d.name,
            isActive: d.isActive,
            pipelineType:
              (d.pipelineSchema as { type?: string } | null)?.type ?? null,
          }));
        },
      },
      {
        name: 'detectors.precision',
        description:
          'Measured precision per active custom detector, from operator triage (not narrative). Each row: openFindings, dismissed (FALSE_POSITIVE+IGNORED), confirmed (RESOLVED), reviewed, falsePositiveRate (dismissed/reviewed, null if never reviewed) and a sample-aware verdict (noisy | mixed | clean | unproven). Consult this before authoring or retiring a detector: a "noisy" detector should be retuned/deactivated, and never re-author a concept operators keep dismissing. Pass customDetectorKey to score just one detector you authored.',
        inputSchema: {
          type: 'object',
          properties: {
            customDetectorKey: {
              type: 'string',
              description:
                'Optional: score only this custom detector key; omit for all.',
            },
          },
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: (input) =>
          this.search.customDetectorPrecision(
            (input.customDetectorKey as string | undefined) ?? null,
          ),
      },
      {
        name: 'detectors.value',
        description:
          'What each detector\'s output is WORTH, not how much of it there is — for built-in detectors as well as custom ones. Per detector: openFindings, watchedByInquiries, citedByCases, highImportance and dismissedByOperator. Read this before judging a detector "noisy": volume is not noise. A detector producing thousands of findings that active inquiries match and cases cite IS the corpus; a detector nothing has ever watched, cited or ranked is the candidate for retuning, however quiet it is. Pass sourceId to scope to one source.',
        inputSchema: {
          type: 'object',
          properties: {
            sourceId: {
              type: 'string',
              description:
                'Optional: score detectors against one source; omit for the whole instance.',
            },
          },
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: (input) =>
          this.search.detectorValue(
            (input.sourceId as string | undefined) ?? null,
          ),
      },
      {
        name: 'ai.providers',
        description:
          'List AI provider configurations that an LLM detector may use. Select a usable id and pass it as aiProviderConfigId. For image or PDF reasoning, supportsVision must be true. Secrets are never returned.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async () => {
          const providers = await this.aiProviders.list();
          return providers.map((provider) => ({
            id: provider.id,
            name: provider.name,
            provider: provider.provider,
            model: provider.model,
            contextSize: provider.contextSize,
            supportsVision: provider.supportsVision,
            usable: provider.hasApiKey && provider.model.trim().length > 0,
          }));
        },
      },
      {
        name: 'detector.examples',
        description:
          'List worked example custom detectors (name, description, pipelineSchema) to copy when authoring a valid pipelineSchema. Pass `type` to return only examples for one engine (incl. candidate HuggingFace model ids); omit it for all types. ' +
          `Required fields per type: ${PIPELINE_REQUIREMENTS}.`,
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: PIPELINE_TYPES },
          },
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: (input) => {
          const examples = this.detectors.listExamples(
            typeof input.type === 'string' ? input.type : undefined,
          );
          // The public examples endpoint intentionally returns the complete
          // persisted config. Agent tools need the inner schema accepted by
          // detector.test/create, otherwise models copy `pipeline_schema` one
          // level too deep and burn retries on validation failures.
          return Promise.resolve(
            examples.map((example) => ({
              ...example,
              pipelineSchema: examplePipelineSchema(example.pipelineSchema),
            })),
          );
        },
      },
      {
        name: 'detector.test',
        description:
          'Run a detector against ad-hoc samples and return what it matched — use it BEFORE and AFTER creating. Prefer one `samples` batch containing a positive and a counterexample; each sample has label, expectedMatch, and exactly one of sampleText or sampleAssetId. sampleAssetId delivers the real file bytes to image/object/vision detectors (never paste an image URL as text). Pass pipelineSchema for a draft (LLM drafts also need aiProviderConfigId), or detectorId for a saved detector. Legacy sampleText remains supported. First call may take 90–120s (model cold start).',
        inputSchema: {
          type: 'object',
          properties: {
            detectorId: { type: 'string' },
            pipelineSchema: { type: 'object' },
            key: { type: 'string' },
            name: { type: 'string' },
            aiProviderConfigId: { type: 'string' },
            sampleText: { type: 'string', minLength: 1 },
            samples: {
              type: 'array',
              minItems: 1,
              maxItems: 4,
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', minLength: 1 },
                  expectedMatch: { type: 'boolean' },
                  sampleText: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 12000,
                  },
                  sampleAssetId: { type: 'string', minLength: 1 },
                },
                required: ['label', 'expectedMatch'],
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
        // Preserve the free-form draft pipeline schema verbatim.
        lenientInput: false,
        sideEffect: 'read',
        handler: async (input) => {
          let detector: {
            key: string;
            name: string;
            pipelineSchema: Record<string, unknown>;
            aiProviderConfigId?: string | null;
          };
          if (typeof input.detectorId === 'string' && input.detectorId) {
            const saved = await this.detectors.getById(input.detectorId);
            detector = {
              key: saved.key,
              name: saved.name,
              pipelineSchema: saved.pipelineSchema,
              aiProviderConfigId: saved.aiProviderConfigId ?? null,
            };
          } else if (
            input.pipelineSchema &&
            typeof input.pipelineSchema === 'object'
          ) {
            detector = {
              key: (input.key as string | undefined) ?? 'draft-test',
              name: (input.name as string | undefined) ?? 'draft',
              pipelineSchema: input.pipelineSchema as Record<string, unknown>,
              aiProviderConfigId:
                (input.aiProviderConfigId as string | undefined) ?? null,
            };
          } else {
            throw new Error('Provide either detectorId or pipelineSchema.');
          }
          if (Array.isArray(input.samples)) {
            const results = await this.tests.evaluateSamples(
              detector,
              input.samples as Array<{
                label: string;
                expectedMatch: boolean;
                sampleText?: string;
                sampleAssetId?: string;
              }>,
            );
            return {
              allExpectationsMet: results.every(
                (result) => result.expectationMet === true,
              ),
              samples: results.map((result) => ({
                ...result,
                findings: Array.isArray(result.findings)
                  ? result.findings.slice(0, 5)
                  : [],
              })),
            };
          }
          if (
            typeof input.sampleText !== 'string' ||
            !input.sampleText.trim()
          ) {
            throw new Error('Provide sampleText or a samples batch.');
          }
          const result = await this.tests.evaluateSample(
            detector,
            input.sampleText,
          );
          const findings = Array.isArray(result.findings)
            ? result.findings
            : [];
          return {
            matched: Boolean(result.matched),
            findingsCount:
              typeof result.findingsCount === 'number'
                ? result.findingsCount
                : findings.length,
            findings: findings.slice(0, 5),
          };
        },
      },
      {
        name: 'detector.create',
        description:
          'Create a custom detector. `pipelineSchema` is the full pipeline config (type REGEX | GLINER2 | LLM | *_CLASSIFICATION | …). ' +
          `Required fields per type: ${PIPELINE_REQUIREMENTS}. ` +
          'For an LLM detector set aiProviderConfigId; never include provider_runtime. Dry-run with detector.test first.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 2 },
            key: { type: 'string' },
            description: { type: 'string' },
            aiProviderConfigId: { type: 'string' },
            pipelineSchema: { type: 'object' },
          },
          required: ['name', 'pipelineSchema'],
          additionalProperties: false,
        },
        // Preserve the free-form pipeline schema verbatim.
        lenientInput: false,
        sideEffect: 'mutate',
        domain: 'detector',
        decisionAction: AgentDecisionAction.CREATE_DETECTOR,
        resolveGate: (_input, tc) =>
          Promise.resolve({
            mode: this.applier.effectiveMode(
              AiManagementMode.INHERIT,
              tc.ctx.settings.autopilotDetectorEnabled,
            ),
            entityType: 'detector',
          }),
        handler: async (input) => {
          await this.assertDetectorIsNew({
            key: input.key as string | undefined,
            name: String(input.name),
            pipelineSchema: input.pipelineSchema,
          });
          const created = await this.detectors.create({
            name: String(input.name),
            key: input.key as string | undefined,
            description: input.description as string | undefined,
            aiProviderConfigId: input.aiProviderConfigId as string | undefined,
            pipelineSchema: input.pipelineSchema as never,
          });
          return { id: created.id, key: created.key, name: created.name };
        },
      },
      {
        name: 'detector.update',
        description:
          'Update a custom detector — adjust its pipelineSchema (re-validated, version bumped) or rename/redescribe it. Use this for the single corrective tweak after a failed test.',
        inputSchema: {
          type: 'object',
          properties: {
            detectorId: { type: 'string' },
            name: { type: 'string', minLength: 2 },
            key: { type: 'string' },
            description: { type: 'string' },
            aiProviderConfigId: { type: 'string' },
            pipelineSchema: { type: 'object' },
          },
          required: ['detectorId'],
          additionalProperties: false,
        },
        // Preserve the free-form pipeline schema verbatim.
        lenientInput: false,
        sideEffect: 'mutate',
        domain: 'detector',
        decisionAction: AgentDecisionAction.UPDATE_DETECTOR,
        resolveGate: this.detectorGate,
        handler: async (input) => {
          const updated = await this.detectors.update(
            String(input.detectorId),
            {
              name: input.name as string | undefined,
              key: input.key as string | undefined,
              description: input.description as string | undefined,
              aiProviderConfigId: input.aiProviderConfigId as
                | string
                | undefined,
              pipelineSchema: input.pipelineSchema as never,
            },
          );
          return {
            id: updated.id,
            key: updated.key,
            name: updated.name,
            version: updated.version,
          };
        },
      },
      {
        name: 'detector.deactivate',
        description:
          'Deactivate a custom detector (isActive=false) without deleting it. Reversible — prefer this for a detector already wired into a source whose hypothesis did not pan out.',
        inputSchema: {
          type: 'object',
          properties: { detectorId: { type: 'string' } },
          required: ['detectorId'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'detector',
        decisionAction: AgentDecisionAction.UPDATE_DETECTOR,
        resolveGate: this.detectorGate,
        handler: async (input) => {
          const updated = await this.detectors.update(
            String(input.detectorId),
            {
              isActive: false,
            },
          );
          return {
            id: updated.id,
            key: updated.key,
            isActive: updated.isActive,
          };
        },
      },
      {
        name: 'detector.delete',
        description:
          'Delete a custom detector and remove it from every source config. Use only for a detector you created this run and never relied on — otherwise prefer detector.deactivate.',
        inputSchema: {
          type: 'object',
          properties: { detectorId: { type: 'string' } },
          required: ['detectorId'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'detector',
        decisionAction: AgentDecisionAction.DELETE_DETECTOR,
        resolveGate: this.detectorGate,
        handler: async (input) => {
          return this.detectors.delete(String(input.detectorId));
        },
      },
      {
        name: 'detector.train',
        description:
          'Train a custom detector (classifier/entity types) from its saved examples, optionally scoped to one source.',
        inputSchema: {
          type: 'object',
          properties: {
            detectorId: { type: 'string' },
            sourceId: { type: 'string' },
          },
          required: ['detectorId'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'detector',
        decisionAction: AgentDecisionAction.TRAIN_DETECTOR,
        resolveGate: this.detectorGate,
        handler: async (input) => {
          const run = await this.detectors.train(String(input.detectorId), {
            sourceId: input.sourceId as string | undefined,
          });
          return run;
        },
      },
    ];
  }
}
