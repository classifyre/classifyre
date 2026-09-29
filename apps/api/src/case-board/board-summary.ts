import type { GraphNodeDto } from '../dto/graph.dto';
import type { BoardItemDto, CaseBoardResponseDto } from '../dto/case-board.dto';
import { boardBounds, buildBoardModel } from './board-layout';

/**
 * The case board as an agent reads it (MCP `get_case_board`): every item
 * joined with what it stands for and labelled, so a client can act on the
 * board without joining ids across four arrays. The full payload stays
 * available (view "full"); this is the default because it is a fraction of
 * the size and says the same things.
 */

/** Findings listed per evidence item before the rest are only counted. */
export const SUMMARY_FINDINGS_PER_ITEM = 25;
const TEXT_EXCERPT = 280;
const VALUE_EXCERPT = 80;
/** Platform relations between items listed before the rest are only counted. */
const RELATIONS_LISTED = 100;

type FindingState =
  | 'deleted'
  | 'gone'
  | 'resolved'
  | 'dismissed'
  | 'new'
  | 'open';

/** The six visible finding states, highest priority first (the board's finding-state.ts). */
export function findingState(n: GraphNodeDto | undefined): FindingState {
  if (!n) return 'open';
  if (n.missing) return 'deleted';
  if (n.matchState === 'GONE') return 'gone';
  if (n.status === 'RESOLVED') return 'resolved';
  if (n.status === 'FALSE_POSITIVE' || n.status === 'IGNORED')
    return 'dismissed';
  if (n.matchState === 'NEW') return 'new';
  return 'open';
}

function excerpt(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const line = value.replace(/\s+/g, ' ').trim();
  if (!line) return null;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, v]) => v !== undefined && v !== null && v !== false,
    ),
  ) as Partial<T>;
}

