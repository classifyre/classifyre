import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { MeaningService } from '../links/meaning.service';
import { vocabularyLabel } from '../bindings/binding-spec';

/** The 40 terms with the most linked items (SL5 A2). */
export const BOARD_SEMANTIC_TERM_LIMIT = 40;
/** A term linked to more board items than this is a hub. */
export const BOARD_SEMANTIC_HUB_ITEMS = 30;
/** Other assets per term in the `meaning` trace (SL5 A9). */
export const MEANING_TRACE_PER_TERM = 10;

export interface BoardSemanticTerm {
  termId: string;
  key: string;
  name: string;
  kind: string;
  status: string;
  definition: string | null;
  scheme: { id: string; key: string; name: string; color: string | null } | null;
  replacedBy: { id: string; key: string; name: string } | null;
  linkedItems: Array<{
    itemId: string;
    findingIds: string[];
    methods: string[];
    supportCount: number;
    bindingIds: string[];
    since: Date | null;
  }>;
  totalLinked: number;
  isHub: boolean;
  /** The case itself is about this term (ABOUT reference on the case). */
  caseAbout: boolean;
  /** The TERM card placed on the board, if any. */
  placedItemId: string | null;
  deleted?: boolean;
}

export interface BoardSemanticLayer {
  terms: BoardSemanticTerm[];
  relations: Array<{ fromTermId: string; toTermId: string; type: string; label: string }>;
  /** One level of broader concepts for "Show broader concepts". */
  broader: Array<{
    termId: string;
    parent: { termId: string; key: string; name: string; kind: string; status: string };
  }>;
  /** Links of case evidence that went GONE: shown faded, never dropped. */
  gone: Array<{ termId: string; key: string; name: string; itemId: string; goneAt: Date }>;
  bindings: Record<string, { id: string; mode: string; label: string; approvedBy: string | null; approvedAt: Date | null; origin: string }>;
  caseLinks: Array<{ referenceId: string; termId: string; key: string; name: string; note: string | null; by: string | null }>;
  truncated: number;
}

type ItemRef = { id: string; kind: string; refId: string | null };

/**
 * The case board's Meaning layer (SL5 A2): which terms the case's evidence is
 * about, how, and on which items. Part of the board payload whatever the lens
 * setting — switching the lens needs no round trip, and snapshots keep it.
 */
@Injectable()
export class SemanticBoardLayerService {
  private readonly logger = new Logger(SemanticBoardLayerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meaning: MeaningService,
  ) {}

  async compute(caseId: string, items: ItemRef[]): Promise<BoardSemanticLayer> {
    const empty: BoardSemanticLayer = {
      terms: [],
      relations: [],
      broader: [],
      gone: [],
      bindings: {},
      caseLinks: [],
      truncated: 0,
    };
    try {
      return await this.build(caseId, items);
    } catch (error) {
      // The layer is an enhancement of the board; the board must always load.
      this.logger.warn(`Board semantic layer failed for case ${caseId}: ${String(error)}`);
      return empty;
    }
  }

