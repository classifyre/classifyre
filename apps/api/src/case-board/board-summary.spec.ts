import type { CaseBoardResponseDto } from '../dto/case-board.dto';
import { findingState, itemLabels, summarizeBoard } from './board-summary';

const EV = '00000000-0000-4000-8000-000000000001';
const HYP = '00000000-0000-4000-8000-000000000002';
const NOTE = '00000000-0000-4000-8000-000000000003';
const FRAME = '00000000-0000-4000-8000-000000000004';
const PIN = '00000000-0000-4000-8000-000000000005';

function res(): CaseBoardResponseDto {
  const base = {
    z: 0,
    width: null,
    height: null,
    collapsed: false,
    style: null,
    content: null,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  return {
    board: {
      id: 'b',
      caseId: 'case-1',
      version: 7,
      readOnly: false,
      caseStatus: 'OPEN',
    },
    items: [
      {
        ...base,
        id: EV,
        kind: 'EVIDENCE',
        refId: 'ev-1',
        x: 0,
        y: 0,
        parentId: FRAME,
        style: { rowHighlights: { 'f-1': 'yellow' } },
      },
      {
        ...base,
        id: HYP,
        kind: 'HYPOTHESIS',
        refId: 'th-1',
        x: null,
        y: null,
        parentId: null,
      },
      {
        ...base,
        id: NOTE,
        kind: 'NOTE',
        refId: null,
        x: 400,
        y: 0,
        parentId: null,
        content: { text: 'Check  the\npayroll export' },
        style: { color: 'yellow' },
      },
      {
        ...base,
        id: FRAME,
        kind: 'FRAME',
        refId: null,
        x: -50,
        y: -80,
        parentId: null,
        width: 700,
        height: 500,
        content: { title: 'Payroll' },
      },
      {
        ...base,
        id: PIN,
        kind: 'COMMENT',
        refId: 'th-2',
        x: 100,
        y: -14,
        parentId: EV,
        style: { anchorFindingId: 'f-2' },
      },
    ],
    links: [
      {
        id: 'l-1',
        sourceItemId: NOTE,
        sourceFindingId: null,
        targetItemId: EV,
        targetFindingId: 'f-1',
        kind: 'related_to',
        label: 'same IBAN',
        certainty: 'SUSPECTED',
        confidence: 0.6,
        note: null,
        promotedEdgeId: null,
        createdBy: null,
        updatedBy: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ],
    evidence: [
      {
        id: 'ev-1',
        entityType: 'asset',
        entityId: 'asset-1',
        note: null,
        addedBy: null,
        createdAt: new Date(0),
        entity: { id: 'asset-1', label: 'payroll.xlsx', assetType: 'XLSX' },
        findings: [
          {
            id: 'cf-1',
            caseEvidenceId: 'ev-1',
            findingId: 'f-1',
            findingLabel: 'IBAN',
            severity: 'HIGH',
            detectorType: 'PII',
            matchedContent: 'AT61 1904 3002 3457 3201',
            escalatedAt: new Date(0),
            escalationLabel: 'IBAN watch',
          },
          {
            id: 'cf-2',
            caseEvidenceId: 'ev-1',
            findingId: 'f-2',
            findingLabel: 'EMAIL',
            severity: 'LOW',
            detectorType: 'PII',
            matchedContent: 'a@b.c',
          },
        ],
      },
    ],
    graph: {
      nodes: [
        {
          id: 'asset-1',
          type: 'asset',
          label: 'payroll.xlsx',
          depth: 0,
          sourceName: 'Share drive',
        },
        {
          id: 'f-1',
          type: 'finding',
          label: 'IBAN: AT61',
          depth: 0,
          assetId: 'asset-1',
          matchState: 'NEW',
        },
        {
          id: 'f-2',
          type: 'finding',
          label: 'EMAIL: a@b.c',
          depth: 0,
          assetId: 'asset-1',
          status: 'RESOLVED',
        },
        {
          id: 'f-3',
          type: 'finding',
          label: 'PHONE: 1',
          depth: 0,
          assetId: 'asset-1',
        },
      ],
      edges: [],
      truncated: false,
    },
    supports: [
      {
        id: 's-1',
        threadId: 'th-1',
        targetType: 'finding',
        targetId: 'cf-1',
        stance: 'SUPPORTS',
        weight: 0.8,
        note: null,
        endpoint: { itemId: EV, findingId: 'f-1' },
        createdAt: new Date(0),
      },
    ],
    threads: [
      {
        id: 'th-1',
        kind: 'HYPOTHESIS',
        title: 'Payroll left via the share',
        status: 'PROPOSED',
        confidence: 0.4,
        entryCount: 1,
        supportingCount: 1,
        contradictingCount: 0,
        neutralCount: 0,
        itemId: HYP,
        onBoard: true,
      },
      {
        id: 'th-2',
        kind: 'DISCUSSION',
        title: 'Who exported this?',
        entryCount: 3,
        lastExcerpt: 'Ask HR',
        itemId: PIN,
        onBoard: true,
        resolvedAt: null,
      },
      {
        id: 'th-3',
        kind: 'HYPOTHESIS',
        title: 'Off the board',
        entryCount: 0,
        itemId: null,
        onBoard: false,
      },
    ],
  } as unknown as CaseBoardResponseDto;
}

describe('summarizeBoard', () => {
  it('labels every item and joins what it stands for', () => {
    const summary = summarizeBoard(res()) as Record<string, any>;
    expect(summary.board).toEqual({
      caseId: 'case-1',
      version: 7,
      readOnly: false,
      caseStatus: 'OPEN',
    });
    expect(summary.counts).toMatchObject({
      evidence: 1,
      findings: 2,
      hypotheses: 1,
      notes: 1,
      frames: 1,
      comments: 1,
      links: 1,
      stances: 1,
      unplaced: 1,
    });
    const byId = new Map<string, any>(summary.items.map((i: any) => [i.id, i]));
    expect(byId.get(EV)).toMatchObject({
      kind: 'EVIDENCE',
      label: 'payroll.xlsx',
      assetId: 'asset-1',
      source: 'Share drive',
      parentId: FRAME,
      findingCount: 2,
      findingsNotInCase: 1,
      findings: [
        {
          findingId: 'f-1',
          type: 'IBAN',
          state: 'new',
          escalated: 'IBAN watch',
          highlight: 'yellow',
        },
        { findingId: 'f-2', type: 'EMAIL', state: 'resolved' },
      ],
    });
    expect(byId.get(HYP)).toMatchObject({
      kind: 'HYPOTHESIS',
      label: 'Payroll left via the share',
      unplaced: true,
      stances: { supports: 1 },
    });
    expect(byId.get(NOTE)).toMatchObject({
      label: 'Check the payroll export',
      color: 'yellow',
    });
    expect(byId.get(FRAME)).toMatchObject({ label: 'Payroll', members: 1 });
    expect(byId.get(PIN)).toMatchObject({
      kind: 'COMMENT',
      label: 'Ask HR',
      anchor: { itemId: EV, findingId: 'f-2' },
      replies: 2,
    });
    expect(byId.get(PIN).parentId).toBeUndefined();
    expect(summary.stances).toEqual([
      {
        supportId: 's-1',
        hypothesisItemId: HYP,
        threadId: 'th-1',
        target: { itemId: EV, findingId: 'f-1' },
        stance: 'SUPPORTS',
        weight: 0.8,
      },
    ]);
    expect(summary.links[0]).toMatchObject({
      source: { itemId: NOTE },
      target: { itemId: EV, findingId: 'f-1' },
      certainty: 'SUSPECTED',
      label: 'same IBAN',
    });
    expect(summary.threadsNotOnBoard).toEqual([
      { threadId: 'th-3', kind: 'HYPOTHESIS', title: 'Off the board' },
    ]);
  });

  it('lists a capped number of findings per item and counts the rest', () => {
    const summary = summarizeBoard(res(), { findingsPerItem: 1 }) as Record<
      string,
      any
    >;
    const ev = summary.items.find((i: any) => i.id === EV);
    expect(ev.findings).toHaveLength(1);
    expect(ev.findingsOmitted).toBe(1);
  });
});

describe('summarizeBoard relations', () => {
  it('lists platform relations once per pair, with every type between them', () => {
    const board = res();
    const EV2 = '00000000-0000-4000-8000-000000000009';
    board.items.push({
      ...board.items[0],
      id: EV2,
      refId: 'ev-2',
      parentId: null,
      style: null,
    });
    board.evidence.push({
      ...board.evidence[0],
      id: 'ev-2',
      entityId: 'asset-2',
      entity: { id: 'asset-2', label: 'payroll-copy.xlsx' },
      findings: [],
    });
    const edge = (id: string, relationType: string) => ({
      id,
      fromType: 'asset',
      fromId: 'asset-1',
      toType: 'asset',
      toId: 'asset-2',
      relationType,
      confidence: 0.9,
      origin: 'INFERRED',
    });
    board.graph.edges.push(
      edge('e-1', 'likely_duplicate') as never,
      edge('e-2', 'related') as never,
      { ...edge('e-3', 'CONTAINS'), toType: 'finding', toId: 'f-1' } as never,
    );
    const summary = summarizeBoard(board) as Record<string, any>;
    expect(summary.relations).toEqual([
      {
        source: EV,
        target: EV2,
        relationTypes: ['likely_duplicate', 'related'],
      },
    ]);
  });
});

describe('findingState', () => {
  it('ranks the states the way the board draws them', () => {
    expect(findingState(undefined)).toBe('open');
    expect(findingState({ missing: true, matchState: 'GONE' } as any)).toBe(
      'deleted',
    );
    expect(
      findingState({ matchState: 'GONE', status: 'RESOLVED' } as any),
    ).toBe('gone');
    expect(findingState({ status: 'FALSE_POSITIVE' } as any)).toBe('dismissed');
    expect(findingState({ matchState: 'NEW' } as any)).toBe('new');
  });
});

describe('itemLabels', () => {
  it('names items by what they stand for', () => {
    const labels = itemLabels(res());
    expect(labels.get(EV)).toBe('payroll.xlsx');
    expect(labels.get(HYP)).toBe('Payroll left via the share');
    expect(labels.get(FRAME)).toBe('Payroll');
  });
});
