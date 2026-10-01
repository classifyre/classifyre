import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SemanticSuggestion } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { GlossaryService } from '../../glossary/glossary.service';
import { GlossaryRelationsService } from '../../glossary/glossary-relations.service';
import { recordGlossaryActivity } from '../../glossary/glossary-activity';
import { glossaryEvents } from '../../glossary/glossary-events';
import {
  MAX_PREVIOUS_KEYS,
  cleanLabels,
  keyFromTermUrn,
  matchKeysFor,
  suggestLabelKind,
} from '../../glossary/glossary-norm';
import { BindingsService } from '../bindings/bindings.service';
import type { BindingSpec } from '../bindings/binding-spec';
import { vocabularyLabel } from '../bindings/binding-spec';
import { SemanticJobsScheduler } from '../semantic-jobs.scheduler';
import { SemanticSuggestionsService } from './semantic-suggestions.service';
import { stitchTermRefs, unknownTermRefs } from '../term-refs';

export const PROPOSAL_KINDS = [
  'TERM',
  'ALIAS',
  'RELATION',
  'BINDING',
  'LINK',
  'TERM_REF',
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export type ProposalDecision = 'accept' | 'edit' | 'dismiss' | 'dismiss_forever' | 'skip';
export const DISMISS_REASONS = ['wrong concept', 'too broad', 'noise', 'other'];

export interface ProposalItem {
  kind: ProposalKind;
  /** draft:<id> | suggestion:<id> | ref:<urn> | alias:<termId> */
  id: string;
  source: 'draft' | 'suggestion' | 'ref';
  title: string;
  rationale: string | null;
  score: number | null;
  generator: string | null;
  origin: string;
  createdBy: string | null;
  createdAt: Date | null;
  term: { id: string; key: string; term: string; kind: string; status: string } | null;
  asset?: { id: string; name: string } | null;
  payload?: unknown;
  evidence?: unknown;
  agentNote?: string | null;
  previousId?: string | null;
}

type Actor = { name: string; isAgent?: boolean };

/**
 * One review queue for every proposal (SL4, F10). It is a view, not a copy:
 * DRAFT terms, aliases, relations and bindings stay in their own tables,
 * machine suggestions and agent link proposals live in `semantic_suggestions`,
 * and unknown term references are read from `edges`. One decision API covers
 * them all. Agents never decide LINK, TERM, ALIAS or TERM_REF items (D7).
 */
@Injectable()
export class GlossaryProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly glossary: GlossaryService,
    private readonly relations: GlossaryRelationsService,
    private readonly bindings: BindingsService,
    private readonly suggestions: SemanticSuggestionsService,
    private readonly jobs: SemanticJobsScheduler,
  ) {}

  counts() {
    return this.suggestions.pendingCounts();
  }

  private termRef(term: { id: string; key: string; term: string; kind: string; status: string } | null | undefined) {
    return term
      ? { id: term.id, key: term.key, term: term.term, kind: term.kind, status: term.status }
      : null;
  }

  async list(params: {
    kind?: ProposalKind;
    origin?: string;
    schemeId?: string;
    termId?: string;
    minScore?: number;
    take?: number;
    skip?: number;
  }): Promise<{ items: ProposalItem[]; total: number; counts: Record<string, number>; embeddings: boolean }> {
    const take = Math.min(Math.max(Number(params.take ?? 50) || 50, 1), 200);
    const skip = Math.max(Number(params.skip ?? 0) || 0, 0);
    const want = (kind: ProposalKind) => !params.kind || params.kind === kind;
    const budget = skip + take;
    const items: ProposalItem[] = [];
    const termSelect = { id: true, key: true, term: true, kind: true, status: true } as const;

    if (want('TERM') && (!params.origin || params.origin === 'AGENT' || params.origin === 'OPERATOR')) {
      const drafts = await this.prisma.glossaryTerm.findMany({
        where: {
          status: 'DRAFT',
          ...(params.schemeId ? { schemeId: params.schemeId } : {}),
          ...(params.termId ? { id: params.termId } : {}),
          ...(params.origin ? { origin: params.origin as never } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: budget,
      });
      for (const term of drafts) {
        items.push({
          kind: 'TERM',
          id: `draft:${term.id}`,
          source: 'draft',
          title: `${term.kind === 'ENTITY' ? '◇' : '⬡'} ${term.term}`,
          rationale: term.definition ?? term.notes,
          score: null,
          generator: null,
          origin: String(term.origin),
          createdBy: term.verifiedBy,
          createdAt: term.createdAt,
          term: this.termRef(term),
          payload: { aliases: term.aliases, codes: term.codes, definition: term.definition },
        });
      }
    }
    if (want('ALIAS')) {
      const withAliases = await this.prisma.glossaryTerm.findMany({
        where: {
          proposedAliases: { isEmpty: false },
          ...(params.termId ? { id: params.termId } : {}),
          ...(params.schemeId ? { schemeId: params.schemeId } : {}),
        },
        take: budget,
      });
      for (const term of withAliases) {
        items.push({
          kind: 'ALIAS',
          id: `alias:${term.id}`,
          source: 'draft',
          title: `${term.term}: ${term.proposedAliases.join(', ')}`,
          rationale: 'Aliases an agent proposed for an operator term.',
          score: null,
          generator: null,
          origin: 'AGENT',
          createdBy: null,
          createdAt: term.updatedAt,
          term: this.termRef(term),
          payload: {
            aliases: term.proposedAliases.map((alias) => ({
              value: alias,
              suggestedAs: suggestLabelKind(alias) ?? 'alias',
            })),
          },
        });
      }
    }
    if (want('RELATION')) {
      const drafts = await this.prisma.glossaryRelation.findMany({
        where: {
          status: 'DRAFT',
          ...(params.termId ? { OR: [{ fromTermId: params.termId }, { toTermId: params.termId }] } : {}),
        },
        include: { from: { select: termSelect }, to: { select: termSelect } },
        orderBy: { createdAt: 'desc' },
        take: budget,
      });
      for (const relation of drafts) {
        items.push({
          kind: 'RELATION',
          id: `draft:${relation.id}`,
          source: 'draft',
          title: `${relation.from.term} —${relation.type === 'CUSTOM' ? relation.label : relation.type.toLowerCase()}→ ${relation.to.term}`,
          rationale: relation.note,
          score: null,
          generator: null,
          origin: relation.origin,
          createdBy: relation.createdBy,
          createdAt: relation.createdAt,
          term: this.termRef(relation.from),
          payload: { fromTermId: relation.fromTermId, toTermId: relation.toTermId, type: relation.type, label: relation.label, to: this.termRef(relation.to) },
        });
      }
    }
    if (want('BINDING')) {
      const drafts = await this.prisma.glossaryBinding.findMany({
        where: {
          status: 'DRAFT',
          ...(params.termId ? { termId: params.termId } : {}),
          ...(params.origin ? { origin: params.origin as never } : {}),
        },
        include: { term: { select: termSelect }, lookupScheme: { select: { id: true, key: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: budget,
      });
      for (const binding of drafts) {
        const label = binding.findingType
          ? vocabularyLabel(binding).label
          : (binding.metadataPath ?? '');
        items.push({
          kind: 'BINDING',
          id: `draft:${binding.id}`,
          source: 'draft',
          title: `${label} → ${binding.term?.term ?? (binding.lookupScheme ? `values in ${binding.lookupScheme.name}` : 'no meaning')}`,
          rationale: binding.rationale,
          score: null,
          generator: null,
          origin: binding.origin,
          createdBy: binding.createdBy,
          createdAt: binding.createdAt,
          term: this.termRef(binding.term),
          payload: await this.bindings.get(binding.id),
        });
      }
    }
    const suggestionKinds = (['BINDING', 'RELATION', 'LINK'] as const).filter((k) => want(k));
    if (suggestionKinds.length) {
      const rows = await this.prisma.semanticSuggestion.findMany({
        where: {
          status: 'PROPOSED',
          kind: { in: [...suggestionKinds] },
          ...(params.termId ? { termId: params.termId } : {}),
          ...(params.minScore !== undefined ? { score: { gte: new Prisma.Decimal(params.minScore) } } : {}),
          ...(params.origin ? { origin: params.origin as never } : {}),
        },
        include: { term: { select: termSelect }, asset: { select: { id: true, name: true } } },
        orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
        take: budget,
      });
      for (const row of rows) items.push(await this.suggestionItem(row));
    }
    if (want('TERM_REF')) {
      const refs = await unknownTermRefs(this.prisma, budget);
      for (const ref of refs) {
        const near = ref.key ? await this.glossary.lookup(ref.key.replace(/[-_.]+/g, ' '), 3) : [];
        items.push({
          kind: 'TERM_REF',
          id: `ref:${ref.urn}`,
          source: 'ref',
          title: `Unknown term reference "${ref.key ?? ref.urn}"`,
          rationale: `${ref.edges} declaration(s) on ${ref.assets} asset(s) name "${ref.key ?? ref.urn}", which no term has.${
            near.length ? ` Closest: ${near.map((n) => `${n.term} (${n.key})`).join(', ')}.` : ''
          }`,
          score: null,
          generator: 'references',
          origin: 'SUGGESTION',
          createdBy: null,
          createdAt: null,
          term: null,
          payload: { urn: ref.urn, key: ref.key, edges: ref.edges, assets: ref.assets, sources: ref.sources, closest: near.map((n) => ({ id: n.id, key: n.key, term: n.term })) },
        });
      }
    }
    items.sort(
      (a, b) =>
        (b.score ?? 0.5) - (a.score ?? 0.5) ||
        (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
    );
    const counts = await this.counts();
    const total = params.kind
      ? (counts[params.kind] ?? items.length)
      : Object.values(counts).reduce((sum, n) => sum + n, 0);
    return {
      items: items.slice(skip, skip + take),
      total,
      counts,
      embeddings: await this.suggestions.embeddingsOn(),
    };
  }

  private async suggestionItem(
    row: SemanticSuggestion & {
      term: { id: string; key: string; term: string; kind: string; status: string } | null;
      asset: { id: string; name: string } | null;
    },
  ): Promise<ProposalItem> {
    const payload = row.payload as Record<string, unknown>;
    let title = row.rationale;
    if (row.kind === 'LINK') title = `${row.asset?.name ?? row.assetId} → ${row.term?.term ?? ''}`;
    if (row.kind === 'RELATION') {
      const other = await this.prisma.glossaryTerm.findUnique({
        where: { id: String(payload.toTermId) },
        select: { term: true },
      });
      title = `${row.term?.term ?? ''} — related — ${other?.term ?? ''}`;
    }
    if (row.kind === 'BINDING') {
      const output = payload.output as { detectorType?: string; customDetectorKey?: string | null; findingType?: string } | undefined;
      const label = output
        ? vocabularyLabel({
            detectorType: output.detectorType ?? null,
            customDetectorKey: output.customDetectorKey ?? null,
            findingType: output.findingType ?? null,
          }).label
        : String(payload.field ?? '');
      title = `${label} → ${row.term?.term ?? 'values in a scheme'}`;
    }
    return {
      kind: row.kind,
      id: `suggestion:${row.id}`,
      source: 'suggestion',
      title,
      rationale: row.rationale,
      score: Number(row.score),
      generator: row.generator,
      origin: row.origin,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      term: this.termRef(row.term),
      asset: row.asset,
      payload,
      evidence: row.evidence,
      agentNote: row.agentNote,
      previousId: row.previousId,
    };
  }

  // ── Decide (SL4 R3) ────────────────────────────────────────────────────

  async decide(input: {
    kind: ProposalKind;
    id: string;
    decision: ProposalDecision;
    edit?: Record<string, unknown>;
    reason?: string;
    actor: Actor;
  }): Promise<{ kind: string; id: string; decision: string; result?: unknown }> {
    const { kind, decision, actor } = input;
    if (!PROPOSAL_KINDS.includes(kind)) throw new BadRequestException(`Unknown kind ${kind}`);
    if (!['accept', 'edit', 'dismiss', 'dismiss_forever', 'skip'].includes(decision)) {
      throw new BadRequestException(`Unknown decision ${decision}`);
    }
    if (actor.isAgent && !['BINDING', 'RELATION'].includes(kind)) {
      throw new ForbiddenException(
        `Agents never decide ${kind} proposals; they are operator decisions (D7).`,
      );
    }
    if (decision === 'skip') return { kind, id: input.id, decision };
    const [prefix, ...rest] = input.id.split(':');
    const ref = rest.join(':');
    let result: unknown;
    if (kind === 'TERM') result = await this.decideTerm(ref, decision, actor);
    else if (kind === 'ALIAS') result = await this.decideAlias(ref, decision, input.edit, actor);
    else if (kind === 'TERM_REF') result = await this.decideRef(ref, decision, input.edit, actor);
    else if (prefix === 'draft') {
      result =
        kind === 'RELATION'
          ? await this.decideDraftRelation(ref, decision, actor)
          : await this.decideDraftBinding(ref, decision, input.edit, actor);
    } else if (prefix === 'suggestion') {
      result = await this.decideSuggestion(ref, kind, decision, input.edit, input.reason, actor);
    } else {
      throw new BadRequestException(`Unknown proposal id ${input.id}`);
    }
    await recordGlossaryActivity(this.prisma, {
      type: 'PROPOSAL_DECIDED',
      actor: actor.name,
      payload: { kind, id: input.id, decision, reason: input.reason ?? null } as Prisma.InputJsonValue,
    });
    glossaryEvents.emit({ type: 'glossary.proposal_decided', kind, decision, count: 1 });
    return { kind, id: input.id, decision, result };
  }

  private async decideTerm(termId: string, decision: ProposalDecision, actor: Actor) {
    if (decision === 'accept' || decision === 'edit') return this.glossary.approve(termId, actor.name);
    // DRAFT ──reject──▶ deleted (deletion remembered).
    return this.glossary.remove(termId, actor.name);
  }

  private async decideAlias(
    termId: string,
    decision: ProposalDecision,
    edit: Record<string, unknown> | undefined,
    actor: Actor,
  ) {
    const term = await this.prisma.glossaryTerm.findUnique({ where: { id: termId } });
    if (!term) throw new NotFoundException(`Glossary term ${termId} not found`);
    if (decision === 'dismiss' || decision === 'dismiss_forever') {
      return this.prisma.glossaryTerm.update({ where: { id: termId }, data: { proposedAliases: [] } });
    }
    const chosen = Array.isArray(edit?.aliases)
      ? (edit!.aliases as string[]).filter((a) => term.proposedAliases.includes(a))
      : term.proposedAliases;
    const asCodes = Array.isArray(edit?.codes) ? (edit!.codes as string[]) : [];
    const asHidden = Array.isArray(edit?.hiddenAliases) ? (edit!.hiddenAliases as string[]) : [];
    const aliases = cleanLabels([...term.aliases, ...chosen.filter((a) => !asCodes.includes(a) && !asHidden.includes(a))]);
    const codes = cleanLabels([...term.codes, ...asCodes], { caseSensitive: true });
    const hiddenAliases = cleanLabels([...term.hiddenAliases, ...asHidden]);
    const updated = await this.prisma.glossaryTerm.update({
      where: { id: termId },
      data: {
        aliases,
        codes,
        hiddenAliases,
        proposedAliases: [],
        matchKeys: matchKeysFor({ term: term.term, aliases, codes, hiddenAliases }),
      },
    });
    await this.glossary.enqueueEmbedding(updated);
    glossaryEvents.emit({
      type: 'glossary.term_changed',
      change: 'updated',
      termId,
      key: updated.key,
      kind: updated.kind,
      labelsChanged: true,
    });
    await recordGlossaryActivity(this.prisma, {
      type: 'TERM_UPDATED',
      termId,
      actor: actor.name,
      payload: { acceptedAliases: chosen },
    });
    return this.glossary.toDto(updated);
  }

  private async decideRef(
    urn: string,
    decision: ProposalDecision,
    edit: Record<string, unknown> | undefined,
    actor: Actor,
  ) {
    const key = keyFromTermUrn(urn);
    if (!key) throw new BadRequestException(`Not a term reference: ${urn}`);
    if (decision === 'dismiss' || decision === 'dismiss_forever') {
      // Nothing to remember: the reference is in the data. Dismissing it
      // drops the declarations, which a later scan re-asserts if it still says so.
      await this.prisma.$executeRaw`DELETE FROM edges WHERE to_type = 'term_ref' AND to_id = ${urn}`;
      return { removed: true };
    }
    const mapTo = typeof edit?.mapToTermId === 'string' ? edit.mapToTermId : null;
    if (mapTo) {
      const target = await this.glossary.resolveOrThrow(mapTo);
      const clash = await this.prisma.glossaryTerm.findFirst({
        where: { OR: [{ key }, { previousKeys: { has: key } }], NOT: { id: target.id } },
        select: { id: true },
      });
      if (clash) throw new BadRequestException(`Key "${key}" already belongs to another term`);
      await this.prisma.glossaryTerm.update({
        where: { id: target.id },
        data: { previousKeys: [...new Set([...target.previousKeys, key])].slice(0, MAX_PREVIOUS_KEYS) },
      });
      const stitched = await stitchTermRefs(this.prisma, [key]);
      if (stitched.assetIds.length) {
        await this.jobs.scheduleIncrementalForAssets(stitched.assetIds, `references to ${key} mapped`);
      }
      return { mappedTo: target.key, ...stitched };
    }
    const name = typeof edit?.term === 'string' && edit.term.trim() ? edit.term.trim() : key.replace(/[-_.]+/g, ' ');
    return this.glossary.upsert({
      term: name,
      key,
      kind: edit?.kind === 'ENTITY' ? 'ENTITY' : 'CONCEPT',
      schemeId: typeof edit?.schemeId === 'string' ? edit.schemeId : undefined,
      definition: typeof edit?.definition === 'string' ? edit.definition : undefined,
      origin: 'OPERATOR',
      author: actor.name,
    });
  }

  private async decideDraftRelation(id: string, decision: ProposalDecision, actor: Actor) {
    const relation = await this.prisma.glossaryRelation.findUnique({ where: { id } });
    if (!relation) throw new NotFoundException(`Relation ${id} not found`);
    if (decision === 'accept' || decision === 'edit') {
      if (actor.isAgent) {
        throw new ForbiddenException('Agents approve relations through glossary.approve_relation, within its guardrails.');
      }
      return this.relations.approve(id, actor.name);
    }
    return this.relations.remove(id, actor.name);
  }

  private async decideDraftBinding(
    id: string,
    decision: ProposalDecision,
    edit: Record<string, unknown> | undefined,
    actor: Actor,
  ) {
    if (actor.isAgent && decision !== 'dismiss') {
      throw new ForbiddenException('Agents approve bindings through glossary.approve_binding, within its guardrails.');
    }
    if (decision === 'dismiss' || decision === 'dismiss_forever') return this.bindings.remove(id, actor.name);
    if (decision === 'edit' && edit?.spec) {
      await this.bindings.update(id, edit.spec as BindingSpec, { actor: actor.name });
    }
    return this.bindings.approve(id, actor.name);
  }

  private async decideSuggestion(
    id: string,
    kind: ProposalKind,
    decision: ProposalDecision,
    edit: Record<string, unknown> | undefined,
    reason: string | undefined,
    actor: Actor,
  ) {
    const row = await this.prisma.semanticSuggestion.findUnique({ where: { id } });
    if (!row || row.kind !== kind) throw new NotFoundException(`Suggestion ${id} not found`);
    if (row.status !== 'PROPOSED') {
      throw new BadRequestException(`Suggestion ${id} is already ${row.status}`);
    }
    if (decision === 'dismiss' || decision === 'dismiss_forever') {
      if (reason && !DISMISS_REASONS.some((r) => reason.startsWith(r))) {
        // Free text is kept; the four reasons are the analysable ones.
      }
      await this.prisma.semanticSuggestion.update({
        where: { id },
        data: {
          status: 'DISMISSED',
          suppressed: decision === 'dismiss_forever',
          decidedBy: actor.name,
          decidedAt: new Date(),
          dismissReason: reason ?? null,
        },
      });
      return { dismissed: true };
    }
    let result: unknown = null;
    if (kind === 'BINDING') {
      if (actor.isAgent) {
        throw new ForbiddenException('Agents approve binding suggestions through glossary.approve_binding.');
      }
      const spec = (decision === 'edit' && edit?.spec ? edit.spec : row.payload) as unknown as BindingSpec;
      result = await this.bindings.create(spec, {
        origin: 'OPERATOR',
        status: 'APPROVED',
        actor: actor.name,
        rationale: row.rationale,
      });
    } else if (kind === 'RELATION') {
      if (actor.isAgent) {
        throw new ForbiddenException('Agents approve relations through glossary.approve_relation.');
      }
      const payload = row.payload as { fromTermId: string; toTermId: string; type?: string; label?: string };
      result = await this.relations.create({
        fromTermId: payload.fromTermId,
        toTermId: payload.toTermId,
        type: (edit?.type as never) ?? (payload.type as never) ?? 'RELATED',
        label: (edit?.label as string | undefined) ?? payload.label,
        origin: 'OPERATOR',
        actor: actor.name,
        note: row.rationale,
      });
    }
    await this.prisma.semanticSuggestion.update({
      where: { id },
      data: { status: 'ACCEPTED', decidedBy: actor.name, decidedAt: new Date() },
    });
    if (kind === 'LINK' && row.assetId) {
      await this.jobs.scheduleIncrementalForAssets([row.assetId], 'link suggestion accepted');
    }
    return result ?? { accepted: true };
  }

  /** Bulk accept or dismiss for link groups (SL4 §5). */
  async decideBulk(input: {
    kind: 'LINK';
    termId: string;
    ids?: string[];
    minScore?: number;
    decision: 'accept' | 'dismiss';
    reason?: string;
    actor: Actor;
  }) {
    if (input.kind !== 'LINK') throw new BadRequestException('Bulk decisions are for LINK groups');
    if (input.actor.isAgent) throw new ForbiddenException('Agents never decide documents (D7).');
    const where: Prisma.SemanticSuggestionWhereInput = {
      kind: 'LINK',
      status: 'PROPOSED',
      termId: input.termId,
      ...(input.ids?.length
        ? { id: { in: input.ids.map((id) => id.replace(/^suggestion:/, '')) } }
        : { score: { gte: new Prisma.Decimal(input.minScore ?? 0.85) } }),
    };
    const rows = await this.prisma.semanticSuggestion.findMany({ where, select: { id: true, assetId: true } });
    if (!rows.length) return { decided: 0 };
    await this.prisma.semanticSuggestion.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data:
        input.decision === 'accept'
          ? { status: 'ACCEPTED', decidedBy: input.actor.name, decidedAt: new Date() }
          : { status: 'DISMISSED', decidedBy: input.actor.name, decidedAt: new Date(), dismissReason: input.reason ?? null },
    });
    for (const row of rows) {
      await recordGlossaryActivity(this.prisma, {
        type: 'PROPOSAL_DECIDED',
        termId: input.termId,
        actor: input.actor.name,
        payload: { kind: 'LINK', id: `suggestion:${row.id}`, decision: input.decision, bulk: true },
      });
    }
    if (input.decision === 'accept') {
      await this.jobs.scheduleIncrementalForAssets(
        rows.map((r) => r.assetId).filter((id): id is string => Boolean(id)),
        'link suggestions accepted',
      );
    }
    glossaryEvents.emit({ type: 'glossary.proposal_decided', kind: 'LINK', decision: input.decision, count: rows.length });
    return { decided: rows.length };
  }

  /** An agent's supporting note on a proposal it may not decide (SL4 §7). */
  async addAgentNote(suggestionId: string, note: string) {
    const row = await this.prisma.semanticSuggestion.findUnique({ where: { id: suggestionId.replace(/^suggestion:/, '') } });
    if (!row) throw new NotFoundException(`Suggestion ${suggestionId} not found`);
    return this.prisma.semanticSuggestion.update({
      where: { id: row.id },
      data: { agentNote: note.slice(0, 2000) },
    });
  }

  /** Link groups for the Documents section: per concept, with a score histogram. */
  async linkGroups() {
    const rows = await this.prisma.$queryRaw<
      Array<{ term_id: string; term: string; key: string; n: bigint; bands: number[] }>
    >`
      SELECT s.term_id, g.term, g.key, count(*) AS n,
             array_agg(floor(s.score * 10)::int ORDER BY s.score) AS bands
        FROM semantic_suggestions s JOIN glossary_terms g ON g.id = s.term_id
       WHERE s.kind = 'LINK' AND s.status = 'PROPOSED'
       GROUP BY s.term_id, g.term, g.key ORDER BY count(*) DESC`;
    return rows.map((row) => {
      const histogram = Array.from({ length: 11 }, () => 0);
      for (const band of row.bands) histogram[Math.min(Math.max(band, 0), 10)] += 1;
      return { termId: row.term_id, term: row.term, key: row.key, count: Number(row.n), histogram };
    });
  }
}
