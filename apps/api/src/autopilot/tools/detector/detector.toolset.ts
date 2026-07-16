import { Injectable } from '@nestjs/common';
import { AgentDecisionAction, AiManagementMode } from '@prisma/client';
import { CustomDetectorsService } from '../../../custom-detectors.service';
import { CustomDetectorTestsService } from '../../../custom-detector-tests.service';
import { DecisionApplierService } from '../../decision-applier.service';
import { AgentSearchService } from '../../search/agent-search.service';
import type { Tool, ToolContext, ToolGate } from '../tool.types';

/** One-line per-type required-field rules, surfaced to the model so it stops
 * producing malformed pipeline schemas. Mirrors validatePipelineSchema(). */
const PIPELINE_REQUIREMENTS = [
  'REGEX → patterns{<name>:{pattern,...}} (≥1 pattern)',
  'GLINER2 → entities{<label>:{description}} and/or classification{<task>:{labels[]}}',
  'LLM → system_prompt + labels[] (and an aiProviderConfigId; never provider_runtime)',
  'TEXT_CLASSIFICATION / IMAGE_CLASSIFICATION / OBJECT_DETECTION → model (HuggingFace id; IMAGE_CLASSIFICATION has a default)',
].join('; ');

/** Pipeline engines the agent may author, used for the examples filter enum. */
const PIPELINE_TYPES = [
  'REGEX',
  'GLINER2',
  'LLM',
  'TEXT_CLASSIFICATION',
  'IMAGE_CLASSIFICATION',
  'OBJECT_DETECTION',
];

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
  ) {}

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
        handler: (input) =>
          Promise.resolve(
            this.detectors.listExamples(
              typeof input.type === 'string' ? input.type : undefined,
            ),
          ),
      },
      {
        name: 'detector.test',
        description:
          'Run a detector against ad-hoc sample text and return what it matched — use it to verify a detector works BEFORE and AFTER creating it. Pass `pipelineSchema` to dry-run a draft, or `detectorId` to test a saved detector. First call may take 90–120s (model cold start).',
        inputSchema: {
          type: 'object',
          properties: {
            detectorId: { type: 'string' },
            pipelineSchema: { type: 'object' },
            key: { type: 'string' },
            name: { type: 'string' },
            sampleText: { type: 'string', minLength: 1 },
          },
          required: ['sampleText'],
          additionalProperties: false,
        },
        // Preserve the free-form draft pipeline schema verbatim.
        lenientInput: false,
        sideEffect: 'read',
        handler: async (input) => {
          const sampleText = String(input.sampleText);
          let detector: {
            key: string;
            name: string;
            pipelineSchema: Record<string, unknown>;
          };
          if (typeof input.detectorId === 'string' && input.detectorId) {
            const saved = await this.detectors.getById(input.detectorId);
            detector = {
              key: saved.key,
              name: saved.name,
              pipelineSchema: saved.pipelineSchema,
            };
          } else if (
            input.pipelineSchema &&
            typeof input.pipelineSchema === 'object'
          ) {
            detector = {
              key: (input.key as string | undefined) ?? 'draft-test',
              name: (input.name as string | undefined) ?? 'draft',
              pipelineSchema: input.pipelineSchema as Record<string, unknown>,
            };
          } else {
            throw new Error('Provide either detectorId or pipelineSchema.');
          }
          const result = await this.tests.evaluateSample(detector, sampleText);
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
