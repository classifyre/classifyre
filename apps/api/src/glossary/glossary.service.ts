import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GlossaryEntityType, GlossaryTerm, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { EmbeddingQueueService } from '../embedding/embedding-queue.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { QueryEmbeddingService } from '../embedding/query-embedding.service';
import { embeddingContentHash } from '../embedding/embedding-text';

export type GlossaryUpsertInput = {
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
        take: Math.min(params.take ?? 25, 200),
        skip: params.skip ?? 0,
      }),
      this.prisma.glossaryTerm.count({ where }),
    ]);
    return { terms: terms.map((term) => this.toDto(term)), total };
  }

  async upsert(input: GlossaryUpsertInput) {
    const term = input.term.trim();
    if (!term) throw new NotFoundException('Glossary term cannot be empty');
    const aliases = [
      ...new Set(
        (input.aliases ?? []).map((alias) => alias.trim()).filter(Boolean),
      ),
    ].slice(0, 50);
    const existing = await this.prisma.glossaryTerm.findFirst({
      where: { term: { equals: term, mode: 'insensitive' } },
    });

    // An agent proposal never overwrites operator-owned vocabulary: it may
    // only contribute aliases the operator can review.
    if (
      existing &&
      existing.origin === 'OPERATOR' &&
      input.origin === 'AGENT'
    ) {
      const mergedAliases = [...new Set([...existing.aliases, ...aliases])];
      const updated =
        mergedAliases.length === existing.aliases.length
          ? existing
          : await this.prisma.glossaryTerm.update({
              where: { id: existing.id },
              data: { aliases: mergedAliases },
            });
      await this.enqueueEmbedding(updated);
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
            aliases: [...new Set([...existing.aliases, ...aliases])],
          },
        })
      : await this.prisma.glossaryTerm.create({ data: { term, ...data } });
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
    const result = await this.prisma.glossaryTerm.deleteMany({ where: { id } });
    if (!result.count)
      throw new NotFoundException(`Glossary term ${id} not found`);
    return { deleted: true, id };
  }

  /**
   * Resolve a name/alias to glossary terms: exact and alias matches first,
   * then semantic nearest terms when a query embedding is available.
   */
  async lookup(query: string, limit = 10): Promise<GlossaryLookupHit[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const lexical = await this.prisma.glossaryTerm.findMany({
      where: {
        OR: [
          { term: { equals: trimmed, mode: 'insensitive' } },
          { term: { contains: trimmed, mode: 'insensitive' } },
          { aliases: { has: trimmed } },
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
