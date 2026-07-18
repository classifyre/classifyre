import { Injectable } from '@nestjs/common';
import { CaseLeadStatus } from '@prisma/client';
import { CaseLeadsService } from '../../../case-leads.service';
import { CaseEventsService } from '../../../case-events.service';
import { DecisionApplierService } from '../../decision-applier.service';
import type { Tool, ToolContext, ToolGate } from '../tool.types';

/**
 * Lead-triage and chronology tools for the case agent. Leads let the agent
 * SUGGEST evidence without mutating the case's evidence set: a human (or an
 * explicit review) accepts or dismisses each proposal, and dismissals become
 * precedents. Chronology events proposed by the agent stay unverified until an
 * operator confirms them.
 */
@Injectable()
export class CaseLeadsToolset {
  constructor(
    private readonly leads: CaseLeadsService,
    private readonly events: CaseEventsService,
    private readonly applier: DecisionApplierService,
  ) {}

  private caseGate = async (
    input: Record<string, unknown>,
    tc: ToolContext,
  ): Promise<ToolGate> => {
    const caseId = typeof input.caseId === 'string' ? input.caseId : '';
    const mode = await this.applier.caseGate(
      caseId,
      tc.ctx.settings.autopilotCaseEnabled,
    );
    return { mode, entityType: 'case', entityId: caseId };
  };

  list(): Tool[] {
    return [
      {
        name: 'cases.list_leads',
        description:
          'List the lead queue of a case (PROPOSED candidates plus reviewed history). Check before proposing: never re-propose a DISMISSED finding.',
        inputSchema: {
          type: 'object',
          properties: {
            caseId: { type: 'string' },
            status: {
              type: 'string',
              enum: ['PROPOSED', 'ACCEPTED', 'DISMISSED'],
            },
          },
          required: ['caseId'],
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) =>
          this.leads.list(
            String(input.caseId),
            input.status as CaseLeadStatus | undefined,
          ),
      },
      {
        name: 'cases.propose_lead',
        description:
          'Propose a finding as a LEAD for a case instead of attaching it directly. Use this whenever your confidence is moderate — e.g. a semantic neighbour or an unreviewed high-importance match. The lead queue is human-reviewed; direct cases.attach_findings is only for findings you verified against source evidence this cycle.',
        inputSchema: {
          type: 'object',
          properties: {
            caseId: { type: 'string' },
            findingId: { type: 'string' },
            rationale: {
              type: 'string',
              description:
                'Specific, checkable reason this finding may belong in the case.',
            },
          },
          required: ['caseId', 'findingId', 'rationale'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'case',
        resolveGate: this.caseGate,
        handler: async (input, tc) =>
          this.leads.propose(String(input.caseId), {
            findingId: String(input.findingId),
            rationale: String(input.rationale),
            origin: 'AUTOPILOT',
            proposedBy: String(tc.ctx.run.agentKind),
          }),
      },
      {
        name: 'cases.generate_leads',
        description:
          'Deterministically generate leads for a case from its own evidence: semantic neighbours of attached findings plus high-importance matches of linked inquiries. Bounded and idempotent.',
        inputSchema: {
          type: 'object',
          properties: { caseId: { type: 'string' } },
          required: ['caseId'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'case',
        resolveGate: this.caseGate,
        handler: async (input, tc) =>
          this.leads.generate(
            String(input.caseId),
            String(tc.ctx.run.agentKind),
          ),
      },
      {
        name: 'cases.list_events',
        description:
          'List the case chronology: dated real-world events reconstructed from evidence (distinct from the app activity log).',
        inputSchema: {
          type: 'object',
          properties: { caseId: { type: 'string' } },
          required: ['caseId'],
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) => this.events.list(String(input.caseId)),
      },
      {
        name: 'cases.propose_event',
        description:
          'Add a dated real-world event to the case chronology, extracted from attached evidence (e.g. a flight date, a filing date). Events you add are UNVERIFIED until an operator confirms them; always cite the findingIds/evidenceIds the date came from and set confidence honestly.',
        inputSchema: {
          type: 'object',
          properties: {
            caseId: { type: 'string' },
            occurredAt: {
              type: 'string',
              description: 'ISO date/datetime of the real-world event.',
            },
            precision: { type: 'string', enum: ['DAY', 'MONTH', 'YEAR'] },
            title: { type: 'string' },
            description: { type: 'string' },
            confidence: { type: 'number' },
            findingIds: { type: 'array', items: { type: 'string' } },
            evidenceIds: { type: 'array', items: { type: 'string' } },
          },
          required: ['caseId', 'occurredAt', 'title'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'case',
        resolveGate: this.caseGate,
        handler: async (input, tc) => {
          const occurredAt = new Date(String(input.occurredAt));
          if (Number.isNaN(occurredAt.getTime())) {
            return { error: `Invalid occurredAt: ${String(input.occurredAt)}` };
          }
          return this.events.create(
            String(input.caseId),
            {
              occurredAt,
              precision: input.precision as never,
              title: String(input.title),
              description: input.description as string | undefined,
              confidence:
                typeof input.confidence === 'number'
                  ? input.confidence
                  : undefined,
              findingIds: (input.findingIds as string[] | undefined) ?? [],
              evidenceIds: (input.evidenceIds as string[] | undefined) ?? [],
            },
            String(tc.ctx.run.agentKind),
            'AGENT',
          );
        },
      },
    ];
  }
}
