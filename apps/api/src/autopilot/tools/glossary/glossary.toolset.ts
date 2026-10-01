import { Injectable } from '@nestjs/common';
import {
  AgentDecisionAction,
  AiManagementMode,
  GlossaryRelationType,
  GlossaryTermKind,
} from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { GlossaryService } from '../../../glossary/glossary.service';
import { GlossaryRelationsService } from '../../../glossary/glossary-relations.service';
import {
  BindingsService,
  compileBindingRow,
} from '../../../semantic/bindings/bindings.service';
import type { BindingSpec } from '../../../semantic/bindings/binding-spec';
import { isValuesMode } from '../../../semantic/bindings/binding-spec';
import { VocabularyService } from '../../../semantic/vocabulary/vocabulary.service';
import { MeaningService } from '../../../semantic/links/meaning.service';
import {
  GlossaryProposalsService,
  PROPOSAL_KINDS,
} from '../../../semantic/suggestions/glossary-proposals.service';
import type { ProposalKind } from '../../../semantic/suggestions/glossary-proposals.service';
import { SemanticSuggestionsService } from '../../../semantic/suggestions/semantic-suggestions.service';
import { UndoService } from '../../supervisor/undo.service';
import type { Tool, ToolContext, ToolGate } from '../tool.types';

const ENTITY_TYPES = [
  'PERSON',
  'ORGANIZATION',
  'LOCATION',
  'REFERENCE',
  'TERM',
  'OTHER',
];

const RELATION_TYPES: GlossaryRelationType[] = [
  'BROADER',
  'RELATED',
  'PART_OF',
  'INSTANCE_OF',
  'CUSTOM',
];

