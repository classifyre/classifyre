import { Injectable } from '@nestjs/common';
import { AgentDecisionAction, AiManagementMode } from '@prisma/client';
import { CustomDetectorsService } from '../../../custom-detectors.service';
import { DecisionApplierService } from '../../decision-applier.service';
import type { Tool, ToolContext, ToolGate } from '../tool.types';

/**
 * Detector-authoring tools. The autopilot can list, create and train custom
 * detectors (REGEX, GLINER2, HuggingFace pipelines, or pure-LLM). All safety —
 * pipeline-schema validation, the mandatory AiProviderConfig FK for LLM
 * detectors and the rejection of client-supplied provider_runtime — is
 * inherited from CustomDetectorsService.create().
 */
@Injectable()
export class DetectorToolset {
  constructor(
    private readonly detectors: CustomDetectorsService,
    private readonly applier: DecisionApplierService,
  ) {}

  private detectorGate = async (
    input: Record<string, unknown>,
    tc: ToolContext,
  ): Promise<ToolGate> => {
    const detectorId = String(input.detectorId ?? '');
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
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
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
        name: 'detector.create',
        description:
          'Create a custom detector. `pipelineSchema` is the full pipeline config (type REGEX | GLINER2 | LLM | *_CLASSIFICATION | …). For an LLM detector set aiProviderConfigId; never include provider_runtime.',
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
        resolveGate: async (_input, tc) => ({
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
