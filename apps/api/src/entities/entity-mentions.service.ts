import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  ENTITY_CO_MENTION_ASSETS,
  ENTITY_EXPORT_CAP,
} from './entities.constants';
import { presentFindingSnippet, type FindingSnippet } from './entity-snippets';

export interface EntityMention {
  assetId: string;
  assetName: string;
  assetType: string;
  externalUrl: string;
  sourceId: string;
  sourceName: string;
  findingId: string | null;
  findingType: string | null;
  detectorType: string;
  severity: string | null;
  label: string;
  value: string;
  valueHash: string;
  method: string;
  seenAt: Date | null;
  snippet: FindingSnippet | null;
}

/** One place a value occurs, for the review queue. */
export interface EntityOccurrence {
  assetId: string;
  assetName: string;
  sourceName: string;
  findingId: string | null;
  snippet: FindingSnippet | null;
}

export interface EntityCounters {
  mentionCount: number;
  assetCount: number;
  sourceCount: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

interface MentionRow {
  asset_id: string;
  asset_name: string;
  asset_type: string;
  external_url: string;
  source_id: string;
  source_name: string;
  finding_id: string | null;
  finding_type: string | null;
  detector_type: string;
  severity: string | null;
  label: string;
  normalized_value: string;
  value_hash: string;
  method: string;
  seen_at: Date | null;
  matched_content: string | null;
  context_before: string | null;
  context_after: string | null;
  location: unknown;
}

/** When a mention was first seen: its finding's first detection. */
const SEEN_AT = Prisma.sql`COALESCE(f.first_detected_at, f.detected_at, acv.created_at)`;

/**
 * Mentions of entities (G5 §6.3). A mention is never a stored row: it is
 *
 *   entity_values (CONFIRMED) ⋈ asset_correlation_values ON value_hash
 *
 * read through the value index's `value_hash` index. Everything here — the
 * mention list, the timeline, co-mentions, the counters and the export — is
 * that join with a different projection, which is why a value confirmed today
 * shows the mentions scanned last year.
 */
@Injectable()
export class EntityMentionsService {
  private readonly logger = new Logger(EntityMentionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private toMention(
    row: MentionRow,
    purpose: 'ui' | 'export' = 'ui',
  ): EntityMention {
    return {
      assetId: row.asset_id,
      assetName: row.asset_name,
      assetType: row.asset_type,
      externalUrl: row.external_url,
      sourceId: row.source_id,
      sourceName: row.source_name,
      findingId: row.finding_id,
      findingType: row.finding_type,
      detectorType: row.detector_type,
      severity: row.severity,
      label: row.label,
      value: row.normalized_value,
      valueHash: row.value_hash,
      method: row.method,
      seenAt: row.seen_at,
      snippet: row.finding_id
        ? presentFindingSnippet(
            {
              matchedContent: row.matched_content,
              contextBefore: row.context_before,
              contextAfter: row.context_after,
              location: row.location,
            },
            purpose,
          )
        : null,
    };
  }

  /**
   * One page of an entity's mentions, keyset-paged on `(asset_id,
   * value_hash)` — the value index's primary key, so a deep page costs the
   * same as the first.
   */
  async mentions(
    termId: string,
    params: {
      after?: string | null;
      limit?: number;
      sourceId?: string | null;
      purpose?: 'ui' | 'export';
    } = {},
  ): Promise<{ mentions: EntityMention[]; next: string | null }> {
    const limit = Math.min(Math.max(Number(params.limit ?? 50) || 50, 1), 500);
    const [afterAsset, afterHash] = decodeCursor(params.after);
    const rows = await this.prisma.$queryRaw<MentionRow[]>(Prisma.sql`
      SELECT acv.asset_id, a.name AS asset_name, a.asset_type, a.external_url,
             acv.source_id, s.name AS source_name,
             acv.finding_id, f.finding_type, acv.detector_type::text AS detector_type,
             f.severity::text AS severity, acv.label, acv.normalized_value,
             acv.value_hash, ev.method::text AS method, ${SEEN_AT} AS seen_at,
             f.matched_content, f.context_before, f.context_after, f.location
        FROM entity_values ev
        JOIN asset_correlation_values acv ON acv.value_hash = ev.value_hash
        JOIN assets a ON a.id = acv.asset_id
        JOIN sources s ON s.id = acv.source_id
        LEFT JOIN findings f ON f.id = acv.finding_id
       WHERE ev.term_id = ${termId} AND ev.verdict = 'CONFIRMED'
         ${params.sourceId ? Prisma.sql`AND acv.source_id = ${params.sourceId}` : Prisma.empty}
         ${
           afterAsset
             ? Prisma.sql`AND (acv.asset_id, acv.value_hash) > (${afterAsset}, ${afterHash})`
             : Prisma.empty
         }
       ORDER BY acv.asset_id, acv.value_hash
       LIMIT ${limit + 1}`);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      mentions: page.map((row) => this.toMention(row, params.purpose)),
      next:
        rows.length > limit && last
          ? encodeCursor(last.asset_id, last.value_hash)
          : null,
    };
  }

