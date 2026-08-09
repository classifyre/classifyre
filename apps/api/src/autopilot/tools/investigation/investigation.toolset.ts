import { Injectable } from '@nestjs/common';
import { AgentDecisionAction, AiManagementMode } from '@prisma/client';
import { DecisionApplierService } from '../../decision-applier.service';
import type { CaseOperation } from '../../autopilot.types';
import type { Tool, ToolContext, ToolGate } from '../tool.types';
import { assertUuid } from '../../../utils/agent-ids';

const SEVERITY = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;
const CASE_STATUS = ['OPEN', 'IN_PROGRESS', 'CLOSED', 'ARCHIVED'] as const;
const HYP_STATUS = [
  'PROPOSED',
  'SUPPORTED',
  'REFUTED',
  'INCONCLUSIVE',
] as const;

const MATCHER_PROPS = {
  title: { type: 'string' },
  description: { type: 'string' },
  matchAllSources: { type: 'boolean' },
  sourceIds: { type: 'array', items: { type: 'string' } },
  detectorTypes: { type: 'array', items: { type: 'string' } },
  customDetectorKeys: { type: 'array', items: { type: 'string' } },
  findingTypes: { type: 'array', items: { type: 'string' } },
  findingTypeRegex: { type: 'array', items: { type: 'string' } },
  findingValueRegex: { type: 'array', items: { type: 'string' } },
} as const;

/**
 * Mutating investigation tools. Each wraps a gate-free core primitive on
 * DecisionApplierService; the ToolDispatcher records the AgentDecision and
 * enforces OBSERVE_ONLY using the gate each tool resolves here.
 */
@Injectable()
export class InvestigationToolset {
  constructor(private readonly applier: DecisionApplierService) {}

  /** Gate for case-scoped tools: per-case aiMode → instance case flag. */
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

  /** An inquiry archive/reactivate tool: flips status, requires a reason. */
  private inquiryStatusTool(
    name: string,
    description: string,
    status: 'ACTIVE' | 'ARCHIVED',
  ): Tool {
    return {
      name,
      description,
      inputSchema: {
        type: 'object',
        properties: {
          inquiryId: { type: 'string' },
          reason: { type: 'string', minLength: 1 },
        },
        required: ['inquiryId', 'reason'],
        additionalProperties: false,
      },
      sideEffect: 'mutate',
      domain: 'inquiry',
      decisionAction: AgentDecisionAction.UPDATE_INQUIRY,
      resolveGate: async (input, tc) => ({
        mode: await this.applier.inquiryGate(
          typeof input.inquiryId === 'string' ? input.inquiryId : '',
          tc.ctx.settings.autopilotInquiryEnabled,
        ),
        entityType: 'inquiry',
        entityId: typeof input.inquiryId === 'string' ? input.inquiryId : '',
      }),
      handler: async (input) => {
        await this.applier.setInquiryStatusCore(
          String(input.inquiryId),
          status,
        );
        return { ok: true };
      },
    };
  }

  /** A case-operation tool: builds the op from input and applies it. */
  private caseOpTool(
    name: string,
    description: string,
    decisionAction: AgentDecisionAction,
    properties: Record<string, unknown>,
    required: string[],
    buildOp: (input: Record<string, unknown>) => CaseOperation,
  ): Tool {
    return {
      name,
      description,
      inputSchema: {
        type: 'object',
        properties: { caseId: { type: 'string' }, ...properties },
        required: ['caseId', ...required],
        additionalProperties: false,
      },
      sideEffect: 'mutate',
      domain: 'case',
      decisionAction,
      resolveGate: this.caseGate,
      handler: async (input) => {
        // Validated here rather than left to "not found": a composed id reads
        // to the model as a missing row, so it tries another plausible one.
        // Every case tool routes through this factory.
        await this.applier.applyCaseOperationCore(
          assertUuid(
            input.caseId,
            'caseId',
            'Take it from cases.list or cases.detail.',
          ),
          buildOp(input),
        );
        return { ok: true };
      },
    };
  }