  private async build(caseId: string, items: ItemRef[]): Promise<BoardSemanticLayer> {
    const evidence = await this.prisma.caseEvidence.findMany({
      where: { caseId },
      select: { id: true, entityType: true, entityId: true, findings: { select: { findingId: true } } },
    });
    const itemByEvidence = new Map<string, string>();
    for (const item of items) {
      if (item.kind === 'EVIDENCE' && item.refId) itemByEvidence.set(item.refId, item.id);
    }
    const assetItem = new Map<string, string>();
    const findingItem = new Map<string, string>();
    const findingIds: string[] = [];
    for (const row of evidence) {
      const itemId = itemByEvidence.get(row.id);
      if (!itemId) continue;
      if (row.entityType === 'asset') assetItem.set(row.entityId, itemId);
      for (const f of row.findings) {
        findingItem.set(f.findingId, itemId);
        findingIds.push(f.findingId);
      }
    }
    // A finding added as evidence names its asset through the finding.
    const findingEvidence = evidence.filter((row) => row.entityType === 'finding');
    if (findingEvidence.length) {
      const rows = await this.prisma.finding.findMany({
        where: { id: { in: findingEvidence.map((row) => row.entityId) } },
        select: { id: true, assetId: true },
      });
      for (const row of rows) {
        const evidenceRow = findingEvidence.find((e) => e.entityId === row.id);
        const itemId = evidenceRow ? itemByEvidence.get(evidenceRow.id) : undefined;
        if (itemId && !assetItem.has(row.assetId)) assetItem.set(row.assetId, itemId);
        if (itemId) {
          findingItem.set(row.id, itemId);
          findingIds.push(row.id);
        }
      }
    }
    const assetIds = [...assetItem.keys()];

    type Linked = BoardSemanticTerm['linkedItems'][number];
    const byTerm = new Map<string, Map<string, Linked>>();
    const touch = (termId: string, itemId: string): Linked => {
      let perItem = byTerm.get(termId);
      if (!perItem) {
        perItem = new Map();
        byTerm.set(termId, perItem);
      }
      let linked = perItem.get(itemId);
      if (!linked) {
        linked = { itemId, findingIds: [], methods: [], supportCount: 0, bindingIds: [], since: null };
        perItem.set(itemId, linked);
      }
      return linked;
    };

    // Asset-level links: every method, current ones.
    const gone: BoardSemanticLayer['gone'] = [];
    if (assetIds.length) {
      const rows = await this.prisma.assetTerm.findMany({
        where: { assetId: { in: assetIds } },
        include: { term: { select: { key: true, term: true } } },
      });
      for (const row of rows) {
        const itemId = assetItem.get(row.assetId);
        if (!itemId) continue;
        if (row.goneAt) {
          gone.push({ termId: row.termId, key: row.term.key, name: row.term.term, itemId, goneAt: row.goneAt });
          continue;
        }
        const linked = touch(row.termId, itemId);
        if (!linked.methods.includes(row.method)) linked.methods.push(row.method);
        linked.supportCount += row.supportCount;
        linked.bindingIds = [...new Set([...linked.bindingIds, ...row.bindingIds])];
        if (!linked.since || row.firstLinkedAt < linked.since) linked.since = row.firstLinkedAt;
      }
    }

    // Finding-level: which attached findings carry which meaning.
    if (findingIds.length) {
      const findings = await this.prisma.finding.findMany({
        where: { id: { in: [...new Set(findingIds)] } },
        select: {
          id: true,
          sourceId: true,
          detectorType: true,
          customDetectorKey: true,
          findingType: true,
          matchedContent: true,
          status: true,
        },
      });
      const meanings = await this.meaning.meaningsOfFindings(findings, { broader: false });
      for (const [findingId, list] of meanings) {
        const itemId = findingItem.get(findingId);
        if (!itemId) continue;
        for (const item of list) {
          if (item.method === 'BROADER') continue;
          const linked = touch(item.term.id, itemId);
          if (!linked.findingIds.includes(findingId)) linked.findingIds.push(findingId);
          if (!linked.methods.includes(item.method)) linked.methods.push(item.method);
          if (item.binding && !linked.bindingIds.includes(item.binding.id)) {
            linked.bindingIds.push(item.binding.id);
          }
        }
      }
    }

    // Placed TERM cards, and terms the case itself is about.
    const placed = new Map<string, string>();
    for (const item of items) {
      if (item.kind === 'TERM' && item.refId) placed.set(item.refId, item.id);
    }
    const caseLinks = await this.meaning.caseLinks(caseId);
    const caseAbout = new Set(caseLinks.map((link) => link.term.id));

    const termIds = new Set<string>([...byTerm.keys(), ...placed.keys(), ...caseAbout]);
    const ranked = [...termIds].sort(
      (a, b) =>
        (placed.has(b) ? 1 : 0) - (placed.has(a) ? 1 : 0) ||
        (byTerm.get(b)?.size ?? 0) - (byTerm.get(a)?.size ?? 0),
    );
    const kept = ranked.slice(0, Math.max(BOARD_SEMANTIC_TERM_LIMIT, placed.size));
    const truncated = ranked.length - kept.length;
    const terms = kept.length
      ? await this.prisma.glossaryTerm.findMany({
          where: { id: { in: kept } },
          select: {
            id: true,
            key: true,
            term: true,
            kind: true,
            status: true,
            definition: true,
            scheme: { select: { id: true, key: true, name: true, color: true } },
            replacedBy: { select: { id: true, key: true, term: true } },
          },
        })
      : [];
    const termById = new Map(terms.map((t) => [t.id, t]));
    const layerTerms: BoardSemanticTerm[] = kept.map((termId) => {
      const term = termById.get(termId);
      const linkedItems = [...(byTerm.get(termId)?.values() ?? [])];
      return {
        termId,
        key: term?.key ?? termId,
        name: term?.term ?? '(deleted term)',
        kind: term?.kind ?? 'CONCEPT',
        status: term?.status ?? 'DEPRECATED',
        definition: term?.definition ? term.definition.slice(0, 300) : null,
        scheme: term?.scheme ?? null,
        replacedBy: term?.replacedBy
          ? { id: term.replacedBy.id, key: term.replacedBy.key, name: term.replacedBy.term }
          : null,
        linkedItems,
        totalLinked: linkedItems.length,
        isHub: linkedItems.length > BOARD_SEMANTIC_HUB_ITEMS,
        caseAbout: caseAbout.has(termId),
        placedItemId: placed.get(termId) ?? null,
        ...(term ? {} : { deleted: true }),
      };
    });

    const relationRows = kept.length
      ? await this.prisma.glossaryRelation.findMany({
          where: { status: 'APPROVED', fromTermId: { in: kept }, toTermId: { in: kept } },
          select: { fromTermId: true, toTermId: true, type: true, label: true },
        })
      : [];
    const parentRows = kept.length
      ? await this.prisma.glossaryRelation.findMany({
          where: { status: 'APPROVED', type: 'BROADER', fromTermId: { in: kept } },
          include: { to: { select: { id: true, key: true, term: true, kind: true, status: true } } },
        })
      : [];

    const bindingIds = [...new Set(layerTerms.flatMap((t) => t.linkedItems.flatMap((l) => l.bindingIds)))];
    const bindingRows = bindingIds.length
      ? await this.prisma.glossaryBinding.findMany({ where: { id: { in: bindingIds } } })
      : [];
    const bindings: BoardSemanticLayer['bindings'] = {};
    for (const row of bindingRows) {
      bindings[row.id] = {
        id: row.id,
        mode: row.mode,
        label: row.findingType ? vocabularyLabel(row).label : (row.metadataPath ?? ''),
        approvedBy: row.approvedBy,
        approvedAt: row.approvedAt,
        origin: row.origin,
      };
    }

    return {
      terms: layerTerms,
      relations: relationRows.map((r) => ({ fromTermId: r.fromTermId, toTermId: r.toTermId, type: r.type, label: r.label })),
      broader: parentRows.map((r) => ({
        termId: r.fromTermId,
        parent: { termId: r.to.id, key: r.to.key, name: r.to.term, kind: r.to.kind, status: r.to.status },
      })),
      gone,
      bindings,
      caseLinks: caseLinks.map((link) => ({
        referenceId: link.referenceId,
        termId: link.term.id,
        key: link.term.key,
        name: link.term.name,
        note: link.note,
        by: link.by,
      })),
      truncated,
    };
  }