export function summarizeBoard(
  res: CaseBoardResponseDto,
  opts: { findingsPerItem?: number } = {},
): Record<string, unknown> {
  const findingsPerItem = opts.findingsPerItem ?? SUMMARY_FINDINGS_PER_ITEM;
  const model = buildBoardModel(res);
  const nodes = new Map<string, GraphNodeDto>();
  for (const n of res.graph?.nodes ?? []) nodes.set(`${n.type}:${n.id}`, n);
  const evidenceById = new Map(res.evidence.map((e) => [e.id, e]));
  const threads = new Map(res.threads.map((t) => [t.id, t]));
  const members = new Map<string, number>();
  for (const item of res.items) {
    if (item.parentId && item.kind !== 'COMMENT') {
      members.set(item.parentId, (members.get(item.parentId) ?? 0) + 1);
    }
  }

  let findingCount = 0;
  const counts = {
    evidence: 0,
    findings: 0,
    hypotheses: 0,
    notes: 0,
    frames: 0,
    comments: 0,
    links: res.links.length,
    stances: 0,
    unplaced: 0,
  };

  const items = res.items.map((item: BoardItemDto) => {
    const unplaced = item.x === null || item.y === null;
    if (unplaced) counts.unplaced += 1;
    const style = item.style ?? {};
    const base = {
      id: item.id,
      kind: item.kind,
      x: item.x,
      y: item.y,
      unplaced: unplaced || undefined,
      parentId: item.parentId ?? undefined,
      collapsed: item.collapsed || undefined,
      color: typeof style.color === 'string' ? style.color : undefined,
      highlight:
        typeof style.highlight === 'string' ? style.highlight : undefined,
    };
    switch (item.kind) {
      case 'EVIDENCE': {
        counts.evidence += 1;
        const ev = item.refId ? evidenceById.get(item.refId) : undefined;
        const asset = ev
          ? nodes.get(`${ev.entityType}:${ev.entityId}`)
          : undefined;
        const attached = ev?.findings ?? [];
        findingCount += attached.length;
        const rowHighlights =
          style.rowHighlights && typeof style.rowHighlights === 'object'
            ? (style.rowHighlights as Record<string, unknown>)
            : {};
        const inCase = new Set(attached.map((f) => f.findingId));
        let notInCase = 0;
        for (const n of res.graph?.nodes ?? []) {
          if (
            n.type === 'finding' &&
            n.assetId === ev?.entityId &&
            !inCase.has(n.id) &&
            !n.missing
          ) {
            notInCase += 1;
          }
        }
        return compact({
          ...base,
          label:
            ev?.entity?.label ??
            asset?.label ??
            ev?.entityId ??
            '(evidence no longer in the case)',
          assetId: ev?.entityId,
          assetType: ev?.entity?.assetType ?? asset?.assetType,
          source:
            asset?.sourceName ?? ev?.entity?.sourceType ?? asset?.sourceType,
          missingFromSource: asset?.missing || undefined,
          findingCount: attached.length,
          findings: attached.slice(0, findingsPerItem).map((f) =>
            compact({
              findingId: f.findingId,
              type: f.findingLabel,
              value: excerpt(f.matchedContent, VALUE_EXCERPT),
              severity: f.severity,
              detector: f.customDetectorName ?? f.detectorType,
              state: findingState(nodes.get(`finding:${f.findingId}`)),
              escalated: f.escalatedAt
                ? (f.escalationLabel ?? true)
                : undefined,
              highlight:
                typeof rowHighlights[f.findingId] === 'string'
                  ? rowHighlights[f.findingId]
                  : undefined,
            }),
          ),
          findingsOmitted:
            attached.length > findingsPerItem
              ? attached.length - findingsPerItem
              : undefined,
          findingsNotInCase: notInCase || undefined,
        });
      }
      case 'HYPOTHESIS': {
        counts.hypotheses += 1;
        const t = item.refId ? threads.get(item.refId) : undefined;
        return compact({
          ...base,
          label: t?.title ?? '(hypothesis)',
          threadId: item.refId,
          status: t?.status,
          confidence: t?.confidence,
          stances: t
            ? {
                supports: t.supportingCount,
                contradicts: t.contradictingCount,
                neutral: t.neutralCount,
              }
            : undefined,
        });
      }
      case 'NOTE':
        counts.notes += 1;
        return compact({
          ...base,
          label: excerpt(item.content?.text, TEXT_EXCERPT) ?? '(empty note)',
          width: item.width,
          height: item.height,
        });
      case 'FRAME':
        counts.frames += 1;
        return compact({
          ...base,
          label:
            excerpt(item.content?.title, TEXT_EXCERPT) ?? '(untitled frame)',
          width: item.width,
          height: item.height,
          members: members.get(item.id) ?? 0,
        });
      default: {
        counts.comments += 1;
        const t = item.refId ? threads.get(item.refId) : undefined;
        return compact({
          ...base,
          parentId: undefined,
          label: t?.lastExcerpt ?? t?.title ?? '(comment)',
          threadId: item.refId,
          anchor: item.parentId
            ? compact({
                itemId: item.parentId,
                findingId:
                  typeof style.anchorFindingId === 'string'
                    ? style.anchorFindingId
                    : undefined,
              })
            : undefined,
          replies: t ? Math.max(0, t.entryCount - 1) : undefined,
          resolved: t?.resolvedAt ? true : undefined,
        });
      }
    }
  });
  counts.findings = findingCount;

  const threadItem = new Map<string, string>();
  for (const t of res.threads)
    if (t.itemId && t.onBoard) threadItem.set(t.id, t.itemId);
  const stances = res.supports
    .filter((s) => s.endpoint)
    .map((s) =>
      compact({
        supportId: s.id,
        hypothesisItemId: threadItem.get(s.threadId),
        threadId: s.threadId,
        target: compact({
          itemId: s.endpoint!.itemId,
          findingId: s.endpoint!.findingId ?? undefined,
        }),
        stance: s.stance,
        weight: s.weight,
        note: excerpt(s.note, TEXT_EXCERPT),
      }),
    );
  counts.stances = stances.length;

  const links = res.links.map((l) =>
    compact({
      id: l.id,
      source: compact({
        itemId: l.sourceItemId,
        findingId: l.sourceFindingId ?? undefined,
      }),
      target: compact({
        itemId: l.targetItemId,
        findingId: l.targetFindingId ?? undefined,
      }),
      kind: l.kind,
      label: l.label,
      certainty: l.certainty,
      confidence: l.confidence,
      note: excerpt(l.note, TEXT_EXCERPT),
      global: l.promotedEdgeId ? true : undefined,
      updatedAt: l.updatedAt,
    }),
  );

  // Platform relations between items on the board (lineage, duplicates,
  // references), which the board draws but no op can change: one entry per
  // pair of items, with every relation type between them.
  const platform = new Map<
    string,
    { source: string; target: string; relationTypes: string[] }
  >();
  for (const r of model.relations) {
    if (r.via !== 'platform') continue;
    const key = `${r.source}|${r.target}`;
    const entry = platform.get(key) ?? {
      source: r.source,
      target: r.target,
      relationTypes: [],
    };
    if (r.relationType && !entry.relationTypes.includes(r.relationType)) {
      entry.relationTypes.push(r.relationType);
    }
    platform.set(key, entry);
  }
  const relations = [...platform.values()];

  return {
    board: {
      caseId: res.board.caseId,
      version: res.board.version,
      readOnly: res.board.readOnly,
      caseStatus: res.board.caseStatus,
    },
    counts,
    bounds: boardBounds(model),
    items,
    links,
    stances,
    relations: relations.slice(0, RELATIONS_LISTED),
    ...(relations.length > RELATIONS_LISTED
      ? { relationsOmitted: relations.length - RELATIONS_LISTED }
      : {}),
    threadsNotOnBoard: res.threads
      .filter((t) => !t.onBoard)
      .map((t) =>
        compact({
          threadId: t.id,
          kind: t.kind,
          title: t.title,
          resolved: t.resolvedAt ? true : undefined,
        }),
      ),
  };
}

/** A short human label per item: the asset's name, a thread's title, a note's text, a frame's title. */
export function itemLabels(res: CaseBoardResponseDto): Map<string, string> {
  const evidenceById = new Map(res.evidence.map((e) => [e.id, e]));
  const threads = new Map(res.threads.map((t) => [t.id, t]));
  const labels = new Map<string, string>();
  for (const item of res.items) {
    let label: string | null = null;
    if (item.kind === 'EVIDENCE') {
      const ev = item.refId ? evidenceById.get(item.refId) : undefined;
      label = ev?.entity?.label ?? ev?.entityId ?? null;
    } else if (item.kind === 'HYPOTHESIS' || item.kind === 'COMMENT') {
      label = item.refId ? (threads.get(item.refId)?.title ?? null) : null;
    } else if (item.kind === 'NOTE') {
      label = excerpt(item.content?.text, 80);
    } else if (item.kind === 'FRAME') {
      label = excerpt(item.content?.title, 80);
    }
    labels.set(item.id, label ?? item.kind.toLowerCase());
  }
  return labels;
}
