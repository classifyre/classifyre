import { Injectable } from '@nestjs/common';
import { AgentDecisionAction } from '@prisma/client';
import { assertUuid } from '../../../utils/agent-ids';
import { DecisionApplierService } from '../../decision-applier.service';
import { AgentSearchService } from '../../search/agent-search.service';
import { RANKED_LIST_PAGE_SIZE } from '../../autopilot.constants';
import type { Tool, ToolContext, ToolGate } from '../tool.types';

/** The hypothesis work queue and the mutation that connects authored probes. */
@Injectable()
export class HypothesesToolset {
  constructor(
    private readonly search: AgentSearchService,
    private readonly applier: DecisionApplierService,
  ) {}

  private threadGate = async (
    input: Record<string, unknown>,
    tc: ToolContext,
  ): Promise<ToolGate> => {
    const threadId = typeof input.threadId === 'string' ? input.threadId : '';
    // The run is source-scoped, but this write lands on a case thread. Resolve
    // through the owning case and the case instance flag, never the detector flag.
    const gate = await this.applier.caseThreadGate(
      threadId,
      tc.ctx.settings.autopilotCaseEnabled,
    );
    return {
      mode: gate.mode,
      entityType: 'case',
      entityId: gate.caseId ?? undefined,
    };
  };

  list(): Tool[] {
    return [
      {
        name: 'hypotheses.open',
        description:
          'List complete pages of PROPOSED hypotheses on open cases with zero linked evidence, ordered to put operator questions first. Already-probed hypotheses are excluded by default so a detector is not authored twice. Continue with nextOffset when present.',
        inputSchema: {
          type: 'object',
          properties: {
            includeProbed: { type: 'boolean', default: false },
            offset: { type: 'integer', minimum: 0, default: 0 },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: RANKED_LIST_PAGE_SIZE,
              default: RANKED_LIST_PAGE_SIZE,
            },
          },
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) =>
          this.search.openHypotheses(input.includeProbed === true, {
            offset: input.offset as number | undefined,
            limit: input.limit as number | undefined,
          }),
      },
      {
        name: 'hypotheses.link_probe',
        description:
          'Link a real custom detector to the open hypothesis it was authored to test. Do this after the detector is wired and its source rescan is triggered.',
        inputSchema: {
          type: 'object',
          properties: {
            threadId: { type: 'string' },
            customDetectorKey: { type: 'string' },
            detectorId: { type: 'string' },
            note: { type: 'string' },
          },
          required: ['threadId', 'customDetectorKey'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'case',
        decisionAction: AgentDecisionAction.ADD_THREAD_ENTRY,
        resolveGate: this.threadGate,
        handler: async (input) => {
          const threadId = assertUuid(
            input.threadId,
            'threadId',
            'Hypothesis thread ids come from hypotheses.open — they are not case ids.',
          );
          await this.applier.linkProbeCore({
            threadId,
            customDetectorKey: String(input.customDetectorKey),
            detectorId:
              typeof input.detectorId === 'string'
                ? input.detectorId
                : undefined,
            note: typeof input.note === 'string' ? input.note : undefined,
          });
          return { ok: true };
        },
      },
    ];
  }
}
