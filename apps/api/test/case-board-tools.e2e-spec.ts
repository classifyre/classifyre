import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  AssetType,
  DetectorType,
  RunnerStatus,
  Severity,
  TriggerType,
} from '@prisma/client';
import { PrismaService } from '../src/prisma.service';
import { CaseBoardToolsService } from '../src/case-board/case-board-tools.service';
import { createTestApp, TestApp } from './create-test-app';

type Item = {
  id: string;
  kind: string;
  x: number | null;
  y: number | null;
  parentId: string | null;
  width: number | null;
  height: number | null;
  content: Record<string, unknown> | null;
  style: Record<string, unknown> | null;
};

/**
 * The MCP arrange tools against a real schema: plans become ordinary board
 * ops, so versions, parents and the timeline must come out as for a person's
 * edit (docs/architecture/CASE_BOARD_PRD.md §7.6).
 */
describe('Case board tools (e2e)', () => {
  let ctx: TestApp;
  let prisma: PrismaService;
  let tools: CaseBoardToolsService;
  let sourceId: string;
  let runnerId: string;

  const board = async (caseId: string) =>
    (await request(ctx.httpTarget).get(`/cases/${caseId}/board`).expect(200))
      .body as { board: { version: number }; items: Item[] };
  const ops = (caseId: string, list: Record<string, unknown>[]) =>
    request(ctx.httpTarget)
      .post(`/cases/${caseId}/board/ops`)
      .send({ clientId: 'e2e', baseVersion: 0, ops: list })
      .expect(200);

  async function seedAsset(name: string, findings = 2) {
    const assetId = randomUUID();
    await prisma.asset.create({
      data: {
        id: assetId,
        hash: assetId,
        checksum: `checksum-${assetId}`,
        name,
        externalUrl: `urn:${assetId}`,
        links: [],
        assetType: 'TXT',
        sourceType: AssetType.WORDPRESS,
        sourceId,
        runnerId,
      },
    });
    for (let i = 0; i < findings; i += 1) {
      const findingId = randomUUID();
      await prisma.finding.create({
        data: {
          id: findingId,
          detectionIdentity: `detection-${findingId}`,
          assetId,
          sourceId,
          runnerId,
          detectorType: DetectorType.SECRETS,
          findingType: `TYPE_${i}`,
          category: 'security',
          severity: i === 0 ? Severity.CRITICAL : Severity.LOW,
          confidence: 0.9,
          matchedContent: `value-${i}-${assetId.slice(0, 6)}`,
          detectedAt: new Date(),
        },
      });
    }
    return assetId;
  }

  /** A case with three assets added without positions, one note placed. */
  async function seedBoard() {
    const caseId = (
      await request(ctx.httpTarget)
        .post('/cases')
        .send({ title: 'Tools case' })
        .expect(201)
    ).body.id as string;
    const assets = [
      await seedAsset('tools-a.txt', 5),
      await seedAsset('tools-b.txt', 2),
      await seedAsset('tools-c.txt', 0),
    ];
    const evidenceItems = assets.map(() => randomUUID());
    const note = randomUUID();
    const hypothesis = randomUUID();
    await ops(caseId, [
      ...assets.map((entityId, i) => ({
        type: 'evidence.add',
        opId: `e${i}`,
        itemId: evidenceItems[i],
        entityType: 'asset',
        entityId,
      })),
      {
        type: 'item.create',
        opId: 'n',
        id: note,
        kind: 'NOTE',
        x: 0,
        y: 0,
        content: { text: 'placed by hand' },
      },
      {
        type: 'hypothesis.create',
        opId: 'h',
        itemId: hypothesis,
        title: 'A and B were exported together',
        supports: [{ itemId: evidenceItems[0] }, { itemId: evidenceItems[1] }],
      },
      {
        type: 'link.create',
        opId: 'l',
        id: randomUUID(),
        source: { itemId: evidenceItems[0] },
        target: { itemId: evidenceItems[2] },
        kind: 'related_to',
      },
    ]);
    return { caseId, evidenceItems, note, hypothesis };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    prisma = ctx.prisma!;
    tools = ctx.get(CaseBoardToolsService);
    const source = await prisma.source.create({
      data: {
        name: 'Tools source',
        type: AssetType.WORDPRESS,
        config: { url: 'https://example.com' },
      },
    });
    sourceId = source.id;
    runnerId = (
      await prisma.runner.create({
        data: {
          sourceId,
          triggerType: TriggerType.MANUAL,
          status: RunnerStatus.COMPLETED,
          startedAt: new Date(),
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.case.deleteMany({});
      await prisma.finding.deleteMany({});
      await prisma.asset.deleteMany({});
      await prisma.runner.deleteMany({});
      await prisma.source.deleteMany({});
    }
    await ctx?.close();
  });

  it('places every unplaced item and nothing else, without an arranging entry', async () => {
    const { caseId, note } = await seedBoard();
    const before = await board(caseId);
    expect(before.items.filter((i) => i.x === null).length).toBe(4);

    const result = await tools.place(caseId, 'mcp');
    expect(result.placed).toHaveLength(4);
    expect(result.version).toBe(before.board.version + 1);

    const after = await board(caseId);
    expect(after.items.every((i) => i.x !== null && i.y !== null)).toBe(true);
    const placedNote = after.items.find((i) => i.id === note)!;
    expect([placedNote.x, placedNote.y]).toEqual([0, 0]);
    // First placement is layout, not someone rearranging the board.
    const arranged = await prisma.caseActivity.count({
      where: { caseId, activityType: 'BOARD_ARRANGED' },
    });
    expect(arranged).toBe(0);

    const again = await tools.place(caseId, 'mcp');
    expect(again.placed).toEqual([]);
  });

  it('tidies: a dry run writes nothing, a second tidy moves nothing', async () => {
    const { caseId } = await seedBoard();
    await tools.place(caseId, 'mcp');
    const { board: meta } = await board(caseId);

    const dry = await tools.tidy(caseId, { dryRun: true }, 'mcp');
    expect(dry.dryRun).toBe(true);
    expect((await board(caseId)).board.version).toBe(meta.version);

    const tidied = await tools.tidy(caseId, {}, 'mcp');
    expect(tidied.moves.length).toBe(dry.moves.length);
    const after = await board(caseId);
    for (const move of tidied.moves) {
      const item = after.items.find((i) => i.id === move.itemId)!;
      expect({ x: item.x, y: item.y }).toEqual(move.to);
    }
    const second = await tools.tidy(caseId, {}, 'mcp');
    expect(second.moves).toEqual([]);
    expect(second.note).toMatch(/already tidy/);
  });

  it('frames items: a new frame holds them, an existing one grows', async () => {
    const { caseId, evidenceItems, note } = await seedBoard();
    await tools.place(caseId, 'mcp');

    const created = await tools.frame(
      caseId,
      {
        itemIds: [evidenceItems[0], evidenceItems[1]],
        title: 'Exported together',
        color: 'blue',
      },
      'mcp',
    );
    expect(created.rejected).toEqual([]);
    let items = (await board(caseId)).items;
    const frame = items.find((i) => i.id === created.frameId)!;
    expect(frame.kind).toBe('FRAME');
    expect(frame.content).toEqual({ title: 'Exported together' });
    expect(frame.style).toEqual({ color: 'blue' });
    for (const id of [evidenceItems[0], evidenceItems[1]]) {
      expect(items.find((i) => i.id === id)!.parentId).toBe(created.frameId);
    }

    const grown = await tools.frame(
      caseId,
      { itemIds: [note, evidenceItems[2]], frameId: created.frameId },
      'mcp',
    );
    items = (await board(caseId)).items;
    expect(items.find((i) => i.id === note)!.parentId).toBe(created.frameId);
    const after = items.find((i) => i.id === created.frameId)!;
    expect((after.height ?? 0) * (after.width ?? 0)).toBeGreaterThan(
      (frame.height ?? 0) * (frame.width ?? 0),
    );
    expect(grown.skipped).toEqual([]);
  });

  it('summarises the board with labels and refuses to arrange a closed case', async () => {
    const { caseId, evidenceItems } = await seedBoard();
    const summary = (await tools.view(caseId)) as Record<string, any>;
    expect(summary.counts).toMatchObject({
      evidence: 3,
      hypotheses: 1,
      notes: 1,
      unplaced: 4,
    });
    const a = summary.items.find((i: any) => i.id === evidenceItems[0]);
    expect(a).toMatchObject({
      label: 'tools-a.txt',
      findingCount: 0,
      unplaced: true,
    });
    expect(summary.stances).toHaveLength(2);

    await request(ctx.httpTarget)
      .post(`/cases/${caseId}/close`)
      .send({ conclusion: 'done' })
      .expect(200);
    await expect(tools.place(caseId, 'mcp')).rejects.toThrow(/read-only/);
    // Reads still work, and a dry run is only a read.
    await expect(
      tools.tidy(caseId, { dryRun: true }, 'mcp'),
    ).resolves.toMatchObject({ dryRun: true });
  });

  it('traces from every asset in the case and marks what is in it', async () => {
    const { caseId, evidenceItems } = await seedBoard();
    const trace = await tools.trace(caseId, {});
    expect(trace.seeds).toBe(3);
    const inCase = trace.nodes.filter((n) => n.inCase);
    expect(inCase.map((n) => n.itemId).sort()).toEqual(
      [...evidenceItems].sort(),
    );
  });
});