  list(): Tool[] {
    return [
      // ── Inquiries ───────────────────────────────────────────────────────
      {
        name: 'inquiries.create',
        description:
          'Create a new inquiry (a saved monitor) with matcher rules. Use when no existing inquiry covers a coherent topic.',
        inputSchema: {
          type: 'object',
          properties: MATCHER_PROPS,
          required: ['title'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'inquiry',
        decisionAction: AgentDecisionAction.CREATE_INQUIRY,
        resolveGate: (_input, tc) =>
          Promise.resolve({
            mode: this.applier.effectiveMode(
              AiManagementMode.INHERIT,
              tc.ctx.settings.autopilotInquiryEnabled,
            ),
            entityType: 'inquiry',
          }),
        handler: async (input) => this.applier.createInquiryCore(input),
      },
      {
        name: 'inquiries.update',
        description:
          'Replace the provided fields/matchers of an existing inquiry.',
        inputSchema: {
          type: 'object',
          properties: { inquiryId: { type: 'string' }, ...MATCHER_PROPS },
          required: ['inquiryId'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'inquiry',
        decisionAction: AgentDecisionAction.UPDATE_INQUIRY,
        resolveGate: async (input, tc) => ({
          mode: await this.applier.inquiryGate(
            typeof input.inquiryId === 'string' ? input.inquiryId : '',
            tc.ctx.settings.autopilotInquiryEnabled,
          ),
          entityType: 'inquiry',
          entityId: typeof input.inquiryId === 'string' ? input.inquiryId : '',
        }),
        handler: async (input) => {
          const { inquiryId, ...proposal } = input;
          await this.applier.updateInquiryCore(
            typeof inquiryId === 'string' ? inquiryId : '',
            proposal,
            false,
          );
          return { ok: true };
        },
      },
      {
        name: 'inquiries.enrich',
        description:
          'Merge additional matchers into an existing inquiry (arrays are unioned, not replaced).',
        inputSchema: {
          type: 'object',
          properties: { inquiryId: { type: 'string' }, ...MATCHER_PROPS },
          required: ['inquiryId'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'inquiry',
        decisionAction: AgentDecisionAction.ENRICH_INQUIRY_MATCHERS,
        resolveGate: async (input, tc) => ({
          mode: await this.applier.inquiryGate(
            typeof input.inquiryId === 'string' ? input.inquiryId : '',
            tc.ctx.settings.autopilotInquiryEnabled,
          ),
          entityType: 'inquiry',
          entityId: typeof input.inquiryId === 'string' ? input.inquiryId : '',
        }),
        handler: async (input) => {
          const { inquiryId, ...proposal } = input;
          await this.applier.updateInquiryCore(
            String(inquiryId),
            proposal,
            true,
          );
          return { ok: true };
        },
      },
      this.inquiryStatusTool(
        'inquiries.archive',
        'Archive an inquiry that is noise / false-positive or whose topic is resolved. Records the reason; also memory.write a precedent so the topic is not blindly recreated.',
        'ARCHIVED',
      ),
      this.inquiryStatusTool(
        'inquiries.reactivate',
        'Reactivate a previously archived inquiry when its topic genuinely recurs — prefer this over creating a duplicate. Rematches against current findings.',
        'ACTIVE',
      ),
      // ── Cases ───────────────────────────────────────────────────────────
      {
        name: 'cases.create',
        description:
          'Open a new investigation case. Requires the evidence it starts from: inquiryIds of an inquiry that is already matching, or findingIds you verified this cycle. A case with neither is refused — "investigate this source" is not an investigation. Returns the new caseId for follow-up operations.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            severity: { type: 'string', enum: [...SEVERITY] },
            inquiryIds: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Inquiries this case investigates. At least one must have matches.',
            },
            findingIds: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Findings substantiating the case. Must exist and not be all boilerplate.',
            },
          },
          required: ['title'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'case',
        decisionAction: AgentDecisionAction.CREATE_CASE,
        resolveGate: (_input, tc) =>
          Promise.resolve({
            mode: this.applier.effectiveMode(
              AiManagementMode.INHERIT,
              tc.ctx.settings.autopilotCaseEnabled,
            ),
            entityType: 'case',
          }),
        handler: async (input) =>
          this.applier.createCaseCore({
            title: String(input.title),
            description: input.description as string | undefined,
            severity: input.severity as never,
            inquiryIds: asStringArray(input.inquiryIds),
            findingIds: asStringArray(input.findingIds),
          }),
      },
      {
        name: 'cases.update_fields',
        description: "Update a case's title, description and/or severity.",
        inputSchema: {
          type: 'object',
          properties: {
            caseId: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            severity: { type: 'string', enum: [...SEVERITY] },
          },
          required: ['caseId'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'case',
        decisionAction: AgentDecisionAction.UPDATE_CASE,
        resolveGate: this.caseGate,
        handler: async (input) => {
          await this.applier.updateCaseFieldsCore(String(input.caseId), {
            title: input.title as string | undefined,
            description: input.description as string | undefined,
            severity: input.severity as never,
          });
          return { ok: true };
        },
      },
      {
        name: 'cases.close',
        description:
          "Close a case that no longer holds up (false-positive findings, refuted hypotheses, or a resolved issue). Requires a written conclusion explaining why; also archives the case's linked inquiries.",
        inputSchema: {
          type: 'object',
          properties: {
            caseId: { type: 'string' },
            conclusion: { type: 'string', minLength: 1 },
          },
          required: ['caseId', 'conclusion'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'case',
        decisionAction: AgentDecisionAction.CHANGE_STATUS,
        resolveGate: this.caseGate,
        handler: async (input) =>
          this.applier.closeCaseCore(
            String(input.caseId),
            String(input.conclusion),
          ),
      },
      {
        name: 'cases.reopen',
        description:
          'Reopen a closed/archived case when its issue recurs. Reactivates the inquiries that were archived when it closed so monitoring resumes; requires a note explaining why.',
        inputSchema: {
          type: 'object',
          properties: {
            caseId: { type: 'string' },
            note: { type: 'string', minLength: 1 },
          },
          required: ['caseId', 'note'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'case',
        decisionAction: AgentDecisionAction.CHANGE_STATUS,
        resolveGate: this.caseGate,
        handler: async (input) =>
          this.applier.reopenCaseCore(String(input.caseId), String(input.note)),
      },
      this.caseOpTool(
        'cases.add_hypothesis',
        'Add a hypothesis thread to a case.',
        AgentDecisionAction.ADD_HYPOTHESIS,
        {
          title: { type: 'string' },
          statement: { type: 'string' },
          hypothesisStatus: { type: 'string', enum: [...HYP_STATUS] },
          confidence: { type: 'number' },
        },
        ['title'],
        (input) => ({
          op: 'ADD_HYPOTHESIS',
          rationale: '',
          title: input.title as string,
          statement: input.statement as string | undefined,
          hypothesisStatus: input.hypothesisStatus as never,
          confidence: input.confidence as number | undefined,
        }),
      ),
      this.caseOpTool(
        'cases.update_hypothesis',
        'Update an existing hypothesis thread (title/status/confidence).',
        AgentDecisionAction.UPDATE_HYPOTHESIS,
        {
          threadId: { type: 'string' },
          title: { type: 'string' },
          hypothesisStatus: { type: 'string', enum: [...HYP_STATUS] },
          confidence: { type: 'number' },
        },
        ['threadId'],
        (input) => ({
          op: 'UPDATE_HYPOTHESIS',
          rationale: '',
          threadId: input.threadId as string,
          title: input.title as string | undefined,
          hypothesisStatus: input.hypothesisStatus as never,
          confidence: input.confidence as number | undefined,
        }),
      ),
      this.caseOpTool(
        'cases.add_evidence',
        'Attach an asset as evidence to a case.',
        AgentDecisionAction.ADD_EVIDENCE,
        { assetId: { type: 'string' }, note: { type: 'string' } },
        ['assetId'],
        (input) => ({
          op: 'ADD_EVIDENCE',
          rationale: '',
          assetId: input.assetId as string,
          note: input.note as string | undefined,
        }),
      ),
      this.caseOpTool(
        'cases.attach_findings',
        'Attach findings to a case.',
        AgentDecisionAction.ATTACH_FINDINGS,
        { findingIds: { type: 'array', items: { type: 'string' } } },
        ['findingIds'],
        (input) => ({
          op: 'ATTACH_FINDINGS',
          rationale: '',
          findingIds: input.findingIds as string[],
        }),
      ),
      this.caseOpTool(
        'cases.add_note',
        "Add a note to the case's autopilot discussion thread.",
        AgentDecisionAction.ADD_NOTE,
        { body: { type: 'string' } },
        ['body'],
        (input) => ({
          op: 'ADD_NOTE',
          rationale: '',
          body: input.body as string,
        }),
      ),
      this.caseOpTool(
        'cases.add_thread_entry',
        'Add a note entry to a specific thread.',
        AgentDecisionAction.ADD_THREAD_ENTRY,
        { threadId: { type: 'string' }, body: { type: 'string' } },
        ['threadId', 'body'],
        (input) => ({
          op: 'ADD_THREAD_ENTRY',
          rationale: '',
          threadId: input.threadId as string,
          body: input.body as string,
        }),
      ),
      this.caseOpTool(
        'cases.create_edge',
        'Create a manual graph edge between two asset/finding nodes.',
        AgentDecisionAction.CREATE_EDGE,
        {
          fromType: { type: 'string' },
          fromId: { type: 'string' },
          toType: { type: 'string' },
          toId: { type: 'string' },
          relationType: { type: 'string' },
          confidence: { type: 'number' },
        },
        ['fromType', 'fromId', 'toType', 'toId', 'relationType'],
        (input) => ({
          op: 'CREATE_EDGE',
          rationale: '',
          fromType: input.fromType as string,
          fromId: input.fromId as string,
          toType: input.toType as string,
          toId: input.toId as string,
          relationType: input.relationType as string,
          confidence: input.confidence as number | undefined,
        }),
      ),
      this.caseOpTool(
        'cases.remove_edge',
        'Remove a manual graph edge (INFERRED edges are refused).',
        AgentDecisionAction.REMOVE_EDGE,
        { edgeId: { type: 'string' } },
        ['edgeId'],
        (input) => ({
          op: 'REMOVE_EDGE',
          rationale: '',
          edgeId: input.edgeId as string,
        }),
      ),
      this.caseOpTool(
        'cases.link_support',
        'Link evidence/findings to a hypothesis thread as SUPPORTS/CONTRADICTS.',
        AgentDecisionAction.LINK_SUPPORT,
        {
          threadId: { type: 'string' },
          targetType: { type: 'string', enum: ['evidence', 'finding'] },
          targetId: { type: 'string' },
          stance: { type: 'string', enum: ['SUPPORTS', 'CONTRADICTS'] },
          note: { type: 'string' },
        },
        ['threadId', 'targetType', 'targetId'],
        (input) => ({
          op: 'LINK_SUPPORT',
          rationale: '',
          threadId: assertUuid(
            input.threadId,
            'threadId',
            'Hypothesis thread ids come from cases.detail — they are not the case id.',
          ),
          targetType: input.targetType as never,
          targetId: assertUuid(
            input.targetId,
            'targetId',
            'Use a finding id from findings.search/ranked, or an evidence id from cases.detail.',
          ),
          stance: input.stance as never,
          note: input.note as string | undefined,
        }),
      ),
      this.caseOpTool(
        'cases.change_status',
        "Change a case's status and/or severity.",
        AgentDecisionAction.CHANGE_STATUS,
        {
          caseStatus: { type: 'string', enum: [...CASE_STATUS] },
          severity: { type: 'string', enum: [...SEVERITY] },
        },
        [],
        (input) => ({
          op: 'CHANGE_STATUS',
          rationale: '',
          caseStatus: input.caseStatus as never,
          severity: input.severity as never,
        }),
      ),
      this.caseOpTool(
        'cases.link_inquiry',
        'Link one or more inquiries to a case.',
        AgentDecisionAction.LINK_INQUIRY,
        { inquiryIds: { type: 'array', items: { type: 'string' } } },
        ['inquiryIds'],
        (input) => ({
          op: 'LINK_INQUIRY',
          rationale: '',
          inquiryIds: input.inquiryIds as string[],
        }),
      ),
    ];
  }
}

/** Tolerant array coercion: the model occasionally sends a bare string. */
function asStringArray(v: unknown): string[] {
  if (Array.isArray(v))
    return v.filter((x): x is string => typeof x === 'string');
  return typeof v === 'string' && v ? [v] : [];
}
