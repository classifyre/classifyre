import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GlossaryReferenceRole,
  Prisma,
  SemanticLinkMethod,
} from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { BindingsService } from '../bindings/bindings.service';
import {
  findingTermsSql,
  matchFindingTerms,
  metadataValues,
} from '../bindings/binding-compiler';
import { compileBindingRow } from '../bindings/bindings.service';
import { isOutputMode, vocabularyLabel } from '../bindings/binding-spec';
import { GlossaryRelationsService } from '../../glossary/glossary-relations.service';
import { glossaryEvents } from '../../glossary/glossary-events';
import { recordGlossaryActivity } from '../../glossary/glossary-activity';
import { excerpt } from '../semantic-sql';
import { SemanticJobsScheduler } from '../semantic-jobs.scheduler';

const GONE_HISTORY_DAYS = 90;
const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

/** Contract C11: one meaning of a finding, asset or case, and how we know. */
export interface MeaningItem {
  term: {
    id: string;
    key: string;
    name: string;
    kind: string;
    status: string;
    scheme: {
      id: string;
      key: string;
      name: string;
      color: string | null;
    } | null;
  };
  method: SemanticLinkMethod | 'BROADER';
  confidence: number;
  support: number;
  binding?: {
    id: string;
    mode: string;
    label: string;
    approvedBy: string | null;
    approvedAt: Date | null;
    origin: string;
  } | null;
  declaredBy?: { edgeId: string; evidence: unknown } | null;
  linkedBy?: {
    referenceId: string;
    by: string | null;
    note: string | null;
  } | null;
  /** For BROADER items: the narrower term it is implied by. */
  via?: { id: string; key: string; name: string } | null;
  since: Date | null;
  goneAt?: Date | null;
}

type TermRow = {
  id: string;
  key: string;
  term: string;
  kind: string;
  status: string;
  scheme: {
    id: string;
    key: string;
    name: string;
    color: string | null;
  } | null;
};

/**
 * Reads of the semantic lineage (SL3 R4, R5). Finding-level answers are
 * resolved on read — through the binding compiler's in-memory half and manual
 * references — never stored per finding (rule SL-2).
 */
