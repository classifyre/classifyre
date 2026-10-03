import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, SemanticLinkMethod } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { BindingsService } from '../bindings/bindings.service';
import {
  assetTermsSql,
  findingCoveredSql,
  findingSelectorSql,
  findingTermsSql,
} from '../bindings/binding-compiler';
import { compileBindingRow } from '../bindings/bindings.service';
import type { CompiledBinding } from '../bindings/binding-spec';
import { isOutputMode } from '../bindings/binding-spec';
import { glossaryEvents } from '../../glossary/glossary-events';
import { withStatementTimeout } from '../semantic-sql';
import { EntitySwitchService } from '../../entities/entity-switch.service';
import {
  GONE_RETENTION_DAYS,
  LINKER_BATCH,
  LINKER_BINDING_CHUNK,
  SemanticLinkTrigger,
} from '../semantic.constants';

/** The methods that are derived whatever is switched on. */
const BASE_METHODS: SemanticLinkMethod[] = [
  'BINDING',
  'DECLARED',
  'MANUAL',
  'SUGGESTED',
];
/**
 * With MENTION (G5): an entity's confirmed value occurs in the asset. Derived
 * only while the Entities feature is on; while it is off the rows it left are
 * neither refreshed nor marked gone, which is what "off, data kept" means.
 */
const ALL_METHODS: SemanticLinkMethod[] = [...BASE_METHODS, 'MENTION'];

const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

interface DesiredLink {
  assetId: string;
  termId: string;
  method: SemanticLinkMethod;
  sourceId: string;
  supportCount: number;
  bindingIds: string[];
  sampleFindingId: string | null;
  maxSeverity: string | null;
  confidence: number;
}

/** `coverage: false` when the caller records coverage itself (the drain). */
interface JobOptions {
  coverage?: boolean;
}

export interface RelinkResult {
  assets: number;
  added: number;
  gone: number;
  /** Per term: links that appeared (or came back) and went. */
  perTerm: Map<string, { added: number; gone: number }>;
}

function linkKey(assetId: string, termId: string, method: string): string {
  return `${assetId}\u0000${termId}\u0000${method}`;
}

/**
 * The semantic linker (SL3, F9): the only writer of `asset_terms`.
 *
 * For a batch of assets it recomputes every link the evidence supports — from
 * APPROVED bindings (through the compiler's SQL half), connector declarations
 * (`MEANS` edges to terms), manual ABOUT references, accepted LINK
 * suggestions and entity mentions (confirmed entity values in the value
 * index) — then upserts what is supported and marks GONE what no longer is. Incremental jobs, backfills and the reconcile all funnel through
 * {@link relinkAssets}, which is why they agree: they differ only in which
 * assets they visit. Never a row per finding (rule SL-2).
 */
@Injectable()
export class SemanticLinkerService {
  private readonly logger = new Logger(SemanticLinkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bindings: BindingsService,
    @Optional() private readonly entitySwitch?: EntitySwitchService,
  ) {}

  private async mentionsOn(): Promise<boolean> {
    return this.entitySwitch ? this.entitySwitch.isEnabled() : false;
  }

  // ── The batch recompute ─────────────────────────────────────────────────