  /** Mentions per week, by when each was first seen. */
  async timeline(
    termId: string,
  ): Promise<Array<{ week: string; mentions: number }>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ week: Date; n: bigint }>
    >(Prisma.sql`
      SELECT date_trunc('week', ${SEEN_AT}) AS week, count(*) AS n
        FROM entity_values ev
        JOIN asset_correlation_values acv ON acv.value_hash = ev.value_hash
        LEFT JOIN findings f ON f.id = acv.finding_id
       WHERE ev.term_id = ${termId} AND ev.verdict = 'CONFIRMED'
       GROUP BY 1 ORDER BY 1`);
    return rows.map((row) => ({
      week: row.week.toISOString().slice(0, 10),
      mentions: Number(row.n),
    }));
  }

  /** Where an entity is mentioned: per source, with asset counts. */
  async sources(termId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        source_id: string;
        name: string;
        type: string;
        mentions: bigint;
        assets: bigint;
        last_seen: Date | null;
      }>
    >(Prisma.sql`
      SELECT acv.source_id, s.name, s.type::text AS type,
             count(*) AS mentions, count(DISTINCT acv.asset_id) AS assets,
             max(${SEEN_AT}) AS last_seen
        FROM entity_values ev
        JOIN asset_correlation_values acv ON acv.value_hash = ev.value_hash
        JOIN sources s ON s.id = acv.source_id
        LEFT JOIN findings f ON f.id = acv.finding_id
       WHERE ev.term_id = ${termId} AND ev.verdict = 'CONFIRMED'
       GROUP BY acv.source_id, s.name, s.type
       ORDER BY count(*) DESC`);
    return rows.map((row) => ({
      sourceId: row.source_id,
      name: row.name,
      type: row.type,
      mentions: Number(row.mentions),
      assets: Number(row.assets),
      lastSeenAt: row.last_seen,
    }));
  }

  /**
   * The entities that appear in the same assets, most shared first.
   *
   * The asset set is bounded first — the entity's latest 5,000 mention
   * assets — and only then joined to the other values in those assets and on
   * to the entities that hold them. Bound the scan, then join: joining first
   * would read every value of every document a hub entity touches. Computed
   * on demand and never stored as edges, which is what keeps a company named
   * in half the corpus from fanning out the graph (field report P13).
   */
  async coMentions(termId: string, limit = 20) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        term_id: string;
        term: string;
        key: string;
        entity_type: string;
        assets: bigint;
      }>
    >`
      WITH mine AS (
        SELECT DISTINCT acv.asset_id
          FROM entity_values ev
          JOIN asset_correlation_values acv ON acv.value_hash = ev.value_hash
         WHERE ev.term_id = ${termId} AND ev.verdict = 'CONFIRMED'
         ORDER BY acv.asset_id DESC
         LIMIT ${ENTITY_CO_MENTION_ASSETS}
      )
      SELECT t.id AS term_id, t.term, t.key, t.entity_type::text AS entity_type,
             count(DISTINCT other.asset_id) AS assets
        FROM mine
        JOIN asset_correlation_values other ON other.asset_id = mine.asset_id
        JOIN entity_values ov ON ov.value_hash = other.value_hash
                             AND ov.verdict = 'CONFIRMED' AND ov.term_id <> ${termId}
        JOIN glossary_terms t ON t.id = ov.term_id
                             AND t.kind = 'ENTITY' AND t.status <> 'DEPRECATED'
       GROUP BY t.id, t.term, t.key, t.entity_type
       ORDER BY count(DISTINCT other.asset_id) DESC, t.term
       LIMIT ${Math.min(Math.max(limit, 1), 100)}`;
    return rows.map((row) => ({
      id: row.term_id,
      term: row.term,
      key: row.key,
      entityType: row.entity_type,
      sharedAssets: Number(row.assets),
    }));
  }

  // ── Counters (R8) ───────────────────────────────────────────────────────

  /** Live counters for some entities, straight from the join. */
  async counters(termIds: string[]): Promise<Map<string, EntityCounters>> {
    const out = new Map<string, EntityCounters>();
    if (!termIds.length) return out;
    const rows = await this.prisma.$queryRaw<
      Array<{
        term_id: string;
        mentions: bigint;
        assets: bigint;
        sources: bigint;
        first_seen: Date | null;
        last_seen: Date | null;
      }>
    >(Prisma.sql`
      SELECT ev.term_id, count(*) AS mentions,
             count(DISTINCT acv.asset_id) AS assets,
             count(DISTINCT acv.source_id) AS sources,
             min(${SEEN_AT}) AS first_seen, max(${SEEN_AT}) AS last_seen
        FROM entity_values ev
        JOIN asset_correlation_values acv ON acv.value_hash = ev.value_hash
        LEFT JOIN findings f ON f.id = acv.finding_id
       WHERE ev.term_id = ANY(${termIds}::text[]) AND ev.verdict = 'CONFIRMED'
       GROUP BY ev.term_id`);
    for (const row of rows) {
      out.set(row.term_id, {
        mentionCount: Number(row.mentions),
        assetCount: Number(row.assets),
        sourceCount: Number(row.sources),
        firstSeenAt: row.first_seen,
        lastSeenAt: row.last_seen,
      });
    }
    return out;
  }

  /**
   * Recompute and store the counters of these entities. An entity with no
   * mentions left keeps `firstSeenAt` and `lastSeenAt` as the record of when
   * it was last seen, and its counts go to zero.
   */
  async recount(termIds: string[]): Promise<number> {
    const ids = [...new Set(termIds)].filter(Boolean);
    let written = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const live = await this.counters(chunk);
      for (const termId of chunk) {
        const c = live.get(termId);
        await this.prisma.glossaryTerm.updateMany({
          where: { id: termId, kind: 'ENTITY' },
          data: c
            ? {
                mentionCount: c.mentionCount,
                assetCount: c.assetCount,
                sourceCount: c.sourceCount,
                firstSeenAt: c.firstSeenAt,
                lastSeenAt: c.lastSeenAt,
              }
            : { mentionCount: 0, assetCount: 0, sourceCount: 0 },
        });
        written += 1;
      }
    }
    return written;
  }

  /** Every entity, paged. The nightly recount and the one after an import. */
  async recountAll(): Promise<number> {
    let total = 0;
    let cursor: string | undefined;
    for (;;) {
      const page = await this.prisma.glossaryTerm.findMany({
        where: { kind: 'ENTITY' },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 500,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (!page.length) break;
      total += await this.recount(page.map((term) => term.id));
      cursor = page[page.length - 1].id;
      if (page.length < 500) break;
    }
    return total;
  }

  /** Entities whose confirmed values occur in these assets. */
  async entitiesInAssets(assetIds: string[]): Promise<string[]> {
    if (!assetIds.length) return [];
    const rows = await this.prisma.$queryRaw<Array<{ term_id: string }>>`
      SELECT DISTINCT ev.term_id
        FROM asset_correlation_values acv
        JOIN entity_values ev ON ev.value_hash = acv.value_hash AND ev.verdict = 'CONFIRMED'
       WHERE acv.asset_id = ANY(${assetIds}::text[])
      UNION
      SELECT DISTINCT t.term_id FROM asset_terms t
       WHERE t.asset_id = ANY(${assetIds}::text[]) AND t.method = 'MENTION'`;
    return rows.map((row) => row.term_id);
  }

  /**
   * The entities each of these findings mentions, for Meaning cards and
   * exports. A finding is a mention when it is the value index's
   * representative finding for a confirmed value in its asset.
   */
  async entitiesOfFindings(
    findingIds: string[],
  ): Promise<
    Map<
      string,
      Array<{
        termId: string;
        method: string;
        label: string;
        since: Date | null;
      }>
    >
  > {
    const out = new Map<
      string,
      Array<{
        termId: string;
        method: string;
        label: string;
        since: Date | null;
      }>
    >();
    if (!findingIds.length) return out;
    const rows = await this.prisma.$queryRaw<
      Array<{
        finding_id: string;
        term_id: string;
        method: string;
        label: string;
        decided_at: Date | null;
      }>
    >`
      SELECT acv.finding_id, ev.term_id, ev.method::text AS method, ev.label, ev.decided_at
        FROM asset_correlation_values acv
        JOIN entity_values ev ON ev.value_hash = acv.value_hash AND ev.verdict = 'CONFIRMED'
        JOIN glossary_terms t ON t.id = ev.term_id AND t.kind = 'ENTITY' AND t.status = 'APPROVED'
       WHERE acv.finding_id = ANY(${findingIds}::text[])`;
    for (const row of rows) {
      const list = out.get(row.finding_id) ?? [];
      list.push({
        termId: row.term_id,
        method: row.method,
        label: row.label,
        since: row.decided_at,
      });
      out.set(row.finding_id, list);
    }
    return out;
  }

  // ── Occurrences for the review queue (R15) ──────────────────────────────

  /** Up to `perValue` occurrences of each value, with a snippet. */
  async occurrences(
    hashes: string[],
    perValue = 3,
  ): Promise<Map<string, EntityOccurrence[]>> {
    const out = new Map<string, EntityOccurrence[]>();
    if (!hashes.length) return out;
    const rows = await this.prisma.$queryRaw<
      Array<{
        value_hash: string;
        asset_id: string;
        asset_name: string;
        source_name: string;
        finding_id: string | null;
        matched_content: string | null;
        context_before: string | null;
        context_after: string | null;
        location: unknown;
      }>
    >`
      SELECT h.value_hash, o.*
        FROM unnest(${[...new Set(hashes)]}::text[]) AS h(value_hash)
        CROSS JOIN LATERAL (
          SELECT acv.asset_id, a.name AS asset_name, s.name AS source_name,
                 acv.finding_id, f.matched_content, f.context_before,
                 f.context_after, f.location
            FROM asset_correlation_values acv
            JOIN assets a ON a.id = acv.asset_id
            JOIN sources s ON s.id = acv.source_id
            LEFT JOIN findings f ON f.id = acv.finding_id
           WHERE acv.value_hash = h.value_hash
           LIMIT ${Math.min(Math.max(perValue, 1), 10)}
        ) o`;
    for (const row of rows) {
      const list = out.get(row.value_hash) ?? [];
      list.push({
        assetId: row.asset_id,
        assetName: row.asset_name,
        sourceName: row.source_name,
        findingId: row.finding_id,
        snippet: row.finding_id
          ? presentFindingSnippet(
              {
                matchedContent: row.matched_content,
                contextBefore: row.context_before,
                contextAfter: row.context_after,
                location: row.location,
              },
              'ui',
            )
          : null,
      });
      out.set(row.value_hash, list);
    }
    return out;
  }

  // ── Access-request export (R20) ─────────────────────────────────────────

  /** Every mention, capped, for "what do we hold about this person". */
  async exportRows(termId: string): Promise<{
    rows: EntityMention[];
    truncated: boolean;
  }> {
    const rows: EntityMention[] = [];
    let after: string | null = null;
    for (;;) {
      const page = await this.mentions(termId, {
        after,
        limit: 500,
        purpose: 'export',
      });
      rows.push(...page.mentions);
      if (!page.next || rows.length >= ENTITY_EXPORT_CAP) {
        return {
          rows: rows.slice(0, ENTITY_EXPORT_CAP),
          truncated: Boolean(page.next),
        };
      }
      after = page.next;
    }
  }
}

function encodeCursor(assetId: string, hash: string): string {
  return Buffer.from(`${assetId}\u0000${hash}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor?: string | null): [string | null, string | null] {
  if (!cursor) return [null, null];
  try {
    const [assetId, hash] = Buffer.from(cursor, 'base64url')
      .toString('utf8')
      .split('\u0000');
    return assetId && hash ? [assetId, hash] : [null, null];
  } catch {
    return [null, null];
  }
}

/** RFC 4180 CSV of an access-request export. */
export function mentionsCsv(rows: EntityMention[]): string {
  const header = [
    'asset',
    'asset_url',
    'source',
    'location',
    'finding_type',
    'detector',
    'label',
    'value',
    'context',
    'first_seen',
  ];
  const cell = (value: unknown) => {
    const text = value == null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = rows.map((row) =>
    [
      row.assetName,
      row.externalUrl,
      row.sourceName,
      row.snippet?.location ?? '',
      row.findingType ?? '',
      row.detectorType,
      row.label,
      row.snippet?.matched ?? row.value,
      row.snippet
        ? `${row.snippet.before}${row.snippet.matched}${row.snippet.after}`
        : '',
      row.seenAt ? row.seenAt.toISOString() : '',
    ]
      .map(cell)
      .join(','),
  );
  return [header.join(','), ...lines].join('\r\n') + '\r\n';
}
