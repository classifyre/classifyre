import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GlossaryOrigin,
  GlossaryRelation,
  GlossaryRelationType,
  GlossaryStatus,
  GlossaryTerm,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { recordGlossaryActivity } from './glossary-activity';
import { glossaryEvents } from './glossary-events';

/** Cycle checks walk at most this many hops (R5). */
export const RELATION_CYCLE_HOPS = 50;
/** Guard against runaway agents: relations starting from one term (R5). */
export const MAX_RELATIONS_PER_TERM = 500;
/** Closure depth for "include narrower" (R5, SL3 R3). */
export const CLOSURE_DEPTH = 10;
const MAX_LABEL = 64;

export type RelationInput = {
  fromTermId: string;
  toTermId: string;
  type: GlossaryRelationType;
  label?: string;
  note?: string | null;
  origin: GlossaryOrigin;
  actor?: string;
  /** Operators create APPROVED relations; agents DRAFT (R5). */
  status?: GlossaryStatus;
};

/**
 * Validation of one relation against the kinds of its endpoints (R5).
 * Pure, so the rules have one home the spec can pin.
 */
export function validateRelationKinds(
  type: GlossaryRelationType,
  from: Pick<GlossaryTerm, 'kind'>,
  to: Pick<GlossaryTerm, 'kind'>,
  label: string,
): string | null {
  switch (type) {
    case 'BROADER':
    case 'RELATED':
    case 'PART_OF':
      if (from.kind !== 'CONCEPT' || to.kind !== 'CONCEPT') {
        return `${type} relates two concepts`;
      }
      return null;
    case 'INSTANCE_OF':
      if (from.kind !== 'ENTITY' || to.kind !== 'CONCEPT') {
        return 'INSTANCE_OF goes from an entity to a concept';
      }
      return null;
    case 'CUSTOM':
      if (from.kind !== 'CONCEPT' || to.kind !== 'CONCEPT') {
        return 'Custom verbs relate concepts. Facts between particular entities are edges, not glossary relations';
      }
      if (!label) return 'A custom relation needs a label (the verb)';
      if (label.length > MAX_LABEL) {
        return `A custom relation label is at most ${MAX_LABEL} characters`;
      }
      return null;
    default:
      return `Unknown relation type ${String(type)}`;
  }
}

/**
 * Curated structure between terms: the taxonomy (BROADER) and the concept-level
 * ontology (RELATED, PART_OF, INSTANCE_OF, custom verbs). Few rows, approved
 * like terms. Facts about particular entities stay in `edges` (D4).
 */