  /**
   * The `meaning` trace kind (SL5 A9): from each seed asset, its current
   * terms, and for each term the top other assets about it — by severity,
   * then support, then recency. One hop only (rule SL-4); edges are virtual
   * (`sl:<assetId>:<termId>`) and never written to `edges`.
   */
  async meaningTrace(seedAssetIds: string[], limit: number) {
    const seeds = [...new Set(seedAssetIds)];
    if (!seeds.length) return { nodes: [], edges: [], truncated: false };
    const links = await this.prisma.assetTerm.findMany({
      where: { assetId: { in: seeds }, goneAt: null },
      select: { assetId: true, termId: true },
    });
    const termIds = [...new Set(links.map((l) => l.termId))];
    if (!termIds.length) return { nodes: [], edges: [], truncated: false };
    const others = await this.prisma.$queryRaw<
      Array<{ term_id: string; asset_id: string; rank: bigint }>
    >(Prisma.sql`
      SELECT term_id, asset_id, rank FROM (
        SELECT t.term_id, t.asset_id,
               row_number() OVER (PARTITION BY t.term_id
                 ORDER BY min(t.max_severity) ASC NULLS LAST, sum(t.support_count) DESC, max(t.last_linked_at) DESC) AS rank
          FROM asset_terms t
         WHERE t.term_id = ANY(${termIds}::text[]) AND t.gone_at IS NULL
           AND NOT (t.asset_id = ANY(${seeds}::text[]))
         GROUP BY t.term_id, t.asset_id
      ) x WHERE rank <= ${MEANING_TRACE_PER_TERM}`);
    const terms = await this.prisma.glossaryTerm.findMany({
      where: { id: { in: termIds } },
      select: { id: true, key: true, term: true },
    });
    const termById = new Map(terms.map((t) => [t.id, t]));
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: [...new Set(others.map((o) => o.asset_id))] } },
      select: { id: true, name: true, assetType: true, sourceType: true, status: true, source: { select: { name: true } } },
    });
    const assetById = new Map(assets.map((a) => [a.id, a]));
    const seedOfTerm = new Map<string, string>();
    for (const link of links) if (!seedOfTerm.has(link.termId)) seedOfTerm.set(link.termId, link.assetId);
    const nodes: Array<Record<string, unknown>> = [];
    const edges: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    let truncated = false;
    for (const row of others) {
      const asset = assetById.get(row.asset_id);
      const term = termById.get(row.term_id);
      const seed = seedOfTerm.get(row.term_id);
      if (!asset || !term || !seed) continue;
      if (!seen.has(asset.id)) {
        if (nodes.length >= limit) {
          truncated = true;
          continue;
        }
        seen.add(asset.id);
        nodes.push({
          id: asset.id,
          type: 'asset',
          label: asset.name,
          assetType: asset.assetType,
          sourceType: String(asset.sourceType),
          sourceName: asset.source?.name ?? null,
          status: String(asset.status),
          missing: false,
          depth: 1,
          side: 'side',
          via: seed,
          viaKind: 'meaning',
          viaTerm: { id: term.id, key: term.key, name: term.term },
        });
      }
      edges.push({
        id: `sl:${asset.id}:${term.id}`,
        fromType: 'asset',
        fromId: seed,
        toType: 'asset',
        toId: asset.id,
        relationType: 'MEANS',
        relationClass: 'REFERENCE',
        kind: 'meaning',
        confidence: null,
        viaTerm: { id: term.id, key: term.key, name: term.term },
      });
    }
    return { nodes, edges, truncated };
  }
}
