import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { GlossaryEntityType, GlossaryTerm, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { EmbeddingQueueService } from '../embedding/embedding-queue.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { QueryEmbeddingService } from '../embedding/query-embedding.service';
import { embeddingContentHash } from '../embedding/embedding-text';

export type GlossaryUpsertInput = {
  id?: string;
  term: string;
  aliases?: string[];
  entityType?: GlossaryEntityType;
  notes?: string;
  refType?: string;
  refId?: string;
  origin: 'AGENT' | 'OPERATOR';
  author?: string;
  verified?: boolean;
};

export type GlossaryLookupHit = {
  id: string;
  term: string;
  aliases: string[];
  entityType: GlossaryEntityType;
  notes: string | null;
  origin: string;
  verified: boolean;
  matchType: 'exact' | 'alias' | 'semantic';
  similarity?: number;
};

/**
 * Shared investigation vocabulary. Operators curate terms in the UI; agents
 * may propose them (origin AGENT, unverified until an operator confirms).
 * Terms are embedded through the shared content store so lookups can resolve
 * semantically (nicknames, transliterations, paraphrases) as well as exactly.
 */
@Injectable()
export class GlossaryService {
  private readonly logger = new Logger(GlossaryService.name);

  // Query params arrive as strings (no global ValidationPipe), so numeric
  // inputs must be coerced here before they reach Prisma.
  private toInt(value: unknown, fallback: number, max: number): number {
    const parsed = Math.trunc(Number(value));
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.min(parsed, max);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: EmbeddingQueueService,
    private readonly embeddings: EmbeddingService,
    private readonly queryEmbedding: QueryEmbeddingService,
  ) {}

  private embeddingText(term: {
    term: string;
    aliases: string[];
    notes?: string | null;
  }): string {
    return [term.term, ...term.aliases, term.notes ?? '']
      .filter(Boolean)
      .join('\n');
  }

  async list(params: {
    query?: string;
    entityType?: GlossaryEntityType;
    take?: number;
    skip?: number;
  }) {
    const where: Prisma.GlossaryTermWhereInput = {
      ...(params.entityType ? { entityType: params.entityType } : {}),
      ...(params.query
        ? {
            OR: [
              { term: { contains: params.query, mode: 'insensitive' } },
              { aliases: { has: params.query } },
              { notes: { contains: params.query, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [terms, total] = await Promise.all([
      this.prisma.glossaryTerm.findMany({
        where,
        orderBy: { term: 'asc' },
        take: this.toInt(params.take ?? 25, 25, 200),
        skip: this.toInt(params.skip ?? 0, 0, Number.MAX_SAFE_INTEGER),
      }),
      this.prisma.glossaryTerm.count({ where }),
    ]);
    return { terms: terms.map((term) => this.toDto(term)), total };
  }

  // Machine-style identifiers (snake/kebab slugs, uuid fragments, long hex)
  // are memory keys, not vocabulary. Rejecting them at the boundary keeps the
  // operator-facing glossary human and teaches agents in-run.
  private looksLikeMachineSlug(term: string): boolean {
    return (
      /^[a-z0-9]+([_-][a-z0-9]+)+$/.test(term) ||
      /[0-9a-f]{8,}/i.test(term.replace(/\s/g, ''))
    );
  }

  private deletionKey(term: string): string {
    const normalized = term.trim().toLowerCase().replace(/\s+/g, ' ');
    const slug = normalized
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 160);
    const digest = createHash('sha256')
      .update(normalized)
      .digest('hex')
      .slice(0, 12);
    return `deleted-glossary-${slug || 'term'}-${digest}`;
  }

  async upsert(input: GlossaryUpsertInput) {
    const term = input.term.trim();
    if (!term) throw new NotFoundException('Glossary term cannot be empty');
    if (input.origin === 'AGENT' && this.looksLikeMachineSlug(term)) {
      throw new BadRequestException(
        `"${term}" looks like a machine identifier, not vocabulary. Glossary terms are real-world names as a human writes them ("Jane Doe", "Project Aurora", "NHS number"). Observations and summaries belong in memory.write, not the glossary.`,
      );
    }
    if (input.origin === 'AGENT') {
      const deleted = await this.prisma.agentMemory.findUnique({
        where: {
          kind_key: {
            kind: 'DECISION_PRECEDENT',
            key: this.deletionKey(term),
          },
        },
        select: { id: true },
      });
      if (deleted) {
        throw new BadRequestException(
          `"${term}" was deleted by an operator and cannot be re-proposed`,
        );
      }
    }
    const aliases = [
      ...new Set(
        (input.aliases ?? []).map((alias) => alias.trim()).filter(Boolean),
      ),
    ].slice(0, 50);
    const edited = input.id
      ? await this.prisma.glossaryTerm.findUnique({ where: { id: input.id } })
      : null;
    if (input.id && !edited) {
      throw new NotFoundException(`Glossary term ${input.id} not found`);
    }
    const matchingTerm = await this.prisma.glossaryTerm.findFirst({
      where: { term: { equals: term, mode: 'insensitive' } },
    });
    if (edited && matchingTerm && matchingTerm.id !== edited.id) {
      throw new BadRequestException(`Glossary term "${term}" already exists`);
    }
    const existing = edited ?? matchingTerm;

    // Agent aliases for operator vocabulary stay in a separate pending list.
    // They are deliberately excluded from lexical and semantic lookup until
    // an operator accepts them by saving the term.
    if (
      existing &&
      existing.origin === 'OPERATOR' &&
      input.origin === 'AGENT'
    ) {
      const proposedAliases = [
        ...new Set([
          ...existing.proposedAliases,
          ...aliases.filter((alias) => !existing.aliases.includes(alias)),
        ]),
      ];
      const updated =
        proposedAliases.length === existing.proposedAliases.length
          ? existing
          : await this.prisma.glossaryTerm.update({
              where: { id: existing.id },
              data: { proposedAliases },
            });
      return { ...this.toDto(updated), merged: true };
    }

    const verified = input.origin === 'OPERATOR' || input.verified === true;
    const verifiedBy = verified
      ? (input.author ?? input.origin.toLowerCase())
      : null;
    const data = {
      aliases,
      entityType: input.entityType ?? existing?.entityType ?? 'TERM',
      notes: input.notes ?? existing?.notes ?? null,
      refType: input.refType ?? existing?.refType ?? null,
      refId: input.refId ?? existing?.refId ?? null,
      origin: input.origin,
      verifiedAt: verified ? new Date() : null,
      verifiedBy,
    } as const;
    const saved = existing
      ? await this.prisma.glossaryTerm.update({
          where: { id: existing.id },
          data: {
            ...data,
            term,
            // Operator edits are authoritative and may intentionally remove a
            // stale alias. Agent proposals are handled by the merge-only path.
            aliases:
              input.origin === 'OPERATOR'
                ? aliases
                : [...new Set([...existing.aliases, ...aliases])],
            ...(input.origin === 'OPERATOR' ? { proposedAliases: [] } : {}),
          },
        })
      : await this.prisma.glossaryTerm.create({ data: { term, ...data } });
    if (input.origin === 'OPERATOR') {
      await this.prisma.agentMemory.deleteMany({
        where: {
          kind: 'DECISION_PRECEDENT',
          key: this.deletionKey(term),
        },
      });
    }
    await this.enqueueEmbedding(saved);
    return { ...this.toDto(saved), merged: false };
  }

  private async enqueueEmbedding(term: GlossaryTerm): Promise<GlossaryTerm> {
    try {
      const text = this.embeddingText(term);
      const hash = embeddingContentHash(text);
      if (hash !== term.embedContentHash) {
        term = await this.prisma.glossaryTerm.update({
          where: { id: term.id },
          data: { embedContentHash: hash },
        });
      }
      this.queue.enqueue([{ hash, text }]);
    } catch (error) {
      // Embedding is an enhancement; the term itself must always persist.
      this.logger.warn(
        `Failed to enqueue glossary embedding: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return term;
  }

  async verify(id: string, verifiedBy?: string) {
    const existing = await this.prisma.glossaryTerm.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException(`Glossary term ${id} not found`);
    const updated = await this.prisma.glossaryTerm.update({
      where: { id },
      data: {
        verifiedAt: new Date(),
        verifiedBy: verifiedBy ?? 'operator',
      },
    });
    return this.toDto(updated);
  }

  async remove(id: string) {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.glossaryTerm.findUnique({ where: { id } });
      if (!existing)
        throw new NotFoundException(`Glossary term ${id} not found`);
      const key = this.deletionKey(existing.term);
      await tx.agentMemory.upsert({
        where: { kind_key: { kind: 'DECISION_PRECEDENT', key } },
        create: {
          kind: 'DECISION_PRECEDENT',
          key,
          content: `Operator deleted glossary term "${existing.term}". Do not re-propose it.`,
          tags: ['glossary-deletion'],
          origin: 'OPERATOR',
          verifiedAt: new Date(),
          verifiedBy: 'operator',
        },
        update: {
          content: `Operator deleted glossary term "${existing.term}". Do not re-propose it.`,
          origin: 'OPERATOR',
          verifiedAt: new Date(),
          verifiedBy: 'operator',
        },
      });
      await tx.glossaryTerm.delete({ where: { id } });
    });
    return { deleted: true, id };
  }

  /**
   * Resolve a name/alias to glossary terms: exact and alias matches first,
   * then semantic nearest terms when a query embedding is available.
   */
  async lookup(
    query: string,
    limitInput: unknown = 10,
  ): Promise<GlossaryLookupHit[]> {
    const limit = this.toInt(limitInput, 10, 50) || 10;
    const trimmed = query.trim();
    if (!trimmed) return [];
    const aliasRows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT DISTINCT gt.id
      FROM glossary_terms gt
      CROSS JOIN LATERAL unnest(gt.aliases) AS alias
      WHERE lower(alias) = lower(${trimmed})
      LIMIT ${limit}
    `;
    const lexical = await this.prisma.glossaryTerm.findMany({
      where: {
        OR: [
          { term: { equals: trimmed, mode: 'insensitive' } },
          { term: { contains: trimmed, mode: 'insensitive' } },
          { id: { in: aliasRows.map((row) => row.id) } },
        ],
      },
      take: limit,
      orderBy: { term: 'asc' },
    });
    const hits: GlossaryLookupHit[] = lexical.map((term) => ({
      ...this.toDto(term),
      matchType:
        term.term.toLowerCase() === trimmed.toLowerCase() ? 'exact' : 'alias',
    }));
    const seen = new Set(hits.map((hit) => hit.id));

    if (hits.length < limit) {
      const semantic = await this.semanticLookup(
        trimmed,
        limit - hits.length,
        seen,
      );
      hits.push(...semantic);
    }
    return hits;
  }

  private async semanticLookup(
    query: string,
    limit: number,
    excludeIds: Set<string>,
  ): Promise<GlossaryLookupHit[]> {
    let vector: number[];
    try {
      vector = await this.queryEmbedding.embed(query);
    } catch {
      return [];
    }
    try {
      const space = await this.embeddings.configuredSpace();
      const dim = Prisma.raw(String(space.dim));
      const rows = await this.prisma.$queryRaw<
        Array<{ id: string; score: number }>
      >(Prisma.sql`
        SELECT gt.id, 1 - (
          ce.vec::public.vector(${dim}) <=>
          ${JSON.stringify(vector)}::public.vector(${dim})
        ) AS score
        FROM glossary_terms gt
        JOIN content_embeddings ce
          ON ce.content_hash = gt.embed_content_hash
         AND ce.space_id = ${space.id}
        ORDER BY ce.vec::public.vector(${dim}) <=>
          ${JSON.stringify(vector)}::public.vector(${dim})
        LIMIT ${limit + excludeIds.size}
      `);
      const candidates = rows.filter((row) => !excludeIds.has(row.id));
      const terms = await this.prisma.glossaryTerm.findMany({
        where: { id: { in: candidates.map((row) => row.id) } },
      });
      const byId = new Map(terms.map((term) => [term.id, term]));
      return candidates.slice(0, limit).flatMap((row) => {
        const term = byId.get(row.id);
        return term
          ? [
              {
                ...this.toDto(term),
                matchType: 'semantic' as const,
                similarity: Math.round(Number(row.score) * 100) / 100,
              },
            ]
          : [];
      });
    } catch (error) {
      this.logger.warn(
        `Semantic glossary lookup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private toDto(term: GlossaryTerm) {
    return {
      id: term.id,
      term: term.term,
      aliases: term.aliases,
      proposedAliases: term.proposedAliases,
      entityType: term.entityType,
      notes: term.notes,
      refType: term.refType,
      refId: term.refId,
      origin: String(term.origin),
      verified: term.verifiedAt !== null,
      verifiedBy: term.verifiedBy,
      createdAt: term.createdAt,
      updatedAt: term.updatedAt,
    };
  }
}