@Injectable()
export class MeaningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bindings: BindingsService,
    private readonly relations: GlossaryRelationsService,
    private readonly jobs: SemanticJobsScheduler,
  ) {}

  private async termRows(ids: string[]): Promise<Map<string, TermRow>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.glossaryTerm.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: {
        id: true,
        key: true,
        term: true,
        kind: true,
        status: true,
        scheme: { select: { id: true, key: true, name: true, color: true } },
      },
    });
    return new Map(rows.map((row) => [row.id, row]));
  }

  private termRef(row: TermRow): MeaningItem['term'] {
    return {
      id: row.id,
      key: row.key,
      name: row.term,
      kind: row.kind,
      status: row.status,
      scheme: row.scheme,
    };
  }

  // ── Findings ───────────────────────────────────────────────────────────

  async findingMeaning(findingId: string): Promise<{
    findingId: string;
    assetId: string;
    output: {
      detectorType: string;
      customDetectorKey: string | null;
      findingType: string;
      label: { label: string; detail: string };
    };
    meanings: MeaningItem[];
  }> {
    const finding = await this.prisma.finding.findUnique({
      where: { id: findingId },
      select: {
        id: true,
        assetId: true,
        sourceId: true,
        detectorType: true,
        customDetectorKey: true,
        customDetectorName: true,
        findingType: true,
        matchedContent: true,
        status: true,
        createdAt: true,
      },
    });
    if (!finding) throw new NotFoundException(`Finding ${findingId} not found`);
    const meanings = await this.meaningsOfFindings([finding]);
    return {
      findingId,
      assetId: finding.assetId,
      output: {
        detectorType: finding.detectorType,
        customDetectorKey: finding.customDetectorKey,
        findingType: finding.findingType,
        label: vocabularyLabel({
          detectorType: finding.detectorType,
          customDetectorKey: finding.customDetectorKey,
          customDetectorName: finding.customDetectorName,
          findingType: finding.findingType,
        }),
      },
      meanings: meanings.get(findingId) ?? [],
    };
  }

  /**
   * Meanings for many findings at once (board layer, exports, MCP): APPROVED
   * bindings evaluated in memory, plus MANUAL references, plus one level of
   * broader concepts marked as implied.
   */
  async meaningsOfFindings(
    findings: Array<{
      id: string;
      sourceId: string;
      detectorType: string;
      customDetectorKey: string | null;
      findingType: string;
      matchedContent: string;
      status: string;
      createdAt?: Date;
    }>,
    options: { broader?: boolean } = { broader: true },
  ): Promise<Map<string, MeaningItem[]>> {
    const out = new Map<string, MeaningItem[]>();
    if (!findings.length) return out;
    const active = await this.bindings.active();
    const bindingRows = active.bindings.length
      ? await this.prisma.glossaryBinding.findMany({
          where: { id: { in: active.bindings.map((b) => b.id) } },
          select: {
            id: true,
            mode: true,
            approvedBy: true,
            approvedAt: true,
            origin: true,
            detectorType: true,
            customDetectorKey: true,
            findingType: true,
            metadataPath: true,
          },
        })
      : [];
    const bindingInfo = new Map(bindingRows.map((row) => [row.id, row]));
    const references = await this.prisma.glossaryReference.findMany({
      where: {
        role: GlossaryReferenceRole.ABOUT,
        entityType: 'finding',
        entityId: { in: findings.map((f) => f.id) },
      },
    });
    const pairs: Array<{
      findingId: string;
      termId: string;
      item: Omit<MeaningItem, 'term'>;
    }> = [];
    for (const finding of findings) {
      for (const binding of active.bindings) {
        if (!isOutputMode(binding.mode)) continue;
        for (const termId of matchFindingTerms(
          binding,
          finding,
          active.index,
        )) {
          const info = bindingInfo.get(binding.id);
          pairs.push({
            findingId: finding.id,
            termId,
            item: {
              method: 'BINDING',
              confidence: binding.confidence,
              support: 1,
              binding: info
                ? {
                    id: info.id,
                    mode: info.mode,
                    label: vocabularyLabel(info).label,
                    approvedBy: info.approvedBy,
                    approvedAt: info.approvedAt,
                    origin: info.origin,
                  }
                : null,
              since: info?.approvedAt ?? null,
            },
          });
        }
      }
    }
    for (const reference of references) {
      pairs.push({
        findingId: reference.entityId,
        termId: reference.glossaryTermId,
        item: {
          method: 'MANUAL',
          confidence: 1,
          support: 1,
          linkedBy: {
            referenceId: reference.id,
            by: reference.createdBy,
            note: reference.note,
          },
          since: reference.createdAt,
        },
      });
    }
    const terms = await this.termRows(pairs.map((pair) => pair.termId));
    const parents =
      options.broader === false
        ? []
        : await this.relations.parentsOf([...terms.keys()]);
    const parentTerms = await this.termRows(parents.map((p) => p.toTermId));
    for (const pair of pairs) {
      const term = terms.get(pair.termId);
      if (!term) continue;
      // MANUAL links to a DRAFT term are visible but inert (SL-5): shown.
      if (pair.item.method === 'BINDING' && term.status !== 'APPROVED')
        continue;
      const list = out.get(pair.findingId) ?? [];
      list.push({ ...pair.item, term: this.termRef(term) });
      out.set(pair.findingId, list);
    }
    for (const [findingId, list] of out) {
      const direct = new Set(list.map((item) => item.term.id));
      const implied = new Map<string, MeaningItem>();
      for (const item of list) {
        for (const parent of parents.filter(
          (p) => p.fromTermId === item.term.id,
        )) {
          if (direct.has(parent.toTermId) || implied.has(parent.toTermId))
            continue;
          const term = parentTerms.get(parent.toTermId);
          if (!term) continue;
          implied.set(parent.toTermId, {
            term: this.termRef(term),
            method: 'BROADER',
            confidence: item.confidence,
            support: item.support,
            via: { id: item.term.id, key: item.term.key, name: item.term.name },
            since: item.since,
          });
        }
      }
      out.set(findingId, [...list, ...implied.values()]);
    }
    return out;
  }

  // ── Assets ─────────────────────────────────────────────────────────────

  async assetMeaning(assetId: string, includeHistory = false) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true, name: true, sourceId: true },
    });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);
    const since = new Date(Date.now() - GONE_HISTORY_DAYS * 86_400_000);
    const rows = await this.prisma.assetTerm.findMany({
      where: {
        assetId,
        OR: [
          { goneAt: null },
          ...(includeHistory ? [{ goneAt: { gte: since } }] : []),
        ],
      },
      include: {
        term: {
          select: {
            id: true,
            key: true,
            term: true,
            kind: true,
            status: true,
            scheme: {
              select: { id: true, key: true, name: true, color: true },
            },
          },
        },
      },
    });
    const bindingIds = [...new Set(rows.flatMap((row) => row.bindingIds))];
    const bindingRows = bindingIds.length
      ? await this.prisma.glossaryBinding.findMany({
          where: { id: { in: bindingIds } },
        })
      : [];
    const bindingById = new Map(bindingRows.map((row) => [row.id, row]));
    const byTerm = new Map<
      string,
      {
        term: MeaningItem['term'];
        current: boolean;
        methods: Array<{
          method: SemanticLinkMethod;
          support: number;
          confidence: number;
          maxSeverity: string | null;
          sampleFindingId: string | null;
          since: Date;
          lastLinkedAt: Date;
          goneAt: Date | null;
          bindings: Array<{
            id: string;
            mode: string;
            label: string;
            approvedBy: string | null;
            approvedAt: Date | null;
          }>;
        }>;
      }
    >();
    for (const row of rows) {
      const entry = byTerm.get(row.termId) ?? {
        term: this.termRef(row.term),
        current: false,
        methods: [],
      };
      entry.current = entry.current || row.goneAt === null;
      entry.methods.push({
        method: row.method,
        support: row.supportCount,
        confidence: Number(row.confidence),
        maxSeverity: row.maxSeverity,
        sampleFindingId: row.sampleFindingId,
        since: row.firstLinkedAt,
        lastLinkedAt: row.lastLinkedAt,
        goneAt: row.goneAt,
        bindings: row.bindingIds
          .map((id) => bindingById.get(id))
          .filter((b): b is NonNullable<typeof b> => Boolean(b))
          .map((b) => ({
            id: b.id,
            mode: b.mode,
            label: isOutputMode(b.mode)
              ? vocabularyLabel(b).label
              : (b.metadataPath ?? ''),
            approvedBy: b.approvedBy,
            approvedAt: b.approvedAt,
          })),
      });
      byTerm.set(row.termId, entry);
    }
    const terms = [...byTerm.values()].sort(
      (a, b) =>
        Number(b.current) - Number(a.current) ||
        b.methods.reduce((s, m) => s + m.support, 0) -
          a.methods.reduce((s, m) => s + m.support, 0),
    );
    return {
      assetId,
      assetName: asset.name,
      current: terms.filter((t) => t.current),
      history: includeHistory ? terms.filter((t) => !t.current) : [],
    };
  }

  /** Why this asset is about this term (SL3 R4). */
  async assetTermEvidence(assetId: string, termId: string, page = 0) {
    const pageSize = 25;
    const rows = await this.prisma.assetTerm.findMany({
      where: { assetId, termId },
    });
    if (!rows.length) {
      throw new NotFoundException('This asset has no link to this term');
    }
    const term = (await this.termRows([termId])).get(termId);
    const evidence: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      if (row.method === 'BINDING') {
        for (const bindingId of row.bindingIds) {
          const binding = await this.prisma.glossaryBinding.findUnique({
            where: { id: bindingId },
          });
          if (!binding) continue;
          const compiled = compileBindingRow(binding);
          if (isOutputMode(binding.mode)) {
            const sql = findingTermsSql(
              compiled,
              Prisma.sql`f.asset_id = ${assetId}`,
            );
            const findings = sql
              ? await this.prisma.$queryRaw<
                  Array<{ finding_id: string; term_id: string }>
                >(Prisma.sql`SELECT DISTINCT x.finding_id, x.term_id FROM (${sql}) x WHERE x.term_id = ${termId}
                             ORDER BY x.finding_id LIMIT ${pageSize} OFFSET ${page * pageSize}`)
              : [];
            const details = findings.length
              ? await this.prisma.finding.findMany({
                  where: { id: { in: findings.map((f) => f.finding_id) } },
                  select: {
                    id: true,
                    findingType: true,
                    severity: true,
                    matchedContent: true,
                    redactedContent: true,
                    status: true,
                    lastDetectedAt: true,
                  },
                })
              : [];
            evidence.push({
              method: 'BINDING',
              binding: await this.bindings.get(binding.id),
              findings: details.map((f) => ({
                id: f.id,
                findingType: f.findingType,
                severity: f.severity,
                status: f.status,
                value: excerpt(f.redactedContent ?? f.matchedContent),
                lastDetectedAt: f.lastDetectedAt,
              })),
              total: row.supportCount,
            });
          } else {
            const asset = await this.prisma.asset.findUnique({
              where: { id: assetId },
              select: { metadata: true },
            });
            evidence.push({
              method: 'BINDING',
              binding: await this.bindings.get(binding.id),
              field: binding.metadataPath,
              values: metadataValues(
                asset?.metadata,
                binding.metadataPath ?? '',
              ),
            });
          }
        }
      } else if (row.method === 'DECLARED') {
        const edges = await this.prisma.$queryRaw<
          Array<{
            id: string;
            evidence: unknown;
            confidence: Prisma.Decimal;
            last_seen_at: Date;
            method: string;
          }>
        >`
          SELECT e.id, e.evidence, e.confidence, e.last_seen_at, e.method::text AS method
            FROM edges e LEFT JOIN findings f ON e.from_type = 'finding' AND f.id = e.from_id
           WHERE e.to_type = 'term' AND e.to_id = ${termId} AND e.relation_type = 'MEANS'
             AND ((e.from_type = 'asset' AND e.from_id = ${assetId}) OR f.asset_id = ${assetId})
           LIMIT 50`;
        evidence.push({
          method: 'DECLARED',
          declarations: edges.map((e) => ({
            edgeId: e.id,
            evidence: e.evidence,
            confidence: Number(e.confidence),
            lastSeenAt: e.last_seen_at,
            edgeMethod: e.method,
          })),
        });
      } else if (row.method === 'MANUAL') {
        const refs = await this.prisma.$queryRaw<
          Array<{
            id: string;
            entity_type: string;
            entity_id: string;
            created_by: string | null;
            note: string | null;
            created_at: Date;
          }>
        >`
          SELECT r.id, r.entity_type, r.entity_id, r.created_by, r.note, r.created_at
            FROM glossary_references r LEFT JOIN findings f ON r.entity_type = 'finding' AND f.id = r.entity_id
           WHERE r.role = 'ABOUT' AND r.glossary_term_id = ${termId}
             AND ((r.entity_type = 'asset' AND r.entity_id = ${assetId}) OR f.asset_id = ${assetId})`;
        evidence.push({
          method: 'MANUAL',
          references: refs.map((r) => ({
            referenceId: r.id,
            target: { type: r.entity_type, id: r.entity_id },
            by: r.created_by,
            note: r.note,
            at: r.created_at,
          })),
        });
      } else if (row.method === 'SUGGESTED') {
        const suggestions = await this.prisma.semanticSuggestion.findMany({
          where: { assetId, termId, kind: 'LINK', status: 'ACCEPTED' },
          select: {
            id: true,
            score: true,
            rationale: true,
            evidence: true,
            decidedBy: true,
            decidedAt: true,
          },
        });
        evidence.push({
          method: 'SUGGESTED',
          suggestions: suggestions.map((s) => ({
            ...s,
            score: Number(s.score),
          })),
        });
      }
    }
    return {
      assetId,
      term: term ? this.termRef(term) : null,
      links: rows.map((row) => ({
        method: row.method,
        support: row.supportCount,
        confidence: Number(row.confidence),
        since: row.firstLinkedAt,
        lastLinkedAt: row.lastLinkedAt,
        goneAt: row.goneAt,
      })),
      evidence,
    };
  }

  // ── Terms ─────────────────────────────────────────────────────────────

  async termIdsFor(
    termId: string,
    includeNarrower: boolean,
  ): Promise<string[]> {
    return includeNarrower
      ? this.relations.narrowerClosure([termId])
      : [termId];
  }

  /** Assets for the term page, sorted by severity, then support (SL3 R4). */
  async termEvidence(
    termId: string,
    params: {
      includeNarrower?: boolean;
      sourceId?: string;
      method?: SemanticLinkMethod;
      status?: 'current' | 'gone' | 'all';
      page?: number;
      pageSize?: number;
    },
  ) {
    const termIds = await this.termIdsFor(
      termId,
      Boolean(params.includeNarrower),
    );
    const pageSize = Math.min(Math.max(params.pageSize ?? 50, 1), 200);
    const page = Math.max(params.page ?? 0, 0);
    const status = params.status ?? 'current';
    const filters: Prisma.Sql[] = [
      Prisma.sql`t.term_id = ANY(${termIds}::text[])`,
    ];
    if (status === 'current') filters.push(Prisma.sql`t.gone_at IS NULL`);
    if (status === 'gone') filters.push(Prisma.sql`t.gone_at IS NOT NULL`);
    if (params.sourceId)
      filters.push(Prisma.sql`t.source_id = ${params.sourceId}`);
    if (params.method)
      filters.push(
        Prisma.sql`t.method = ${params.method}::"SemanticLinkMethod"`,
      );
    const where = Prisma.join(filters, ' AND ');
    const rows = await this.prisma.$queryRaw<
      Array<{
        asset_id: string;
        asset_name: string;
        external_url: string;
        asset_type: string;
        source_id: string;
        source_name: string;
        methods: string[];
        term_ids: string[];
        support: bigint;
        max_severity: string | null;
        first_linked_at: Date;
        last_linked_at: Date;
        gone_at: Date | null;
        current: boolean;
      }>
    >(Prisma.sql`
      SELECT t.asset_id, a.name AS asset_name, a.external_url, a.asset_type,
             t.source_id, s.name AS source_name,
             array_agg(DISTINCT t.method::text) AS methods,
             array_agg(DISTINCT t.term_id) AS term_ids,
             sum(t.support_count) AS support,
             min(t.max_severity)::text AS max_severity,
             min(t.first_linked_at) AS first_linked_at,
             max(t.last_linked_at) AS last_linked_at,
             max(t.gone_at) AS gone_at,
             bool_or(t.gone_at IS NULL) AS current
        FROM asset_terms t
        JOIN assets a ON a.id = t.asset_id
        JOIN sources s ON s.id = t.source_id
       WHERE ${where}
       GROUP BY t.asset_id, a.name, a.external_url, a.asset_type, t.source_id, s.name
       ORDER BY min(t.max_severity) ASC NULLS LAST, sum(t.support_count) DESC, t.asset_id
       LIMIT ${pageSize} OFFSET ${page * pageSize}`);
    const [count] = await this.prisma.$queryRaw<
      Array<{ n: bigint }>
    >(Prisma.sql`
      SELECT count(DISTINCT t.asset_id) AS n FROM asset_terms t WHERE ${where}`);
    const terms = await this.termRows([
      ...new Set(rows.flatMap((r) => r.term_ids)),
    ]);
    return {
      termId,
      includeNarrower: Boolean(params.includeNarrower),
      total: Number(count?.n ?? 0),
      page,
      pageSize,
      assets: rows.map((row) => ({
        assetId: row.asset_id,
        assetName: row.asset_name,
        externalUrl: row.external_url,
        assetType: row.asset_type,
        source: { id: row.source_id, name: row.source_name },
        methods: row.methods,
        terms: row.term_ids
          .map((id) => terms.get(id))
          .filter((t): t is TermRow => Boolean(t))
          .map((t) => ({ id: t.id, key: t.key, name: t.term })),
        support: Number(row.support),
        maxSeverity: row.max_severity,
        firstLinkedAt: row.first_linked_at,
        lastLinkedAt: row.last_linked_at,
        goneAt: row.current ? null : row.gone_at,
      })),
    };
  }

  /** Counts, by method, source and severity, and a weekly trend (SL3 R4). */
  async termSummary(termId: string, includeNarrower = false) {
    const direct = [termId];
    const withNarrower = await this.relations.narrowerClosure([termId]);
    const ids = includeNarrower ? withNarrower : direct;
    const [counts] = await this.prisma.$queryRaw<
      Array<{ assets: bigint; sources: bigint; findings: bigint }>
    >`
      SELECT count(DISTINCT asset_id) AS assets, count(DISTINCT source_id) AS sources,
             coalesce(sum(support_count) FILTER (WHERE method IN ('BINDING', 'MANUAL')), 0) AS findings
        FROM asset_terms WHERE term_id = ANY(${ids}::text[]) AND gone_at IS NULL`;
    const [directCount] = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(DISTINCT asset_id) AS n FROM asset_terms
       WHERE term_id = ${termId} AND gone_at IS NULL`;
    const [narrowerCount] = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(DISTINCT asset_id) AS n FROM asset_terms
       WHERE term_id = ANY(${withNarrower}::text[]) AND gone_at IS NULL`;
    const byMethod = await this.prisma.$queryRaw<
      Array<{ method: string; assets: bigint }>
    >`
      SELECT method::text AS method, count(DISTINCT asset_id) AS assets FROM asset_terms
       WHERE term_id = ANY(${ids}::text[]) AND gone_at IS NULL GROUP BY 1`;
    const bySource = await this.prisma.$queryRaw<
      Array<{ source_id: string; name: string; assets: bigint }>
    >`
      SELECT t.source_id, s.name, count(DISTINCT t.asset_id) AS assets
        FROM asset_terms t JOIN sources s ON s.id = t.source_id
       WHERE t.term_id = ANY(${ids}::text[]) AND t.gone_at IS NULL
       GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 50`;
    const bySeverity = await this.prisma.$queryRaw<
      Array<{ severity: string | null; assets: bigint }>
    >`
      SELECT sev::text AS severity, count(*) AS assets FROM (
        SELECT asset_id, min(max_severity) AS sev FROM asset_terms
         WHERE term_id = ANY(${ids}::text[]) AND gone_at IS NULL GROUP BY 1
      ) x GROUP BY 1`;
    const trend = await this.prisma.$queryRaw<
      Array<{ week: Date; added: bigint; gone: bigint }>
    >`
      WITH weeks AS (
        SELECT generate_series(date_trunc('week', now()) - interval '25 weeks', date_trunc('week', now()), interval '1 week') AS week
      )
      SELECT w.week,
             (SELECT count(*) FROM asset_terms t WHERE t.term_id = ANY(${ids}::text[])
                AND date_trunc('week', t.first_linked_at) = w.week) AS added,
             (SELECT count(*) FROM asset_terms t WHERE t.term_id = ANY(${ids}::text[])
                AND t.gone_at IS NOT NULL AND date_trunc('week', t.gone_at) = w.week) AS gone
        FROM weeks w ORDER BY w.week`;
    return {
      termId,
      includeNarrower,
      counts: {
        assets: Number(counts?.assets ?? 0),
        sources: Number(counts?.sources ?? 0),
        findings: Number(counts?.findings ?? 0),
        direct: Number(directCount?.n ?? 0),
        withNarrower: Number(narrowerCount?.n ?? 0),
      },
      byMethod: byMethod.map((r) => ({
        method: r.method,
        assets: Number(r.assets),
      })),
      bySource: bySource.map((r) => ({
        sourceId: r.source_id,
        name: r.name,
        assets: Number(r.assets),
      })),
      bySeverity: bySeverity
        .map((r) => ({ severity: r.severity, assets: Number(r.assets) }))
        .sort(
          (a, b) =>
            SEVERITY_ORDER.indexOf(a.severity ?? '') -
            SEVERITY_ORDER.indexOf(b.severity ?? ''),
        ),
      trend: trend.map((r) => ({
        week: r.week,
        added: Number(r.added),
        gone: Number(r.gone),
      })),
    };
  }

  /** Cases and watches that use a term (SL3 R7.3). */
  async termCasesAndWatches(termId: string) {
    const term = await this.prisma.glossaryTerm.findUnique({
      where: { id: termId },
      select: { id: true, key: true, previousKeys: true },
    });
    if (!term) throw new NotFoundException(`Glossary term ${termId} not found`);
    const cases = await this.prisma.$queryRaw<
      Array<{
        id: string;
        title: string;
        status: string;
        assets: bigint;
        about: boolean;
      }>
    >`
      SELECT c.id, c.title, c.status::text AS status,
             count(DISTINCT t.asset_id) AS assets,
             bool_or(r.id IS NOT NULL) AS about
        FROM cases c
        LEFT JOIN case_evidence ce ON ce.case_id = c.id AND ce.entity_type = 'asset'
        LEFT JOIN asset_terms t ON t.asset_id = ce.entity_id AND t.term_id = ${termId} AND t.gone_at IS NULL
        LEFT JOIN glossary_references r ON r.role = 'ABOUT' AND r.entity_type = 'case'
             AND r.entity_id = c.id AND r.glossary_term_id = ${termId}
       GROUP BY c.id, c.title, c.status
      HAVING count(DISTINCT t.asset_id) > 0 OR bool_or(r.id IS NOT NULL)
       ORDER BY bool_or(r.id IS NOT NULL) DESC, count(DISTINCT t.asset_id) DESC
       LIMIT 100`;
    const watches = await this.prisma.inquiry.findMany({
      where: { termKeys: { hasSome: [term.key, ...term.previousKeys] } },
      select: {
        id: true,
        title: true,
        status: true,
        matchCount: true,
        newMatchCount: true,
        termsIncludeNarrower: true,
      },
    });
    return {
      cases: cases.map((c) => ({ ...c, assets: Number(c.assets) })),
      watches,
    };
  }

  // ── Manual links (SL3 R5) ───────────────────────────────────────────────

  private async assertTarget(type: string, id: string): Promise<string | null> {
    if (type === 'finding') {
      const finding = await this.prisma.finding.findUnique({
        where: { id },
        select: { assetId: true },
      });
      if (!finding) throw new BadRequestException(`Finding ${id} not found`);
      return finding.assetId;
    }
    if (type === 'asset') {
      const asset = await this.prisma.asset.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!asset) throw new BadRequestException(`Asset ${id} not found`);
      return asset.id;
    }
    if (type === 'case') {
      const found = await this.prisma.case.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!found) throw new BadRequestException(`Case ${id} not found`);
      return null;
    }
    throw new BadRequestException('target.type is finding, asset or case');
  }

  /** An operator's ABOUT link: a MANUAL semantic link (or a case's subject). */
  async link(input: {
    termId: string;
    target: { type: string; id: string };
    note?: string | null;
    actor?: string;
  }) {
    const term = await this.prisma.glossaryTerm.findUnique({
      where: { id: input.termId },
      select: { id: true, key: true, kind: true },
    });
    if (!term)
      throw new NotFoundException(`Glossary term ${input.termId} not found`);
    const assetId = await this.assertTarget(input.target.type, input.target.id);
    const reference = await this.prisma.glossaryReference.upsert({
      where: {
        glossaryTermId_entityType_entityId_role: {
          glossaryTermId: term.id,
          entityType: input.target.type,
          entityId: input.target.id,
          role: GlossaryReferenceRole.ABOUT,
        },
      },
      create: {
        glossaryTermId: term.id,
        entityType: input.target.type,
        entityId: input.target.id,
        role: GlossaryReferenceRole.ABOUT,
        note: input.note ?? null,
        createdBy: input.actor ?? 'operator',
      },
      update: { note: input.note ?? undefined },
    });
    await recordGlossaryActivity(this.prisma, {
      type: 'LINK_ADDED',
      termId: term.id,
      actor: input.actor ?? 'operator',
      payload: { referenceId: reference.id, target: input.target },
    });
    glossaryEvents.emit({
      type: 'semantic.reference_changed',
      change: 'linked',
      termId: term.id,
      entityType: input.target.type,
      entityId: input.target.id,
    });
    if (assetId) {
      await this.jobs.scheduleIncrementalForAssets(
        [assetId],
        `manual link to ${term.key}`,
      );
    }
    return reference;
  }

  async unlink(referenceId: string, actor = 'operator') {
    const reference = await this.prisma.glossaryReference.findUnique({
      where: { id: referenceId },
    });
    if (!reference || reference.role !== GlossaryReferenceRole.ABOUT) {
      throw new NotFoundException(`Link ${referenceId} not found`);
    }
    await this.prisma.glossaryReference.delete({ where: { id: referenceId } });
    await recordGlossaryActivity(this.prisma, {
      type: 'LINK_REMOVED',
      termId: reference.glossaryTermId,
      actor,
      payload: {
        referenceId,
        target: { type: reference.entityType, id: reference.entityId },
      },
    });
    glossaryEvents.emit({
      type: 'semantic.reference_changed',
      change: 'unlinked',
      termId: reference.glossaryTermId,
      entityType: reference.entityType,
      entityId: reference.entityId,
    });
    let assetId: string | null = null;
    if (reference.entityType === 'asset') assetId = reference.entityId;
    if (reference.entityType === 'finding') {
      assetId =
        (
          await this.prisma.finding.findUnique({
            where: { id: reference.entityId },
            select: { assetId: true },
          })
        )?.assetId ?? null;
    }
    if (assetId) {
      await this.jobs.scheduleIncrementalForAssets(
        [assetId],
        'manual link removed',
      );
    }
    return { deleted: true, id: referenceId };
  }

  async caseLinks(caseId: string) {
    const refs = await this.prisma.glossaryReference.findMany({
      where: {
        role: GlossaryReferenceRole.ABOUT,
        entityType: 'case',
        entityId: caseId,
      },
      include: {
        term: {
          select: {
            id: true,
            key: true,
            term: true,
            kind: true,
            status: true,
            scheme: {
              select: { id: true, key: true, name: true, color: true },
            },
          },
        },
      },
    });
    return refs.map((ref) => ({
      referenceId: ref.id,
      term: this.termRef(ref.term),
      note: ref.note,
      by: ref.createdBy,
      at: ref.createdAt,
    }));
  }

  /** Current term keys per asset (exports, R7.7). */
  async assetTermKeys(assetIds: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (!assetIds.length) return out;
    const rows = await this.prisma.$queryRaw<
      Array<{ asset_id: string; keys: string[] }>
    >`
      SELECT t.asset_id, array_agg(DISTINCT g.key ORDER BY g.key) AS keys
        FROM asset_terms t JOIN glossary_terms g ON g.id = t.term_id
       WHERE t.asset_id = ANY(${assetIds}::text[]) AND t.gone_at IS NULL
       GROUP BY t.asset_id`;
    for (const row of rows) out.set(row.asset_id, row.keys);
    return out;
  }
}