@Injectable()
export class GlossaryRelationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: {
    termId?: string;
    type?: GlossaryRelationType;
    status?: GlossaryStatus;
    take?: number;
    skip?: number;
  }) {
    const where: Prisma.GlossaryRelationWhereInput = {
      ...(params.termId
        ? { OR: [{ fromTermId: params.termId }, { toTermId: params.termId }] }
        : {}),
      ...(params.type ? { type: params.type } : {}),
      ...(params.status ? { status: params.status } : {}),
    };
    const take = Math.min(Math.max(Number(params.take ?? 100) || 100, 1), 500);
    const skip = Math.max(Number(params.skip ?? 0) || 0, 0);
    const [rows, total] = await Promise.all([
      this.prisma.glossaryRelation.findMany({
        where,
        include: {
          from: {
            select: {
              id: true,
              key: true,
              term: true,
              kind: true,
              status: true,
            },
          },
          to: {
            select: {
              id: true,
              key: true,
              term: true,
              kind: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.glossaryRelation.count({ where }),
    ]);
    return { relations: rows, total };
  }

  /**
   * The path that would close a cycle when adding `from → to` on an acyclic
   * type (BROADER, PART_OF): a walk from `to` along the same type that reaches
   * `from`. Null when there is none.
   */
  async cyclePath(
    fromTermId: string,
    toTermId: string,
    type: GlossaryRelationType,
  ): Promise<string[] | null> {
    if (fromTermId === toTermId) return [fromTermId, toTermId];
    const rows = await this.prisma.$queryRaw<Array<{ path: string[] }>>`
      WITH RECURSIVE walk(term_id, path, depth) AS (
        SELECT ${toTermId}::text, ARRAY[${toTermId}::text], 0
        UNION ALL
        SELECT r.to_term_id, walk.path || r.to_term_id, walk.depth + 1
          FROM glossary_relations r
          JOIN walk ON r.from_term_id = walk.term_id
         WHERE r.type = ${type}::"GlossaryRelationType"
           AND walk.depth < ${RELATION_CYCLE_HOPS}
           AND NOT r.to_term_id = ANY(walk.path)
      )
      SELECT path FROM walk WHERE term_id = ${fromTermId} LIMIT 1
    `;
    if (!rows.length) return null;
    return [fromTermId, ...rows[0].path];
  }

  async create(input: RelationInput) {
    const label = (input.label ?? '').trim();
    if (input.fromTermId === input.toTermId) {
      throw new BadRequestException('A term cannot relate to itself');
    }
    let fromTermId = input.fromTermId;
    let toTermId = input.toTermId;
    const [from, to] = await Promise.all([
      this.prisma.glossaryTerm.findUnique({ where: { id: fromTermId } }),
      this.prisma.glossaryTerm.findUnique({ where: { id: toTermId } }),
    ]);
    if (!from || !to) {
      throw new NotFoundException('Both terms of a relation must exist');
    }
    const invalid = validateRelationKinds(input.type, from, to, label);
    if (invalid) throw new BadRequestException(invalid);

    // RELATED is symmetric: stored once with fromTermId < toTermId.
    if (input.type === 'RELATED' && fromTermId > toTermId) {
      [fromTermId, toTermId] = [toTermId, fromTermId];
    }

    if (input.type === 'BROADER' || input.type === 'PART_OF') {
      const path = await this.cyclePath(fromTermId, toTermId, input.type);
      if (path) {
        const terms = await this.prisma.glossaryTerm.findMany({
          where: { id: { in: path } },
          select: { id: true, term: true },
        });
        const names = new Map(terms.map((term) => [term.id, term.term]));
        throw new ConflictException({
          message: `This ${input.type} relation would close a cycle: ${path
            .map((id) => names.get(id) ?? id)
            .join(' → ')}`,
          path,
        });
      }
    }

    const outgoing = await this.prisma.glossaryRelation.count({
      where: { fromTermId },
    });
    if (outgoing >= MAX_RELATIONS_PER_TERM) {
      throw new BadRequestException(
        `A term may start at most ${MAX_RELATIONS_PER_TERM} relations`,
      );
    }

    const status: GlossaryStatus =
      input.origin === 'AGENT' ? 'DRAFT' : (input.status ?? 'APPROVED');
    let created: GlossaryRelation;
    try {
      created = await this.prisma.glossaryRelation.create({
        data: {
          fromTermId,
          toTermId,
          type: input.type,
          label: input.type === 'CUSTOM' ? label : '',
          status,
          origin: input.origin,
          note: input.note ?? null,
          createdBy: input.actor ?? null,
          ...(status === 'APPROVED'
            ? { approvedBy: input.actor ?? 'operator', approvedAt: new Date() }
            : {}),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('This relation already exists');
      }
      throw error;
    }
    await recordGlossaryActivity(this.prisma, {
      type: 'RELATION_ADDED',
      termId: fromTermId,
      relationId: created.id,
      actor: input.actor ?? input.origin.toLowerCase(),
      payload: {
        type: created.type,
        label: created.label,
        from: from.id === fromTermId ? from.key : to.key,
        to: to.id === toTermId ? to.key : from.key,
        status,
      },
    });
    glossaryEvents.emit({
      type: 'glossary.relation_changed',
      change: 'created',
      relationId: created.id,
      relationType: created.type,
      fromTermId,
      toTermId,
    });
    return created;
  }

  async approve(id: string, actor = 'operator') {
    const relation = await this.prisma.glossaryRelation.findUnique({
      where: { id },
    });
    if (!relation) throw new NotFoundException(`Relation ${id} not found`);
    if (relation.status === 'APPROVED') return relation;
    const updated = await this.prisma.glossaryRelation.update({
      where: { id },
      data: { status: 'APPROVED', approvedBy: actor, approvedAt: new Date() },
    });
    await recordGlossaryActivity(this.prisma, {
      type: 'RELATION_APPROVED',
      termId: relation.fromTermId,
      relationId: id,
      actor,
      payload: { type: relation.type, label: relation.label },
    });
    glossaryEvents.emit({
      type: 'glossary.relation_changed',
      change: 'approved',
      relationId: id,
      relationType: relation.type,
      fromTermId: relation.fromTermId,
      toTermId: relation.toTermId,
    });
    return updated;
  }

  /** Back to DRAFT — the undo of an agent approval (D7). */
  async unapprove(id: string, actor = 'operator') {
    const relation = await this.prisma.glossaryRelation.findUnique({
      where: { id },
    });
    if (!relation) throw new NotFoundException(`Relation ${id} not found`);
    const updated = await this.prisma.glossaryRelation.update({
      where: { id },
      data: { status: 'DRAFT', approvedBy: null, approvedAt: null },
    });
    await recordGlossaryActivity(this.prisma, {
      type: 'RELATION_REMOVED',
      termId: relation.fromTermId,
      relationId: id,
      actor,
      payload: { type: relation.type, reverted: true },
    });
    glossaryEvents.emit({
      type: 'glossary.relation_changed',
      change: 'deleted',
      relationId: id,
      relationType: relation.type,
      fromTermId: relation.fromTermId,
      toTermId: relation.toTermId,
    });
    return updated;
  }

  async remove(id: string, actor = 'operator') {
    const relation = await this.prisma.glossaryRelation.findUnique({
      where: { id },
    });
    if (!relation) throw new NotFoundException(`Relation ${id} not found`);
    await this.prisma.glossaryRelation.delete({ where: { id } });
    await recordGlossaryActivity(this.prisma, {
      type: 'RELATION_REMOVED',
      termId: relation.fromTermId,
      relationId: id,
      actor,
      payload: {
        type: relation.type,
        label: relation.label,
        fromTermId: relation.fromTermId,
        toTermId: relation.toTermId,
      },
    });
    glossaryEvents.emit({
      type: 'glossary.relation_changed',
      change: 'deleted',
      relationId: id,
      relationType: relation.type,
      fromTermId: relation.fromTermId,
      toTermId: relation.toTermId,
    });
    return { deleted: true, id };
  }

  /**
   * Every concept below `termIds` over APPROVED BROADER relations, depth ≤ 10,
   * the roots included. "Include narrower" (SL3 R3) reads through this.
   */
  async narrowerClosure(termIds: string[]): Promise<string[]> {
    if (!termIds.length) return [];
    const rows = await this.prisma.$queryRaw<Array<{ term_id: string }>>`
      WITH RECURSIVE down(term_id, depth) AS (
        SELECT unnest(${termIds}::text[]), 0
        UNION
        SELECT r.from_term_id, down.depth + 1
          FROM glossary_relations r
          JOIN down ON r.to_term_id = down.term_id
         WHERE r.type = 'BROADER' AND r.status = 'APPROVED'
           AND down.depth < ${CLOSURE_DEPTH}
      )
      SELECT DISTINCT term_id FROM down
    `;
    return rows.map((row) => row.term_id);
  }

  /** Every concept above `termId`, the term included. */
  async broaderClosure(termId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ term_id: string }>>`
      WITH RECURSIVE up(term_id, depth) AS (
        SELECT ${termId}::text, 0
        UNION
        SELECT r.to_term_id, up.depth + 1
          FROM glossary_relations r
          JOIN up ON r.from_term_id = up.term_id
         WHERE r.type = 'BROADER' AND r.status = 'APPROVED'
           AND up.depth < ${CLOSURE_DEPTH}
      )
      SELECT DISTINCT term_id FROM up
    `;
    return rows.map((row) => row.term_id);
  }

  /**
   * One-level parents (APPROVED BROADER) for many terms at once, for "show
   * broader concepts" on the board and the Meaning card.
   */
  async parentsOf(
    termIds: string[],
  ): Promise<Array<{ fromTermId: string; toTermId: string }>> {
    if (!termIds.length) return [];
    return this.prisma.glossaryRelation.findMany({
      where: {
        fromTermId: { in: termIds },
        type: 'BROADER',
        status: 'APPROVED',
      },
      select: { fromTermId: true, toTermId: true },
    });
  }
}