  async relinkAssets(assetIds: string[]): Promise<RelinkResult> {
    const result: RelinkResult = {
      assets: assetIds.length,
      added: 0,
      gone: 0,
      perTerm: new Map(),
    };
    if (!assetIds.length) return result;
    const mentions = await this.mentionsOn();
    const desired = await this.desiredLinks(assetIds, { mentions });
    const existing = await this.prisma.assetTerm.findMany({
      where: {
        assetId: { in: assetIds },
        method: { in: mentions ? ALL_METHODS : BASE_METHODS },
      },
      select: { assetId: true, termId: true, method: true, goneAt: true },
    });
    const existingByKey = new Map(
      existing.map((row) => [
        linkKey(row.assetId, row.termId, row.method),
        row,
      ]),
    );
    const bump = (termId: string, field: 'added' | 'gone') => {
      const entry = result.perTerm.get(termId) ?? { added: 0, gone: 0 };
      entry[field] += 1;
      result.perTerm.set(termId, entry);
      result[field] += 1;
    };

    const rows = [...desired.values()];
    for (const row of rows) {
      const before = existingByKey.get(
        linkKey(row.assetId, row.termId, row.method),
      );
      if (!before || before.goneAt) bump(row.termId, 'added');
    }
    const goneKeys = existing.filter(
      (row) =>
        !row.goneAt &&
        !desired.has(linkKey(row.assetId, row.termId, row.method)),
    );
    for (const row of goneKeys) bump(row.termId, 'gone');

    const now = new Date();
    if (rows.length) {
      await this.prisma.$executeRaw`
        INSERT INTO asset_terms (
          asset_id, term_id, method, source_id, support_count, binding_ids,
          sample_finding_id, max_severity, confidence,
          first_linked_at, last_linked_at, gone_at
        )
        SELECT d.asset_id, d.term_id, d.method::"SemanticLinkMethod", d.source_id,
               d.support_count,
               CASE WHEN d.binding_ids = '' THEN ARRAY[]::text[]
                    ELSE string_to_array(d.binding_ids, ',') END,
               d.sample_finding_id, d.max_severity::"Severity", d.confidence,
               ${now}, ${now}, NULL
          FROM unnest(
            ${rows.map((r) => r.assetId)}::text[],
            ${rows.map((r) => r.termId)}::text[],
            ${rows.map((r) => r.method)}::text[],
            ${rows.map((r) => r.sourceId)}::text[],
            ${rows.map((r) => r.supportCount)}::int[],
            ${rows.map((r) => r.bindingIds.join(','))}::text[],
            ${rows.map((r) => r.sampleFindingId)}::text[],
            ${rows.map((r) => r.maxSeverity)}::text[],
            ${rows.map((r) => r.confidence)}::numeric[]
          ) AS d(asset_id, term_id, method, source_id, support_count, binding_ids,
                 sample_finding_id, max_severity, confidence)
        ON CONFLICT (asset_id, term_id, method) DO UPDATE SET
          source_id = EXCLUDED.source_id,
          support_count = EXCLUDED.support_count,
          binding_ids = EXCLUDED.binding_ids,
          sample_finding_id = EXCLUDED.sample_finding_id,
          max_severity = EXCLUDED.max_severity,
          confidence = EXCLUDED.confidence,
          last_linked_at = EXCLUDED.last_linked_at,
          gone_at = NULL
      `;
    }
    if (goneKeys.length) {
      await this.prisma.$executeRaw`
        UPDATE asset_terms t
           SET gone_at = ${now}, support_count = 0
          FROM unnest(
            ${goneKeys.map((r) => r.assetId)}::text[],
            ${goneKeys.map((r) => r.termId)}::text[],
            ${goneKeys.map((r) => r.method)}::text[]
          ) AS g(asset_id, term_id, method)
         WHERE t.asset_id = g.asset_id AND t.term_id = g.term_id
           AND t.method = g.method::"SemanticLinkMethod"
      `;
    }
    return result;
  }

