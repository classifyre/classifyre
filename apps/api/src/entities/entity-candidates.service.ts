import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { jaroWinkler } from '../correlation/fuzzy';
import {
  EntityMentionsService,
  type EntityOccurrence,
} from './entity-mentions.service';

export interface EntityCandidateItem {
  id: string;
  /** `mention`: a spelling variant. `conflict`: an identifier another entity holds (R6). */
  kind: 'mention' | 'conflict';
  term: {
    id: string;
    key: string;
    term: string;
    entityType: string;
    status: string;
  };
  label: string;
  value: string;
  method: string;
  score: number | null;
  /** The entity's own value this one resembles most. */
  resembles: string | null;
  /** How many assets carry the value. */
  occurrences: number;
  samples: EntityOccurrence[];
  conflictWith: { id: string; key: string; term: string } | null;
  agentVerdict: string | null;
  agentNote: string | null;
  createdAt: Date;
}

/**
 * The entity review queue (G5 R15): PROPOSED values, best first, each with its
 * score, how often it occurs and up to three occurrences to judge it by. A
 * view over `entity_values`; deciding is {@link EntityValuesService.review}.
 */
@Injectable()
export class EntityCandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mentions: EntityMentionsService,
  ) {}

  async counts(): Promise<{ mention: number; conflict: number }> {
    const [mention, conflict] = await Promise.all([
      this.prisma.entityValue.count({
        where: { verdict: 'PROPOSED', conflictTermId: null },
      }),
      this.prisma.entityValue.count({
        where: { verdict: 'PROPOSED', conflictTermId: { not: null } },
      }),
    ]);
    return { mention, conflict };
  }

  private async occurrenceCounts(
    hashes: string[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!hashes.length) return out;
    const rows = await this.prisma.$queryRaw<
      Array<{ value_hash: string; n: bigint }>
    >`
      SELECT value_hash, count(*) AS n FROM asset_correlation_values
       WHERE value_hash = ANY(${hashes}::text[]) GROUP BY value_hash`;
    for (const row of rows) out.set(row.value_hash, Number(row.n));
    return out;
  }

  async list(params: {
    termId?: string;
    kind?: 'mention' | 'conflict';
    minScore?: number;
    take?: number;
    skip?: number;
  }): Promise<{
    items: EntityCandidateItem[];
    total: number;
    counts: { mention: number; conflict: number };
  }> {
    const take = Math.min(Math.max(Number(params.take ?? 50) || 50, 1), 200);
    const skip = Math.max(Number(params.skip ?? 0) || 0, 0);
    const where: Prisma.EntityValueWhereInput = {
      verdict: 'PROPOSED',
      ...(params.termId ? { termId: params.termId } : {}),
      ...(params.kind === 'conflict'
        ? { conflictTermId: { not: null } }
        : params.kind === 'mention'
          ? { conflictTermId: null }
          : {}),
      ...(params.minScore !== undefined && Number.isFinite(params.minScore)
        ? { score: { gte: params.minScore } }
        : {}),
    };
    const [rows, total, counts] = await Promise.all([
      this.prisma.entityValue.findMany({
        where,
        include: {
          term: {
            select: {
              id: true,
              key: true,
              term: true,
              entityType: true,
              status: true,
            },
          },
        },
        // Conflicts first: they block an identifier until someone decides.
        orderBy: [
          { conflictTermId: { sort: 'asc', nulls: 'last' } },
          { score: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
        take,
        skip,
      }),
      this.prisma.entityValue.count({ where }),
      this.counts(),
    ]);
    const hashes = rows.map((row) => row.valueHash);
    const termIds = [...new Set(rows.map((row) => row.termId))];
    const holderIds = [
      ...new Set(
        rows
          .map((row) => row.conflictTermId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const [samples, occurrences, own, holders] = await Promise.all([
      this.mentions.occurrences(hashes),
      this.occurrenceCounts(hashes),
      this.prisma.entityValue.findMany({
        where: { termId: { in: termIds }, verdict: 'CONFIRMED' },
        select: {
          termId: true,
          label: true,
          normalizedValue: true,
          rawValue: true,
        },
      }),
      this.prisma.glossaryTerm.findMany({
        where: { id: { in: holderIds } },
        select: { id: true, key: true, term: true },
      }),
    ]);
    const holderById = new Map(holders.map((term) => [term.id, term]));
    const resembles = (row: (typeof rows)[number]): string | null => {
      let best: { value: string; score: number } | null = null;
      for (const value of own) {
        if (value.termId !== row.termId || value.label !== row.label) continue;
        const score = jaroWinkler(value.normalizedValue, row.normalizedValue);
        if (!best || score > best.score) {
          best = { value: value.rawValue ?? value.normalizedValue, score };
        }
      }
      return best?.value ?? null;
    };
    return {
      items: rows.map((row) => ({
        id: row.id,
        kind: row.conflictTermId ? 'conflict' : 'mention',
        term: row.term,
        label: row.label,
        value: row.rawValue ?? row.normalizedValue,
        method: row.method,
        score: row.score,
        resembles: row.conflictTermId ? null : resembles(row),
        occurrences: occurrences.get(row.valueHash) ?? 0,
        samples: samples.get(row.valueHash) ?? [],
        conflictWith: row.conflictTermId
          ? (holderById.get(row.conflictTermId) ?? null)
          : null,
        agentVerdict: row.agentVerdict,
        agentNote: row.agentNote,
        createdAt: row.createdAt,
      })),
      total,
      counts,
    };
  }
}