/** The C9 binding spec, as the model sees it. */
const BINDING_SPEC_SCHEMA = {
  type: 'object',
  description:
    'A binding spec (C9). mode OUTPUT binds a detector output to termKey; ' +
    'OUTPUT_VALUES binds only listed values; OUTPUT_LOOKUP resolves each value ' +
    'against a scheme (lookup.schemeKey, match CODES or ANY). METADATA_VALUES / ' +
    'METADATA_LOOKUP read an asset metadata field instead. Never regex.',
  properties: {
    mode: {
      type: 'string',
      enum: [
        'OUTPUT',
        'OUTPUT_VALUES',
        'OUTPUT_LOOKUP',
        'METADATA_VALUES',
        'METADATA_LOOKUP',
      ],
    },
    output: {
      type: 'object',
      properties: {
        detectorType: { type: 'string' },
        customDetectorKey: { type: 'string' },
        findingType: { type: 'string' },
      },
    },
    field: { type: 'string', description: 'Metadata path, for METADATA_*.' },
    values: { type: 'array', items: { type: 'string' } },
    splitDelimiter: { type: 'string' },
    lookup: {
      type: 'object',
      properties: {
        schemeKey: { type: 'string' },
        match: { type: 'string', enum: ['CODES', 'ANY'] },
      },
    },
    termKey: { type: 'string' },
    sourceIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['mode'],
} as const;

/** Approvals an agent may make per UTC day share one budget (SL1 R14, SL2 §9.2). */
const APPROVAL_ACTIONS: AgentDecisionAction[] = [
  AgentDecisionAction.APPROVE_RELATION,
  AgentDecisionAction.APPROVE_BINDING,
];

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function agentActor(tc: ToolContext): string {
  return `agent:${String(tc.ctx.run.agentKind)}`;
}

/**
 * Shared-vocabulary tools (SL1–SL4, D7). Agents read the glossary, its
 * vocabulary and meaning; they propose terms, relations, bindings and links;
 * they approve relations and bindings only within the operator's guardrails;
 * and they never decide documents, terms or aliases.
 */
@Injectable()
export class GlossaryToolset {
  constructor(
    private readonly glossary: GlossaryService,
    private readonly relations: GlossaryRelationsService,
    private readonly bindings: BindingsService,
    private readonly vocabulary: VocabularyService,
    private readonly meaning: MeaningService,
    private readonly proposals: GlossaryProposalsService,
    private readonly suggestions: SemanticSuggestionsService,
    private readonly undo: UndoService,
    private readonly prisma: PrismaService,
  ) {}

  /** Proposals change nothing an operator relies on: allowed in every mode. */
  private readonly proposalGate = (): Promise<ToolGate> =>
    Promise.resolve({
      mode: AiManagementMode.MANAGED,
      entityType: 'glossary',
    });

  /** Approvals: MANAGED only, behind the operator's switch (D7). */
  private readonly approvalGate = (
    _input: Record<string, unknown>,
    tc: ToolContext,
  ): Promise<ToolGate> =>
    Promise.resolve({
      mode: tc.ctx.settings.autopilotGlossaryApproveEnabled
        ? AiManagementMode.MANAGED
        : AiManagementMode.OBSERVE_ONLY,
      entityType: 'glossary',
    });

  list(): Tool[] {
    return [
      {
        name: 'glossary.lookup',
        description:
          'Resolve a name, alias, code or concept against the shared glossary (exact, code, alias, prefix and semantic matches). Use it before treating two spellings as different entities, to adopt the canonical term, and to find the scheme a new concept belongs in.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Name/alias to resolve.' },
            limit: { type: 'number', description: 'Max results (default 10).' },
            kind: { type: 'string', enum: ['CONCEPT', 'ENTITY'] },
            scheme: { type: 'string', description: 'Scheme key to search in.' },
            includeDeprecated: { type: 'boolean' },
          },
          required: ['query'],
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) =>
          this.glossary.lookup(
            typeof input.query === 'string' ? input.query : '',
            typeof input.limit === 'number' ? input.limit : undefined,
            {
              kind: input.kind as GlossaryTermKind | undefined,
              schemeKey: str(input.scheme),
              includeDeprecated: input.includeDeprecated === true,
            },
          ),
      },
      {
        name: 'glossary.propose',
        description:
          'Propose a SHARED VOCABULARY term. kind CONCEPT is a kind of thing (GmbH, IBAN, Force majeure); kind ENTITY is one particular real-world thing (ACME Holding GmbH, Jane Doe). Write the term the way a human would say it — never snake_case slugs, ids or hashes. codes are exact notations (GES, AT_SVNR); a single letter is never an alias. Choose the scheme by glossary.lookup / glossary.list_schemes; never invent a scheme for one term. This is NOT a place for observations or investigation state; those belong in memory.write. Proposals are DRAFT until an operator approves them and never overwrite operator terms — at most your aliases are proposed. Never re-propose a term an operator removed.',
        inputSchema: {
          type: 'object',
          properties: {
            term: { type: 'string' },
            kind: { type: 'string', enum: ['CONCEPT', 'ENTITY'] },
            aliases: { type: 'array', items: { type: 'string' } },
            codes: { type: 'array', items: { type: 'string' } },
            definition: {
              type: 'string',
              description: 'One or two sentences, for concepts.',
            },
            scheme: {
              type: 'string',
              description: 'Existing scheme key (see glossary.list_schemes).',
            },
            entityType: { type: 'string', enum: ENTITY_TYPES },
            notes: {
              type: 'string',
              description: 'Why this term matters; keep to 1-2 sentences.',
            },
            refType: {
              type: 'string',
              enum: ['case', 'inquiry', 'source', 'finding'],
              description:
                'Optional investigation entity that established this term. Supply together with refId.',
            },
            refId: {
              type: 'string',
              description:
                'Existing entity id that established this term. Supply together with refType.',
            },
          },
          required: ['term', 'kind'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'glossary',
        resolveGate: this.proposalGate,
        handler: async (input, tc) => {
          const explicitRefType = input.refType as string | undefined;
          const explicitRefId = input.refId as string | undefined;
          if (
            (explicitRefType && !explicitRefId) ||
            (!explicitRefType && explicitRefId)
          ) {
            throw new Error('refType and refId must be supplied together');
          }
          const focusedCaseId = tc.ctx.run.caseId ?? undefined;
          return this.glossary.upsert({
            term: typeof input.term === 'string' ? input.term : '',
            kind: input.kind as GlossaryTermKind | undefined,
            aliases: (input.aliases as string[] | undefined) ?? [],
            codes: input.codes as string[] | undefined,
            definition: str(input.definition) ?? undefined,
            schemeKey: str(input.scheme),
            entityType: input.entityType as never,
            notes: input.notes as string | undefined,
            refType: explicitRefType ?? (focusedCaseId ? 'case' : undefined),
            refId: explicitRefId ?? focusedCaseId,
            origin: 'AGENT',
            author: String(tc.ctx.run.agentKind),
          });
        },
      },
      {
        name: 'glossary.list_schemes',
        description:
          'List the glossary schemes (controlled vocabularies such as Rechtsformen or GDPR categories) with their term counts. Read it before proposing a concept, so it lands in the right scheme.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async () => this.glossary.listSchemes(),
      },
      {
        name: 'glossary.propose_relation',
        description:
          'Propose a DRAFT relation between two terms, by key. BROADER only when the first concept is a kind of the second (GmbH BROADER Kapitalgesellschaft); PART_OF for parts; INSTANCE_OF from an entity to its concept; RELATED for association; CUSTOM with a label verb. Cycles and kind mismatches are refused. A rationale is required.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'Key of the first term.' },
            to: { type: 'string', description: 'Key of the second term.' },
            type: { type: 'string', enum: RELATION_TYPES },
            label: { type: 'string', description: 'The verb, for CUSTOM.' },
            rationale: { type: 'string' },
          },
          required: ['from', 'to', 'type', 'rationale'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'glossary',
        resolveGate: this.proposalGate,
        handler: async (input, tc) => {
          const [from, to] = await Promise.all([
            this.glossary.resolveOrThrow(String(input.from)),
            this.glossary.resolveOrThrow(String(input.to)),
          ]);
          return this.relations.create({
            fromTermId: from.id,
            toTermId: to.id,
            type: input.type as GlossaryRelationType,
            label: str(input.label),
            note: str(input.rationale) ?? null,
            origin: 'AGENT',
            actor: agentActor(tc),
          });
        },
      },
      {
        name: 'glossary.approve_relation',
        description:
          "Approve a DRAFT relation (relationId) or a relation suggestion from the review queue (suggestionId, from glossary.list_proposals). Only when both terms are APPROVED and within today's approval budget; never an operator-created relation. Writes an undo entry.",
        inputSchema: {
          type: 'object',
          properties: {
            relationId: { type: 'string' },
            suggestionId: { type: 'string' },
            rationale: { type: 'string' },
          },
          required: ['rationale'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'glossary',
        decisionAction: AgentDecisionAction.APPROVE_RELATION,
        resolveGate: this.approvalGate,
        handler: async (input, tc) => this.approveRelation(input, tc),
      },
      {
        name: 'glossary.list_vocabulary',
        description:
          'The detector outputs and metadata fields the data actually produces, with counts, whether each is bound to a meaning, and suggestions. Use bound=false to find what has no meaning yet.',
        inputSchema: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['outputs', 'fields', 'all'] },
            bound: { type: 'string', enum: ['true', 'false', 'any'] },
            sourceId: { type: 'string' },
            q: { type: 'string', description: 'Text to filter labels by.' },
            take: { type: 'number' },
          },
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) =>
          this.vocabulary.list({
            kind: input.kind as 'outputs' | 'fields' | 'all' | undefined,
            bound: input.bound as 'true' | 'false' | 'any' | undefined,
            sourceId: str(input.sourceId),
            q: str(input.q),
            take: typeof input.take === 'number' ? input.take : 50,
          }),
      },
      {
        name: 'glossary.propose_binding',
        description:
          'Propose a DRAFT binding: say what a detector output or metadata field means. Bind the narrowest concept; prefer OUTPUT_LOOKUP for code-like categorical outputs (tag:legal_form → scheme rechtsformen); never bind open-valued outputs to an entity. A rationale is required. Changes nothing until approved.',
        inputSchema: {
          type: 'object',
          properties: {
            spec: BINDING_SPEC_SCHEMA,
            rationale: { type: 'string' },
          },
          required: ['spec', 'rationale'],
          additionalProperties: false,
        },
        lenientInput: false,
        sideEffect: 'mutate',
        domain: 'glossary',
        resolveGate: this.proposalGate,
        handler: async (input, tc) =>
          this.bindings.create(input.spec as BindingSpec, {
            origin: 'AGENT',
            status: 'DRAFT',
            actor: agentActor(tc),
            rationale: str(input.rationale) ?? null,
          }),
      },
      {
        name: 'glossary.preview_binding',
        description:
          'Preview a binding (a spec, or an existing bindingId): how many open findings, assets and sources it would give meaning, samples, the lookup table with unmatched values, and warnings. Returns a previewToken that glossary.approve_binding requires (valid 30 minutes).',
        inputSchema: {
          type: 'object',
          properties: {
            spec: BINDING_SPEC_SCHEMA,
            bindingId: { type: 'string' },
          },
          additionalProperties: false,
        },
        lenientInput: false,
        sideEffect: 'read',
        handler: async (input) => {
          const bindingId = str(input.bindingId);
          const spec = bindingId
            ? this.bindings.specOf(await this.compiledOf(bindingId))
            : (input.spec as BindingSpec | undefined);
          if (!spec) throw new Error('Give a spec or a bindingId');
          return this.bindings.preview(spec, { withToken: true });
        },
      },
      {
        name: 'glossary.approve_binding',
        description:
          "Approve a DRAFT binding you proposed (bindingId) or a binding suggestion from the review queue (suggestionId). Requires the previewToken from glossary.preview_binding for the same spec. Refused when: the switch is off, the target concept is not APPROVED, an operator binding gives the same output another meaning, the preview exceeds the impact limit, today's approval budget is spent, or the token is missing, expired or stale. Writes an undo entry.",
        inputSchema: {
          type: 'object',
          properties: {
            bindingId: { type: 'string' },
            suggestionId: { type: 'string' },
            previewToken: { type: 'string' },
            rationale: { type: 'string' },
          },
          required: ['previewToken', 'rationale'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'glossary',
        decisionAction: AgentDecisionAction.APPROVE_BINDING,
        resolveGate: this.approvalGate,
        handler: async (input, tc) => this.approveBinding(input, tc),
      },
      {
        name: 'glossary.disable_binding',
        description:
          "Disable an APPROVED binding that an agent approved, e.g. when its links turn out wrong. Never an operator's binding. Its links become GONE.",
        inputSchema: {
          type: 'object',
          properties: {
            bindingId: { type: 'string' },
            rationale: { type: 'string' },
          },
          required: ['bindingId', 'rationale'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'glossary',
        resolveGate: this.approvalGate,
        handler: async (input, tc) => {
          const id = String(input.bindingId);
          const row = await this.prisma.glossaryBinding.findUnique({
            where: { id },
          });
          if (!row) throw new Error(`Binding ${id} not found`);
          if (row.status !== 'APPROVED') {
            throw new Error(`Binding ${id} is ${row.status}, not APPROVED`);
          }
          if (!row.approvedBy?.startsWith('agent:')) {
            throw new Error(
              'Refused: an operator approved this binding. Only an operator disables it.',
            );
          }
          return this.bindings.disable(id, agentActor(tc));
        },
      },
      {
        name: 'glossary.term_evidence',
        description:
          'The assets that are evidence of a concept (by key): method (binding, declared, manual, suggested), support, severity and source. includeNarrower rolls up the taxonomy.',
        inputSchema: {
          type: 'object',
          properties: {
            term: { type: 'string', description: 'Term key.' },
            includeNarrower: { type: 'boolean' },
            sourceId: { type: 'string' },
            page: { type: 'number' },
          },
          required: ['term'],
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) => {
          const term = await this.glossary.resolveOrThrow(String(input.term));
          const [summary, evidence] = await Promise.all([
            this.meaning.termSummary(term.id, input.includeNarrower === true),
            this.meaning.termEvidence(term.id, {
              includeNarrower: input.includeNarrower === true,
              sourceId: str(input.sourceId),
              page: typeof input.page === 'number' ? input.page : 0,
              pageSize: 25,
            }),
          ]);
          return {
            term: { id: term.id, key: term.key, term: term.term },
            summary,
            evidence,
          };
        },
      },
      {
        name: 'glossary.finding_meaning',
        description:
          'What a finding means: the concepts it is evidence of, by which binding or manual link, and the broader concepts implied.',
        inputSchema: {
          type: 'object',
          properties: { findingId: { type: 'string' } },
          required: ['findingId'],
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) =>
          this.meaning.findingMeaning(String(input.findingId)),
      },
      {
        name: 'glossary.propose_link',
        description:
          "Propose that a document (assetId, or the asset of findingId) is about a concept. It goes to the operator's review queue; agents never link documents directly.",
        inputSchema: {
          type: 'object',
          properties: {
            term: { type: 'string', description: 'Term key.' },
            assetId: { type: 'string' },
            findingId: { type: 'string' },
            note: { type: 'string', description: 'Why, in one sentence.' },
          },
          required: ['term'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'glossary',
        resolveGate: this.proposalGate,
        handler: async (input, tc) => {
          const term = await this.glossary.resolveOrThrow(String(input.term));
          let assetId = str(input.assetId);
          if (!assetId && str(input.findingId)) {
            const finding = await this.prisma.finding.findUnique({
              where: { id: String(input.findingId) },
              select: { assetId: true },
            });
            assetId = finding?.assetId;
          }
          if (!assetId) throw new Error('Give an assetId or a findingId');
          return this.suggestions.proposeAgentLink({
            termId: term.id,
            assetId,
            note: str(input.note),
            agent: agentActor(tc),
          });
        },
      },
      {
        name: 'glossary.list_proposals',
        description:
          'The glossary review queue: binding, relation, link, term, alias and term-reference proposals, highest score first. Work the BINDING queue from the top: preview, then approve within budget. Never decide documents, terms or aliases.',
        inputSchema: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: [...PROPOSAL_KINDS] },
            minScore: { type: 'number' },
            take: { type: 'number' },
          },
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) =>
          this.proposals.list({
            kind: input.kind as ProposalKind | undefined,
            minScore:
              typeof input.minScore === 'number' ? input.minScore : undefined,
            take: typeof input.take === 'number' ? input.take : 25,
          }),
      },
    ];
  }

  // ── Guardrails (D7) ─────────────────────────────────────────────────────

  private async compiledOf(bindingId: string) {
    const row = await this.prisma.glossaryBinding.findUnique({
      where: { id: bindingId },
    });
    if (!row) throw new Error(`Binding ${bindingId} not found`);
    return compileBindingRow(row);
  }

  /** Throw when today's shared approval budget is spent. */
  private async assertBudget(tc: ToolContext): Promise<void> {
    const limit = tc.ctx.settings.autopilotGlossaryApprovalsPerDay ?? 20;
    if (limit <= 0) {
      throw new Error(
        'Refused: glossary approvals by agents are switched off.',
      );
    }
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const used = await this.prisma.agentDecision.count({
      where: {
        action: { in: APPROVAL_ACTIONS },
        outcome: 'APPLIED',
        createdAt: { gte: since },
      },
    });
    if (used >= limit) {
      throw new Error(
        `Refused: ${used} glossary approval(s) today; the daily budget is ${limit}.`,
      );
    }
  }

  private async approveRelation(
    input: Record<string, unknown>,
    tc: ToolContext,
  ) {
    const actor = agentActor(tc);
    let relationId = str(input.relationId);
    const suggestionId = str(input.suggestionId)?.replace(/^suggestion:/, '');
    if (!relationId && !suggestionId) {
      throw new Error('Give a relationId or a suggestionId');
    }
    await this.assertBudget(tc);

    if (!relationId && suggestionId) {
      const suggestion = await this.prisma.semanticSuggestion.findUnique({
        where: { id: suggestionId },
      });
      if (
        !suggestion ||
        suggestion.kind !== 'RELATION' ||
        suggestion.status !== 'PROPOSED'
      ) {
        throw new Error(`No pending relation suggestion ${suggestionId}`);
      }
      const payload = suggestion.payload as {
        fromTermId: string;
        toTermId: string;
        type?: GlossaryRelationType;
        label?: string;
      };
      // The agent owns the approval: it proposes the relation first.
      const created = await this.relations.create({
        fromTermId: payload.fromTermId,
        toTermId: payload.toTermId,
        type: payload.type ?? 'RELATED',
        label: payload.label,
        note: suggestion.rationale,
        origin: 'AGENT',
        actor,
      });
      relationId = created.id;
      await this.prisma.semanticSuggestion.update({
        where: { id: suggestionId },
        data: { status: 'ACCEPTED', decidedBy: actor, decidedAt: new Date() },
      });
    }

    const relation = await this.prisma.glossaryRelation.findUnique({
      where: { id: relationId },
      include: {
        from: { select: { key: true, status: true } },
        to: { select: { key: true, status: true } },
      },
    });
    if (!relation) throw new Error(`Relation ${relationId} not found`);
    if (relation.origin === 'OPERATOR') {
      throw new Error('Refused: an operator created this relation.');
    }
    if (relation.status === 'APPROVED') return relation;
    if (
      relation.from.status !== 'APPROVED' ||
      relation.to.status !== 'APPROVED'
    ) {
      throw new Error(
        `Refused: both terms must be APPROVED (${relation.from.key}: ${relation.from.status}, ${relation.to.key}: ${relation.to.status}).`,
      );
    }
    const approved = await this.relations.approve(relation.id, actor);
    await this.undo.record({
      runId: tc.ctx.run.id,
      action: AgentDecisionAction.APPROVE_RELATION,
      label: `Approved relation ${relation.from.key} ${relation.type} ${relation.to.key}`,
      entityType: 'glossary_relation',
      entityId: relation.id,
      revertKind: 'restore_value',
      revertPayload: {
        kind: 'glossary.relation',
        relationId: relation.id,
        status: 'DRAFT',
      },
      retentionDays: tc.ctx.settings.supervisorUndoRetentionDays ?? 30,
    });
    return approved;
  }

  /** Refuse, leaving the binding DRAFT with the reason in its rationale. */
  private async refuseBinding(id: string, reason: string): Promise<never> {
    const row = await this.prisma.glossaryBinding.findUnique({
      where: { id },
      select: { rationale: true },
    });
    const stamp = new Date().toISOString().slice(0, 10);
    await this.prisma.glossaryBinding.update({
      where: { id },
      data: {
        rationale: [row?.rationale, `[${stamp}] approval refused: ${reason}`]
          .filter(Boolean)
          .join('\n'),
      },
    });
    throw new Error(`Refused: ${reason}`);
  }

  private async approveBinding(
    input: Record<string, unknown>,
    tc: ToolContext,
  ) {
    const actor = agentActor(tc);
    let bindingId = str(input.bindingId);
    const suggestionId = str(input.suggestionId)?.replace(/^suggestion:/, '');
    if (!bindingId && !suggestionId) {
      throw new Error('Give a bindingId or a suggestionId');
    }
    if (!bindingId && suggestionId) {
      const suggestion = await this.prisma.semanticSuggestion.findUnique({
        where: { id: suggestionId },
      });
      if (
        !suggestion ||
        suggestion.kind !== 'BINDING' ||
        suggestion.status !== 'PROPOSED'
      ) {
        throw new Error(`No pending binding suggestion ${suggestionId}`);
      }
      // Attributed to the agent as proposer, so the agent owns the approval.
      const created = await this.bindings.create(
        suggestion.payload as unknown as BindingSpec,
        {
          origin: 'AGENT',
          status: 'DRAFT',
          actor,
          rationale: suggestion.rationale,
        },
      );
      bindingId = created.id;
      await this.prisma.semanticSuggestion.update({
        where: { id: suggestionId },
        data: { status: 'ACCEPTED', decidedBy: actor, decidedAt: new Date() },
      });
    }
    const id = bindingId!;
    const row = await this.prisma.glossaryBinding.findUnique({
      where: { id },
      include: { term: { select: { key: true, status: true } } },
    });
    if (!row) throw new Error(`Binding ${id} not found`);
    if (row.status === 'APPROVED') return this.bindings.get(id);
    if (row.status !== 'DRAFT') {
      throw new Error(`Binding ${id} is ${row.status}; only DRAFT is approved`);
    }
    if (row.origin !== 'AGENT' && row.origin !== 'SUGGESTION') {
      throw new Error(
        'Refused: agents approve only bindings an agent or the suggestion engine proposed.',
      );
    }
    const compiled = await this.compiledOf(id);

    // Target.
    if (compiled.termId && row.term?.status !== 'APPROVED') {
      return this.refuseBinding(
        id,
        `the target concept ${row.term?.key ?? compiled.termId} is not APPROVED`,
      );
    }
    if (compiled.lookupSchemeId) {
      const concepts = await this.prisma.glossaryTerm.count({
        where: {
          schemeId: compiled.lookupSchemeId,
          kind: 'CONCEPT',
          status: 'APPROVED',
        },
      });
      if (concepts === 0) {
        return this.refuseBinding(
          id,
          'the lookup scheme has no APPROVED concepts',
        );
      }
    }

    // Conflict with an operator binding of the same output.
    const operatorBindings = await this.prisma.glossaryBinding.findMany({
      where: {
        id: { not: id },
        origin: 'OPERATOR',
        status: 'APPROVED',
        detectorType: compiled.detectorType,
        customDetectorKey: compiled.customDetectorKey,
        findingType: compiled.findingType,
        metadataPath: compiled.metadataPath,
      },
    });
    const conflict = operatorBindings.find((other) => {
      const sameMeaning =
        other.termId === compiled.termId &&
        other.lookupSchemeId === compiled.lookupSchemeId;
      if (sameMeaning) return false;
      if (other.noMeaning) return true;
      if (isValuesMode(compiled.mode) && other.values.length) {
        return other.values.some((value) => compiled.values.includes(value));
      }
      return true;
    });
    if (conflict) {
      return this.refuseBinding(
        id,
        `an operator binding (${conflict.id}) gives this output another meaning; conflicts are an operator's call`,
      );
    }

    // Token: the agent must have looked, recently, at this spec.
    const token = await this.bindings.verifyPreviewToken(
      compiled,
      str(input.previewToken),
    );
    if (!token.ok) return this.refuseBinding(id, token.reason);

    // Impact.
    const limit = tc.ctx.settings.autopilotBindingImpactLimit ?? 5000;
    if (limit > 0 && token.findings > limit) {
      return this.refuseBinding(
        id,
        `${token.findings} open findings exceed the impact limit of ${limit}`,
      );
    }

    // Budget.
    try {
      await this.assertBudget(tc);
    } catch (error) {
      return this.refuseBinding(
        id,
        error instanceof Error
          ? error.message.replace(/^Refused: /, '')
          : 'budget',
      );
    }

    const approved = await this.bindings.approve(id, actor);
    await this.undo.record({
      runId: tc.ctx.run.id,
      action: AgentDecisionAction.APPROVE_BINDING,
      label: `Approved binding ${id}${row.term ? ` → ${row.term.key}` : ''} (${token.findings} findings)`,
      entityType: 'glossary_binding',
      entityId: id,
      revertKind: 'restore_value',
      revertPayload: {
        kind: 'glossary.binding',
        bindingId: id,
        status: 'DRAFT',
      },
      retentionDays: tc.ctx.settings.supervisorUndoRetentionDays ?? 30,
    });
    return { ...approved, preview: { findings: token.findings } };
  }
}