  /** Every link the evidence supports for these assets, keyed asset×term×method. */
  async desiredLinks(
    assetIds: string[],
    options: { mentions?: boolean } = {},
  ): Promise<Map<string, DesiredLink>> {
    const desired = new Map<string, DesiredLink>();
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: assetIds } },
      select: { id: true, sourceId: true },
    });
    const sourceOf = new Map(assets.map((asset) => [asset.id, asset.sourceId]));
    const presentIds = assets.map((asset) => asset.id);
    if (!presentIds.length) return desired;

    const add = (link: DesiredLink) => {
      const key = linkKey(link.assetId, link.termId, link.method);
      const current = desired.get(key);
      if (!current) {
        desired.set(key, link);
        return;
      }
      current.supportCount += link.supportCount;
      current.bindingIds = [
        ...new Set([...current.bindingIds, ...link.bindingIds]),
      ];
      current.confidence = Math.max(current.confidence, link.confidence);
      const better =
        link.maxSeverity &&
        (!current.maxSeverity ||
          SEVERITY_RANK[link.maxSeverity] < SEVERITY_RANK[current.maxSeverity]);
      if (better) {
        current.maxSeverity = link.maxSeverity;
        current.sampleFindingId =
          link.sampleFindingId ?? current.sampleFindingId;
      }
      if (!current.sampleFindingId)
        current.sampleFindingId = link.sampleFindingId;
    };

    // BINDING, from findings and from asset metadata.
    const active = await this.bindings.active();
    const findingBindings = active.bindings.filter((b) => isOutputMode(b.mode));
    const metadataBindings = active.bindings.filter(
      (b) => !isOutputMode(b.mode),
    );
    const scope = Prisma.sql`f.asset_id = ANY(${presentIds}::text[])`;
    for (let i = 0; i < findingBindings.length; i += LINKER_BINDING_CHUNK) {
      const chunk = findingBindings.slice(i, i + LINKER_BINDING_CHUNK);
      const parts = chunk
        .map((binding) => {
          const sql = findingTermsSql(binding, scope);
          return sql
            ? Prisma.sql`SELECT x.*, ${binding.id}::text AS binding_id,
                                ${binding.confidence}::numeric AS confidence
                           FROM (${sql}) x`
            : null;
        })
        .filter((sql): sql is Prisma.Sql => sql !== null);
      if (!parts.length) continue;
      const rows = await this.prisma.$queryRaw<
        Array<{
          asset_id: string;
          term_id: string;
          binding_id: string;
          support: bigint;
          max_severity: string | null;
          sample: string | null;
          confidence: Prisma.Decimal;
        }>
      >(Prisma.sql`
        SELECT u.asset_id, u.term_id, u.binding_id,
               count(DISTINCT u.finding_id) AS support,
               min(u.severity)::text AS max_severity,
               (array_agg(u.finding_id ORDER BY u.severity ASC, u.last_detected_at DESC NULLS LAST))[1] AS sample,
               max(u.confidence) AS confidence
          FROM (${Prisma.join(parts, ' UNION ALL ')}) u
         GROUP BY u.asset_id, u.term_id, u.binding_id`);
      for (const row of rows) {
        if (!active.terms.has(row.term_id)) continue;
        add({
          assetId: row.asset_id,
          termId: row.term_id,
          method: 'BINDING',
          sourceId: sourceOf.get(row.asset_id) ?? '',
          supportCount: Number(row.support),
          bindingIds: [row.binding_id],
          sampleFindingId: row.sample,
          maxSeverity: row.max_severity,
          confidence: Number(row.confidence),
        });
      }
    }
    const assetScope = Prisma.sql`a.id = ANY(${presentIds}::text[])`;
    for (const binding of metadataBindings) {
      const sql = assetTermsSql(binding, assetScope);
      if (!sql) continue;
      const rows =
        await this.prisma.$queryRaw<
          Array<{ asset_id: string; term_id: string }>
        >(sql);
      for (const row of rows) {
        if (!active.terms.has(row.term_id)) continue;
        add({
          assetId: row.asset_id,
          termId: row.term_id,
          method: 'BINDING',
          sourceId: sourceOf.get(row.asset_id) ?? '',
          supportCount: 1,
          bindingIds: [binding.id],
          sampleFindingId: null,
          maxSeverity: null,
          confidence: binding.confidence,
        });
      }
    }

    // DECLARED: MEANS edges a connector emitted from the asset (or one of its
    // findings) to an APPROVED term. Declarations to DRAFT terms wait (SL-5).
    const declared = await this.prisma.$queryRaw<
      Array<{
        asset_id: string;
        term_id: string;
        support: bigint;
        confidence: Prisma.Decimal;
      }>
    >`
      -- Two branches, each driven from the batch (edges by from_id, findings
      -- by asset_id). One query with an OR across both would walk every MEANS
      -- edge of the workspace for every batch.
      SELECT d.asset_id, d.term_id, count(*) AS support,
             max(d.confidence) AS confidence
        FROM (
          SELECT e.from_id AS asset_id, e.to_id AS term_id, e.confidence
            FROM edges e
           WHERE e.from_type = 'asset' AND e.from_id = ANY(${presentIds}::text[])
             AND e.to_type = 'term' AND e.relation_type = 'MEANS'
          UNION ALL
          SELECT fa.asset_id, e.to_id AS term_id, e.confidence
            FROM findings fa
            JOIN edges e ON e.from_type = 'finding' AND e.from_id = fa.id
           WHERE fa.asset_id = ANY(${presentIds}::text[])
             AND e.to_type = 'term' AND e.relation_type = 'MEANS'
        ) d
        JOIN glossary_terms t ON t.id = d.term_id AND t.status = 'APPROVED'
       GROUP BY 1, 2
    `;
    for (const row of declared) {
      add({
        assetId: row.asset_id,
        termId: row.term_id,
        method: 'DECLARED',
        sourceId: sourceOf.get(row.asset_id) ?? '',
        supportCount: Number(row.support),
        bindingIds: [],
        sampleFindingId: null,
        maxSeverity: null,
        confidence: Number(row.confidence),
      });
    }

    // MANUAL: ABOUT references on the asset itself or on one of its findings.
    const manual = await this.prisma.$queryRaw<
      Array<{
        asset_id: string;
        term_id: string;
        findings: bigint;
        asset_refs: bigint;
        max_severity: string | null;
        sample: string | null;
      }>
    >`
      SELECT COALESCE(f.asset_id, r.entity_id) AS asset_id, r.glossary_term_id AS term_id,
             count(f.id) AS findings,
             count(*) FILTER (WHERE r.entity_type = 'asset') AS asset_refs,
             min(f.severity)::text AS max_severity,
             (array_agg(f.id ORDER BY f.severity ASC) FILTER (WHERE f.id IS NOT NULL))[1] AS sample
        FROM glossary_references r
        LEFT JOIN findings f ON r.entity_type = 'finding' AND f.id = r.entity_id
        JOIN glossary_terms t ON t.id = r.glossary_term_id AND t.status = 'APPROVED'
       WHERE r.role = 'ABOUT'
         AND (
           (r.entity_type = 'asset' AND r.entity_id = ANY(${presentIds}::text[]))
           OR (r.entity_type = 'finding' AND f.asset_id = ANY(${presentIds}::text[]))
         )
       GROUP BY 1, 2
    `;
    for (const row of manual) {
      add({
        assetId: row.asset_id,
        termId: row.term_id,
        method: 'MANUAL',
        sourceId: sourceOf.get(row.asset_id) ?? '',
        supportCount: Math.max(Number(row.findings), 1),
        bindingIds: [],
        sampleFindingId: row.sample,
        maxSeverity: row.max_severity,
        confidence: 1,
      });
    }

    // SUGGESTED: LINK suggestions a person accepted (SL4).
    const suggested = await this.prisma.$queryRaw<
      Array<{ asset_id: string; term_id: string; score: Prisma.Decimal }>
    >`
      SELECT s.asset_id, s.term_id, max(s.score) AS score
        FROM semantic_suggestions s
        JOIN glossary_terms t ON t.id = s.term_id AND t.status = 'APPROVED'
       WHERE s.kind = 'LINK' AND s.status = 'ACCEPTED'
         AND s.asset_id = ANY(${presentIds}::text[])
       GROUP BY 1, 2
    `;
    for (const row of suggested) {
      add({
        assetId: row.asset_id,
        termId: row.term_id,
        method: 'SUGGESTED',
        sourceId: sourceOf.get(row.asset_id) ?? '',
        supportCount: 1,
        bindingIds: [],
        sampleFindingId: null,
        maxSeverity: null,
        confidence: Math.min(Number(row.score), 1),
      });
    }
    // MENTION (G5): a confirmed value of an APPROVED entity occurs in the
    // asset. Never a row per finding: the value index is one row per asset
    // and value, and this groups it per asset and entity.
    if (options.mentions ?? (await this.mentionsOn())) {
      const mentioned = await this.prisma.$queryRaw<
        Array<{
          asset_id: string;
          term_id: string;
          support: bigint;
          max_severity: string | null;
          sample: string | null;
          score: number | null;
        }>
      >`
        SELECT acv.asset_id, ev.term_id, count(*) AS support,
               min(f.severity)::text AS max_severity,
               (array_agg(acv.finding_id ORDER BY f.severity ASC NULLS LAST)
                  FILTER (WHERE acv.finding_id IS NOT NULL))[1] AS sample,
               max(COALESCE(ev.score, 1)) AS score
          FROM asset_correlation_values acv
          JOIN entity_values ev ON ev.value_hash = acv.value_hash AND ev.verdict = 'CONFIRMED'
          JOIN glossary_terms t ON t.id = ev.term_id
                               AND t.kind = 'ENTITY' AND t.status = 'APPROVED'
          LEFT JOIN findings f ON f.id = acv.finding_id
         WHERE acv.asset_id = ANY(${presentIds}::text[])
         GROUP BY 1, 2
      `;
      for (const row of mentioned) {
        add({
          assetId: row.asset_id,
          termId: row.term_id,
          method: 'MENTION',
          sourceId: sourceOf.get(row.asset_id) ?? '',
          supportCount: Number(row.support),
          bindingIds: [],
          sampleFindingId: row.sample,
          maxSeverity: row.max_severity,
          confidence: Math.min(Number(row.score ?? 1), 1),
        });
      }
    }
    for (const link of desired.values()) {
      link.confidence =
        Math.round(Math.min(Math.max(link.confidence, 0), 1) * 100) / 100;
    }
    return desired;
  }

  // ── Which assets a job visits ───────────────────────────────────────────

  /** Assets a run touched: its assets, and the assets of findings it changed. */
  async assetsOfRun(
    runId: string,
    afterId: string,
    limit: number,
  ): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM (
        (SELECT a.id FROM assets a WHERE a.runner_id = ${runId} AND a.id > ${afterId} ORDER BY a.id LIMIT ${limit})
        UNION
        (SELECT DISTINCT f.asset_id AS id FROM findings f WHERE f.runner_id = ${runId} AND f.asset_id > ${afterId} ORDER BY 1 LIMIT ${limit})
      ) x ORDER BY id LIMIT ${limit}
    `;
    return rows.map((row) => row.id);
  }

  /**
   * The next page of assets a backfill for these changes may affect, keyset
   * paged by asset id: assets with OPEN findings of a changed output, assets a
   * changed metadata binding can read, and every asset that already has a link
   * the change can take away.
   */
  async backfillPage(
    trigger: SemanticLinkTrigger,
    afterId: string,
    limit: number,
  ): Promise<string[]> {
    const branches: Prisma.Sql[] = [];
    let bindingRows: CompiledBinding[] = [];
    if (trigger.all) {
      bindingRows = (
        await this.prisma.glossaryBinding.findMany({
          where: { noMeaning: false },
        })
      ).map(compileBindingRow);
    } else {
      const termIds = trigger.termIds ?? [];
      const bindingIds = trigger.bindingIds ?? [];
      // Lookup schemes the changed terms belong to: their bindings may resolve
      // values differently now.
      const schemes = termIds.length
        ? (
            await this.prisma.glossaryTerm.findMany({
              where: { id: { in: termIds }, schemeId: { not: null } },
              select: { schemeId: true },
            })
          )
            .map((row) => row.schemeId)
            .filter((id): id is string => Boolean(id))
        : [];
      if (bindingIds.length || termIds.length || schemes.length) {
        bindingRows = (
          await this.prisma.glossaryBinding.findMany({
            where: {
              noMeaning: false,
              OR: [
                ...(bindingIds.length ? [{ id: { in: bindingIds } }] : []),
                ...(termIds.length ? [{ termId: { in: termIds } }] : []),
                ...(schemes.length
                  ? [{ lookupSchemeId: { in: schemes } }]
                  : []),
              ],
            },
          })
        ).map(compileBindingRow);
      }
      if (termIds.length) {
        branches.push(Prisma.sql`(
          SELECT asset_id AS id FROM asset_terms
           WHERE term_id = ANY(${termIds}::text[]) AND asset_id > ${afterId}
           ORDER BY asset_id LIMIT ${limit})`);
        branches.push(Prisma.sql`(
          SELECT DISTINCT COALESCE(fa.asset_id, e.from_id) AS id
            FROM edges e LEFT JOIN findings fa ON e.from_type = 'finding' AND fa.id = e.from_id
           WHERE e.to_type = 'term' AND e.to_id = ANY(${termIds}::text[])
             AND e.relation_type = 'MEANS'
             AND COALESCE(fa.asset_id, e.from_id) > ${afterId}
           ORDER BY 1 LIMIT ${limit})`);
        branches.push(Prisma.sql`(
          SELECT DISTINCT COALESCE(f.asset_id, r.entity_id) AS id
            FROM glossary_references r LEFT JOIN findings f ON r.entity_type = 'finding' AND f.id = r.entity_id
           WHERE r.role = 'ABOUT' AND r.entity_type IN ('asset', 'finding')
             AND r.glossary_term_id = ANY(${termIds}::text[])
             AND COALESCE(f.asset_id, r.entity_id) > ${afterId}
           ORDER BY 1 LIMIT ${limit})`);
        branches.push(Prisma.sql`(
          SELECT DISTINCT s.asset_id AS id FROM semantic_suggestions s
           WHERE s.kind = 'LINK' AND s.status = 'ACCEPTED'
             AND s.term_id = ANY(${termIds}::text[]) AND s.asset_id > ${afterId}
           ORDER BY 1 LIMIT ${limit})`);
        // Assets that carry a confirmed value of a changed entity (G5).
        if (await this.mentionsOn()) {
          branches.push(Prisma.sql`(
            SELECT DISTINCT acv.asset_id AS id
              FROM entity_values ev
              JOIN asset_correlation_values acv ON acv.value_hash = ev.value_hash
             WHERE ev.term_id = ANY(${termIds}::text[]) AND ev.verdict = 'CONFIRMED'
               AND acv.asset_id > ${afterId}
             ORDER BY 1 LIMIT ${limit})`);
        }
      }
      if (bindingIds.length) {
        branches.push(Prisma.sql`(
          SELECT asset_id AS id FROM asset_terms
           WHERE binding_ids && ${bindingIds}::text[] AND asset_id > ${afterId}
           ORDER BY asset_id LIMIT ${limit})`);
      }
    }
    if (trigger.all) {
      const mentions = await this.mentionsOn();
      branches.push(Prisma.sql`(
        SELECT asset_id AS id FROM asset_terms
         WHERE ${mentions ? Prisma.sql`TRUE` : Prisma.sql`method <> 'MENTION'`}
           AND asset_id > ${afterId}
         ORDER BY asset_id LIMIT ${limit})`);
      if (mentions) {
        branches.push(Prisma.sql`(
          SELECT DISTINCT acv.asset_id AS id
            FROM entity_values ev
            JOIN asset_correlation_values acv ON acv.value_hash = ev.value_hash
           WHERE ev.verdict = 'CONFIRMED' AND acv.asset_id > ${afterId}
           ORDER BY 1 LIMIT ${limit})`);
      }
    }
    const outputs = bindingRows.filter((binding) => isOutputMode(binding.mode));
    if (outputs.length) {
      const selectors = outputs.map((binding) =>
        findingSelectorSql({ ...binding, sourceIds: binding.sourceIds }),
      );
      branches.push(Prisma.sql`(
        SELECT DISTINCT f.asset_id AS id FROM findings f
         WHERE (${Prisma.join(selectors, ' OR ')}) AND f.asset_id > ${afterId}
         ORDER BY 1 LIMIT ${limit})`);
    }
    const metadata = bindingRows.filter(
      (binding) => !isOutputMode(binding.mode),
    );
    if (metadata.length) {
      const scoped = metadata.every((binding) => binding.sourceIds.length > 0)
        ? Prisma.sql`a.source_id = ANY(${[...new Set(metadata.flatMap((b) => b.sourceIds))]}::text[])`
        : Prisma.sql`TRUE`;
      const keys = [
        ...new Set(
          metadata.map((binding) => (binding.metadataPath ?? '').split('.')[0]),
        ),
      ];
      branches.push(Prisma.sql`(
        SELECT a.id FROM assets a
         WHERE ${scoped} AND jsonb_exists_any(a.metadata, ${keys}::text[]) AND a.id > ${afterId}
         ORDER BY a.id LIMIT ${limit})`);
    }
    if (!branches.length) return [];
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM (${Prisma.join(branches, ' UNION ')}) x
       WHERE id IS NOT NULL ORDER BY id LIMIT ${limit}`);
    return rows.map((row) => row.id);
  }

  // ── Jobs ────────────────────────────────────────────────────────────────

  /**
   * Claim every QUEUED job and run it. INCREMENTAL jobs run first (cheap,
   * user-visible); BACKFILLs merge into one walk; a RECONCILE runs alone.
   */
  async drain(): Promise<void> {
    // Claimed atomically, so two workers never run the same job. A job left
    // RUNNING by a worker that died resumes from its cursor after 30 minutes.
    const jobs = await this.prisma.$queryRaw<
      Array<{ id: string; kind: string }>
    >`
      UPDATE semantic_link_jobs SET status = 'RUNNING', started_at = now()
       WHERE id IN (
         SELECT id FROM semantic_link_jobs
          WHERE status = 'QUEUED'
             OR (status = 'RUNNING' AND started_at < now() - interval '30 minutes')
          ORDER BY created_at
          LIMIT 200
          FOR UPDATE SKIP LOCKED
       )
      RETURNING id, kind
    `;
    if (!jobs.length) return;
    // The worker is a different process from the API that approved a binding
    // or a term: its cache never hears that event, and a job that links with
    // a stale set marks itself DONE having linked nothing.
    this.bindings.invalidate();
    const incremental = jobs.filter((job) => job.kind === 'INCREMENTAL');
    const backfills = jobs.filter((job) => job.kind === 'BACKFILL');
    const reconciles = jobs.filter((job) => job.kind === 'RECONCILE');
    // A failed job is already marked FAILED; the others it was claimed with
    // must still run, or they sit RUNNING until the stale-claim timeout.
    const attempt = async (label: string, run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (error) {
        this.logger.error(`Semantic ${label} job failed: ${String(error)}`);
      }
    };
    const deferred = { coverage: false };
    for (const job of incremental) {
      await attempt('incremental', () => this.runIncremental(job.id, deferred));
    }
    if (backfills.length) {
      await attempt('backfill', () =>
        this.runBackfills(
          backfills.map((job) => job.id),
          deferred,
        ),
      );
    }
    if (reconciles.length) {
      await attempt('reconcile', () =>
        this.runReconcile(reconciles[0].id, deferred),
      );
      if (reconciles.length > 1) {
        await this.prisma.semanticLinkJob.updateMany({
          where: { id: { in: reconciles.slice(1).map((job) => job.id) } },
          data: {
            status: 'DONE',
            finishedAt: new Date(),
            error: 'merged into an earlier reconcile',
          },
        });
      }
    }
    // Coverage counts every open finding: once per drain, not once per job.
    await this.recordCoverage().catch((error) =>
      this.logger.warn(`Coverage stats failed: ${String(error)}`),
    );
  }

  private async start(ids: string[]) {
    // Jobs run directly (tests, "Rebuild") are claimed here; drained ones
    // already are.
    this.bindings.invalidate();
    await this.prisma.semanticLinkJob.updateMany({
      where: { id: { in: ids }, status: 'QUEUED' },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
  }

  private async finish(
    ids: string[],
    totals: RelinkResult,
    started: number,
    trigger: string,
    runId?: string | null,
    options: JobOptions = {},
  ) {
    await this.prisma.semanticLinkJob.updateMany({
      where: { id: { in: ids } },
      data: {
        status: 'DONE',
        finishedAt: new Date(),
        progress: 1,
        added: totals.added,
        gone: totals.gone,
      },
    });
    await this.emitUpdated(
      ids[0],
      totals,
      Date.now() - started,
      trigger,
      runId,
    );
    if (options.coverage !== false) {
      await this.recordCoverage().catch((error) =>
        this.logger.warn(`Coverage stats failed: ${String(error)}`),
      );
    }
  }

  private async fail(ids: string[], error: unknown) {
    await this.prisma.semanticLinkJob.updateMany({
      where: { id: { in: ids } },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        error:
          error instanceof Error ? error.message.slice(0, 2000) : String(error),
      },
    });
  }

  private merge(into: RelinkResult, part: RelinkResult) {
    into.assets += part.assets;
    into.added += part.added;
    into.gone += part.gone;
    for (const [termId, counts] of part.perTerm) {
      const entry = into.perTerm.get(termId) ?? { added: 0, gone: 0 };
      entry.added += counts.added;
      entry.gone += counts.gone;
      into.perTerm.set(termId, entry);
    }
  }

  private emptyResult(): RelinkResult {
    return { assets: 0, added: 0, gone: 0, perTerm: new Map() };
  }

  /**
   * One batch, with a poisoned batch skipped (and logged) rather than failing
   * the whole job: the reconcile will retry those assets later.
   */
  private async safeRelink(assetIds: string[]): Promise<RelinkResult> {
    try {
      return await this.relinkAssets(assetIds);
    } catch (error) {
      this.logger.error(
        `Semantic linking skipped a batch of ${assetIds.length} asset(s) (${assetIds[0]}…): ${String(error)}`,
      );
      return this.emptyResult();
    }
  }

  async runIncremental(
    jobId: string,
    options: JobOptions = {},
  ): Promise<RelinkResult> {
    const job = await this.prisma.semanticLinkJob.findUnique({
      where: { id: jobId },
    });
    if (!job) return this.emptyResult();
    const trigger = (job.trigger ?? {}) as SemanticLinkTrigger;
    const started = Date.now();
    await this.start([jobId]);
    const totals = this.emptyResult();
    try {
      if (trigger.assetIds?.length) {
        for (let i = 0; i < trigger.assetIds.length; i += LINKER_BATCH) {
          this.merge(
            totals,
            await this.safeRelink(trigger.assetIds.slice(i, i + LINKER_BATCH)),
          );
        }
      } else if (trigger.runId) {
        let cursor = (job.cursor as { after?: string } | null)?.after ?? '';
        for (;;) {
          const page = await this.assetsOfRun(
            trigger.runId,
            cursor,
            LINKER_BATCH,
          );
          if (!page.length) break;
          this.merge(totals, await this.safeRelink(page));
          cursor = page[page.length - 1];
          await this.prisma.semanticLinkJob.update({
            where: { id: jobId },
            data: {
              cursor: { after: cursor },
              added: totals.added,
              gone: totals.gone,
            },
          });
          if (page.length < LINKER_BATCH) break;
        }
      }
      await this.finish(
        [jobId],
        totals,
        started,
        trigger.reason ?? 'incremental',
        trigger.runId,
        options,
      );
    } catch (error) {
      await this.fail([jobId], error);
      throw error;
    }
    return totals;
  }

  async runBackfills(
    jobIds: string[],
    options: JobOptions = {},
  ): Promise<RelinkResult> {
    const jobs = await this.prisma.semanticLinkJob.findMany({
      where: { id: { in: jobIds } },
    });
    const triggers = jobs.map(
      (job) => (job.trigger ?? {}) as SemanticLinkTrigger,
    );
    // Several pending changes merge into one walk (SL3 R2).
    const merged: SemanticLinkTrigger = {
      all: triggers.some((t) => t.all),
      bindingIds: [...new Set(triggers.flatMap((t) => t.bindingIds ?? []))],
      termIds: [...new Set(triggers.flatMap((t) => t.termIds ?? []))],
      reason: triggers
        .map((t) => t.reason)
        .filter(Boolean)
        .join('; ')
        .slice(0, 500),
    };
    const resumeFrom = jobs
      .map((job) => (job.cursor as { after?: string } | null)?.after ?? '')
      .reduce((min, value) => (value < min ? value : min), '￿');
    let cursor = jobs.every((job) => job.cursor) ? resumeFrom : '';
    const started = Date.now();
    await this.start(jobIds);
    const totals = this.emptyResult();
    try {
      const estimate = await this.estimateBackfill(merged);
      for (;;) {
        const page = await this.backfillPage(merged, cursor, LINKER_BATCH);
        if (!page.length) break;
        this.merge(totals, await this.safeRelink(page));
        cursor = page[page.length - 1];
        await this.prisma.semanticLinkJob.updateMany({
          where: { id: { in: jobIds } },
          data: {
            cursor: { after: cursor },
            added: totals.added,
            gone: totals.gone,
            progress: estimate ? Math.min(totals.assets / estimate, 0.99) : 0.5,
          },
        });
        if (page.length < LINKER_BATCH) break;
      }
      await this.finish(
        jobIds,
        totals,
        started,
        merged.reason || 'backfill',
        null,
        options,
      );
    } catch (error) {
      await this.fail(jobIds, error);
      throw error;
    }
    return totals;
  }

  private async estimateBackfill(
    trigger: SemanticLinkTrigger,
  ): Promise<number> {
    try {
      if (trigger.all) return await this.prisma.asset.count();
      const [row] = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(DISTINCT asset_id) AS n FROM asset_terms
         WHERE term_id = ANY(${trigger.termIds ?? []}::text[])
            OR binding_ids && ${trigger.bindingIds ?? []}::text[]
      `;
      return Math.max(Number(row?.n ?? 0), 1);
    } catch {
      return 0;
    }
  }

  /**
   * Compare the rollup with a recomputation for a sample of assets (1%, at
   * least 1,000) and repair drift. Purges GONE rows past retention.
   */
  async runReconcile(
    jobId: string,
    options: JobOptions = {},
  ): Promise<RelinkResult & { purged: number }> {
    const started = Date.now();
    await this.start([jobId]);
    const totals = this.emptyResult();
    try {
      const total = await this.prisma.asset.count();
      const sampleSize = Math.min(
        total,
        Math.max(1000, Math.ceil(total * 0.01)),
      );
      const sample = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM (
          (SELECT DISTINCT asset_id AS id FROM asset_terms WHERE gone_at IS NULL ORDER BY random() LIMIT ${Math.ceil(sampleSize / 2)})
          UNION
          (SELECT id FROM assets ORDER BY random() LIMIT ${Math.ceil(sampleSize / 2)})
        ) x`;
      const ids = sample.map((row) => row.id);
      for (let i = 0; i < ids.length; i += LINKER_BATCH) {
        this.merge(
          totals,
          await this.safeRelink(ids.slice(i, i + LINKER_BATCH)),
        );
      }
      const purged = await this.prisma.$executeRaw`
        DELETE FROM asset_terms
         WHERE gone_at IS NOT NULL
           AND gone_at < now() - make_interval(days => ${GONE_RETENTION_DAYS})
      `;
      await this.prisma.semanticLinkJob.update({
        where: { id: jobId },
        data: {
          cursor: {
            repaired: totals.added + totals.gone,
            purged,
            sampled: ids.length,
          },
        },
      });
      await this.finish([jobId], totals, started, 'reconcile', null, options);
      if (totals.added + totals.gone > 0) {
        this.logger.warn(
          `Semantic reconcile repaired ${totals.added} missing and ${totals.gone} stale link(s) in a sample of ${ids.length} asset(s).`,
        );
      }
      return { ...totals, purged };
    } catch (error) {
      await this.fail([jobId], error);
      throw error;
    }
  }

  private async emitUpdated(
    jobId: string,
    totals: RelinkResult,
    durationMs: number,
    trigger: string,
    runId?: string | null,
  ) {
    if (!totals.perTerm.size) return;
    const terms = await this.prisma.glossaryTerm.findMany({
      where: { id: { in: [...totals.perTerm.keys()] } },
      select: { id: true, key: true },
    });
    const keyOf = new Map(terms.map((term) => [term.id, term.key]));
    glossaryEvents.emit({
      type: 'semantic.links_updated',
      jobId,
      runId: runId ?? null,
      trigger,
      terms: [...totals.perTerm.entries()].map(([termId, counts]) => ({
        key: keyOf.get(termId) ?? termId,
        added: counts.added,
        gone: counts.gone,
      })),
      durationMs,
    });
  }

  // ── Coverage (SL3 R7.4) ─────────────────────────────────────────────────

  /**
   * The share of open findings with a meaning: matched by an APPROVED binding
   * (or marked "no meaning"), or manually linked. One row per day.
   */
  async recordCoverage(): Promise<void> {
    const bindings = (
      await this.prisma.glossaryBinding.findMany({
        where: { status: 'APPROVED' },
      })
    ).map(compileBindingRow);
    const predicates = bindings
      .map((binding) => findingCoveredSql(binding))
      .filter((sql): sql is Prisma.Sql => sql !== null);
    await withStatementTimeout(this.prisma, 30_000, async (tx) => {
      const [open] = await tx.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM findings WHERE status = 'OPEN'`;
      const covered = Prisma.sql`(
        ${predicates.length ? Prisma.join(predicates, ' OR ') : Prisma.sql`FALSE`}
        OR EXISTS (
          SELECT 1 FROM glossary_references r
           WHERE r.role = 'ABOUT' AND r.entity_type = 'finding' AND r.entity_id = f.id
        )
      )`;
      const [withMeaning] = await tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
        SELECT count(*) AS n FROM findings f WHERE f.status = 'OPEN' AND ${covered}`);
      const [assets] = await tx.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(DISTINCT asset_id) AS n FROM asset_terms WHERE gone_at IS NULL`;
      const day = new Date();
      day.setUTCHours(0, 0, 0, 0);
      await tx.semanticStat.upsert({
        where: { day },
        create: {
          day,
          openFindings: Number(open?.n ?? 0),
          findingsWithMeaning: Number(withMeaning?.n ?? 0),
          assetsWithMeaning: Number(assets?.n ?? 0),
          computedAt: new Date(),
        },
        update: {
          openFindings: Number(open?.n ?? 0),
          findingsWithMeaning: Number(withMeaning?.n ?? 0),
          assetsWithMeaning: Number(assets?.n ?? 0),
          computedAt: new Date(),
        },
      });
    });
  }

  async jobs(limit = 20) {
    return this.prisma.semanticLinkJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }
}
