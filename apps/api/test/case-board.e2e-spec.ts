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
import { createTestApp, TestApp } from './create-test-app';

/**
 * Case board against a real schema (docs/architecture/CASE_BOARD_PRD.md §9,
 * Phase 1). The reconcile is raw SQL with enum casts that a mocked Prisma
 * would accept whatever they said, and every op runs under a savepoint — both
 * only mean something against Postgres.
 */
describe('Case board (e2e)', () => {
  let ctx: TestApp;
  let prisma: PrismaService;
  let sourceId: string;
  let runnerId: string;

  const actor = 'Board Tester';
  const ops = (caseId: string, list: Record<string, unknown>[], who = actor) =>
    request(ctx.httpTarget)
      .post(`/cases/${caseId}/board/ops`)
      .set('X-Actor-Name', encodeURIComponent(who))
      .send({ clientId: 'e2e', baseVersion: 0, ops: list });
  const board = (caseId: string) =>
    request(ctx.httpTarget).get(`/cases/${caseId}/board`).expect(200);
  const opId = () => randomUUID();

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
    const findingIds: string[] = [];
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
      findingIds.push(findingId);
    }
    return { assetId, findingIds };
  }

  async function seedCase(title = 'Board case') {
    const res = await request(ctx.httpTarget)
      .post('/cases')
      .send({ title })
      .expect(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    prisma = ctx.prisma!;
    const source = await prisma.source.create({
      data: {
        name: 'Board source',
        type: AssetType.WORDPRESS,
        config: { url: 'https://example.com' },
      },
    });
    sourceId = source.id;
    const runner = await prisma.runner.create({
      data: {
        sourceId,
        triggerType: TriggerType.MANUAL,
        status: RunnerStatus.COMPLETED,
        startedAt: new Date(),
      },
    });
    runnerId = runner.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.case.deleteMany({});
      await prisma.edge.deleteMany({});
      await prisma.finding.deleteMany({});
      await prisma.asset.deleteMany({});
      await prisma.runner.deleteMany({});
      await prisma.source.deleteMany({});
    }
    await ctx?.close();
  });

  describe('reconcile (GET /cases/:id/board)', () => {
    it('creates one unplaced item per evidence and hypothesis, idempotently', async () => {
      const caseId = await seedCase();
      const a = await seedAsset('reconcile-a.txt');
      await request(ctx.httpTarget)
        .post(`/cases/${caseId}/evidence`)
        .send({ entityType: 'asset', entityId: a.assetId })
        .expect(201);
      await request(ctx.httpTarget)
        .post(`/cases/${caseId}/threads`)
        .send({ kind: 'HYPOTHESIS', title: 'H1' })
        .expect(201);

      const first = await board(caseId);
      const second = await board(caseId);
      const kinds = (
        first.body.items as Array<{ kind: string; x: number | null }>
      ).map((i) => i.kind);
      expect(kinds.sort()).toEqual(['EVIDENCE', 'HYPOTHESIS']);
      expect(first.body.items.every((i: { x: unknown }) => i.x === null)).toBe(
        true,
      );
      expect(second.body.items.map((i: { id: string }) => i.id).sort()).toEqual(
        first.body.items.map((i: { id: string }) => i.id).sort(),
      );
      expect(first.body.board.readOnly).toBe(false);
      expect(first.body.graph.nodes.length).toBeGreaterThan(0);
    });

    it('soft-deletes items whose evidence was removed through the REST path', async () => {
      const caseId = await seedCase();
      const a = await seedAsset('reconcile-b.txt');
      const added = await request(ctx.httpTarget)
        .post(`/cases/${caseId}/evidence`)
        .send({ entityType: 'asset', entityId: a.assetId })
        .expect(201);
      const before = await board(caseId);
      expect(before.body.items).toHaveLength(1);

      await request(ctx.httpTarget)
        .delete(`/cases/${caseId}/evidence/${added.body.id}`)
        .expect(204);
      const after = await board(caseId);
      expect(after.body.items).toHaveLength(0);
      const row = await prisma.caseBoardItem.findUnique({
        where: { id: before.body.items[0].id },
      });
      expect(row?.deletedAt).not.toBeNull();
    });
  });

  describe('ops', () => {
    it('attributes writes to X-Actor-Name and bumps the version once per batch', async () => {
      const caseId = await seedCase();
      const noteId = randomUUID();
      const frameId = randomUUID();
      const res = await ops(
        caseId,
        [
          {
            type: 'item.create',
            opId: opId(),
            id: noteId,
            kind: 'NOTE',
            x: 10,
            y: 20,
            content: { text: 'Hello' },
          },
          {
            type: 'item.create',
            opId: opId(),
            id: frameId,
            kind: 'FRAME',
            x: 0,
            y: 0,
            width: 600,
            height: 400,
            content: { title: 'Payroll' },
          },
        ],
        'Jürgen Müller',
      ).expect(200);
      expect(res.body.applied).toHaveLength(2);
      expect(res.body.rejected).toHaveLength(0);
      expect(res.body.version).toBe(1);

      const note = await prisma.caseBoardItem.findUniqueOrThrow({
        where: { id: noteId },
      });
      expect(note.createdBy).toBe('Jürgen Müller');
      const timeline = await prisma.caseActivity.findMany({
        where: {
          caseId,
          activityType: { in: ['BOARD_NOTE_ADDED', 'BOARD_FRAME_ADDED'] },
        },
      });
      expect(timeline).toHaveLength(2);
      expect(timeline.every((t) => t.actor === 'Jürgen Müller')).toBe(true);

      // A second writer that loaded version 0 is told it is stale.
      const late = await ops(caseId, [
        { type: 'item.update', opId: opId(), id: noteId, patch: { x: 50 } },
      ]).expect(200);
      expect(late.body.stale).toBe(true);
      expect(late.body.version).toBe(2);
    });

    it('rejects unknown keys (strict objects) with 400', async () => {
      const caseId = await seedCase();
      await ops(caseId, [
        {
          type: 'item.create',
          opId: opId(),
          id: randomUUID(),
          kind: 'NOTE',
          x: 0,
          y: 0,
          colour: 'red',
        },
      ]).expect(400);
      await request(ctx.httpTarget)
        .post(`/cases/${caseId}/board/ops`)
        .send({ clientId: 'e2e', baseVersion: 0, ops: [], extra: true })
        .expect(400);
    });

    it('rejects writes on CLOSED cases with 409', async () => {
      const caseId = await seedCase();
      await request(ctx.httpTarget)
        .post(`/cases/${caseId}/close`)
        .send({ conclusion: 'Done.' })
        .expect(200);
      const res = await board(caseId);
      expect(res.body.board.readOnly).toBe(true);
      await ops(caseId, [
        {
          type: 'item.create',
          opId: opId(),
          id: randomUUID(),
          kind: 'NOTE',
          x: 0,
          y: 0,
        },
      ]).expect(409);
    });

    it('rejects item.delete on EVIDENCE but lets a hypothesis card leave the board', async () => {
      const caseId = await seedCase();
      const a = await seedAsset('delete-guard.txt');
      const evItem = randomUUID();
      const hypItem = randomUUID();
      await ops(caseId, [
        {
          type: 'evidence.add',
          opId: opId(),
          itemId: evItem,
          entityType: 'asset',
          entityId: a.assetId,
          x: 0,
          y: 0,
        },
        {
          type: 'hypothesis.create',
          opId: opId(),
          itemId: hypItem,
          title: 'Leak via share',
          x: 400,
          y: 0,
        },
      ]).expect(200);

      const res = await ops(caseId, [
        { type: 'item.delete', opId: 'del-ev', id: evItem },
        { type: 'item.delete', opId: 'del-hyp', id: hypItem },
      ]).expect(200);
      expect(res.body.rejected).toEqual([
        expect.objectContaining({ opId: 'del-ev', code: 'READ_ONLY_KIND' }),
      ]);
      expect(res.body.applied.map((a: { opId: string }) => a.opId)).toEqual([
        'del-hyp',
      ]);
      // The thread stays; only its card left the board.
      const after = await board(caseId);
      expect(after.body.threads).toHaveLength(1);
      expect(after.body.threads[0]).toMatchObject({
        onBoard: false,
        itemId: hypItem,
      });
    });

    it('soft-deletes links with a deleted note and restores them on item.restore', async () => {
      const caseId = await seedCase();
      const n1 = randomUUID();
      const n2 = randomUUID();
      const link = randomUUID();
      await ops(caseId, [
        { type: 'item.create', opId: opId(), id: n1, kind: 'NOTE', x: 0, y: 0 },
        {
          type: 'item.create',
          opId: opId(),
          id: n2,
          kind: 'NOTE',
          x: 300,
          y: 0,
        },
        {
          type: 'link.create',
          opId: opId(),
          id: link,
          source: { itemId: n1 },
          target: { itemId: n2 },
          kind: 'related_to',
        },
      ]).expect(200);

      await ops(caseId, [{ type: 'item.delete', opId: opId(), id: n1 }]).expect(
        200,
      );
      let res = await board(caseId);
      expect(res.body.links).toHaveLength(0);

      await ops(caseId, [
        { type: 'item.restore', opId: opId(), id: n1 },
      ]).expect(200);
      res = await board(caseId);
      expect(res.body.links.map((l: { id: string }) => l.id)).toEqual([link]);
      const kinds = (
        await prisma.caseActivity.findMany({
          where: { caseId },
          orderBy: { createdAt: 'asc' },
        })
      ).map((a) => a.activityType);
      expect(kinds).toEqual(
        expect.arrayContaining([
          'BOARD_NOTE_ADDED',
          'BOARD_LINK_ADDED',
          'BOARD_NOTE_REMOVED',
        ]),
      );
    });

    it('replaying a create is idempotent and redo brings the same row back', async () => {
      const caseId = await seedCase();
      const n = randomUUID();
      const create = {
        type: 'item.create',
        opId: opId(),
        id: n,
        kind: 'NOTE',
        x: 5,
        y: 5,
        content: { text: 'x' },
      };
      await ops(caseId, [create]).expect(200);
      await ops(caseId, [{ ...create, opId: opId() }]).expect(200);
      expect(await prisma.caseBoardItem.count({ where: { id: n } })).toBe(1);
      await ops(caseId, [{ type: 'item.delete', opId: opId(), id: n }]).expect(
        200,
      );
      await ops(caseId, [{ ...create, opId: opId() }]).expect(200);
      const row = await prisma.caseBoardItem.findUniqueOrThrow({
        where: { id: n },
      });
      expect(row.deletedAt).toBeNull();
    });

    it('rejects a link whose endpoint belongs to another board', async () => {
      const caseA = await seedCase('A');
      const caseB = await seedCase('B');
      const inA = randomUUID();
      const inB = randomUUID();
      await ops(caseA, [
        {
          type: 'item.create',
          opId: opId(),
          id: inA,
          kind: 'NOTE',
          x: 0,
          y: 0,
        },
      ]).expect(200);
      await ops(caseB, [
        {
          type: 'item.create',
          opId: opId(),
          id: inB,
          kind: 'NOTE',
          x: 0,
          y: 0,
        },
      ]).expect(200);
      const res = await ops(caseA, [
        {
          type: 'link.create',
          opId: 'cross',
          id: randomUUID(),
          source: { itemId: inA },
          target: { itemId: inB },
          kind: 'related_to',
        },
      ]).expect(200);
      expect(res.body.rejected).toEqual([
        expect.objectContaining({ opId: 'cross', code: 'NOT_FOUND' }),
      ]);
      expect(
        await prisma.caseBoardLink.count({
          where: { board: { caseId: caseA } },
        }),
      ).toBe(0);
    });

    it('rejects a findingId that is not attached to the endpoint evidence', async () => {
      const caseId = await seedCase();
      const a = await seedAsset('link-rows.txt');
      const ev = randomUUID();
      const note = randomUUID();
      await ops(caseId, [
        {
          type: 'evidence.add',
          opId: opId(),
          itemId: ev,
          entityType: 'asset',
          entityId: a.assetId,
          x: 0,
          y: 0,
        },
        {
          type: 'item.create',
          opId: opId(),
          id: note,
          kind: 'NOTE',
          x: 500,
          y: 0,
        },
      ]).expect(200);
      const bad = await ops(caseId, [
        {
          type: 'link.create',
          opId: 'row',
          id: randomUUID(),
          source: { itemId: ev, findingId: a.findingIds[0] },
          target: { itemId: note },
          kind: 'related_to',
        },
      ]).expect(200);
      expect(bad.body.rejected).toHaveLength(1);

      await ops(caseId, [
        {
          type: 'finding.attach',
          opId: opId(),
          itemId: ev,
          findingId: a.findingIds[0],
        },
      ]).expect(200);
      const good = await ops(caseId, [
        {
          type: 'link.create',
          opId: 'row2',
          id: randomUUID(),
          source: { itemId: ev, findingId: a.findingIds[0] },
          target: { itemId: note },
          kind: 'related_to',
        },
      ]).expect(200);
      expect(good.body.applied).toHaveLength(1);
    });

    it('link.promote writes a MANUAL edge once and is idempotent', async () => {
      const caseId = await seedCase();
      const a = await seedAsset('promote-a.txt');
      const b = await seedAsset('promote-b.txt');
      const ea = randomUUID();
      const eb = randomUUID();
      const link = randomUUID();
      await ops(caseId, [
        {
          type: 'evidence.add',
          opId: opId(),
          itemId: ea,
          entityType: 'asset',
          entityId: a.assetId,
          x: 0,
          y: 0,
        },
        {
          type: 'evidence.add',
          opId: opId(),
          itemId: eb,
          entityType: 'asset',
          entityId: b.assetId,
          x: 500,
          y: 0,
        },
        {
          type: 'link.create',
          opId: opId(),
          id: link,
          source: { itemId: ea },
          target: { itemId: eb },
          kind: 'communicates_with',
        },
      ]).expect(200);

      // A board link never leaks into the global graph by itself (D2).
      const where = {
        fromId: a.assetId,
        toId: b.assetId,
        relationType: 'COMMUNICATES_WITH',
      };
      expect(await prisma.edge.count({ where })).toBe(0);

      await ops(caseId, [
        { type: 'link.promote', opId: opId(), id: link },
      ]).expect(200);
      await ops(caseId, [
        { type: 'link.promote', opId: opId(), id: link },
      ]).expect(200);
      const edges = await prisma.edge.findMany({ where });
      expect(edges).toHaveLength(1);
      expect(edges[0].origin).toBe('MANUAL');
      const row = await prisma.caseBoardLink.findUniqueOrThrow({
        where: { id: link },
      });
      expect(row.promotedEdgeId).toBe(edges[0].id);
    });

    it('writes at most one BOARD_ARRANGED per actor per 5 minutes', async () => {
      const caseId = await seedCase();
      const n = randomUUID();
      await ops(caseId, [
        { type: 'item.create', opId: opId(), id: n, kind: 'NOTE', x: 0, y: 0 },
      ]).expect(200);
      for (let i = 1; i <= 3; i += 1) {
        await ops(caseId, [
          {
            type: 'item.update',
            opId: opId(),
            id: n,
            patch: { x: i * 10, y: i * 10 },
          },
        ]).expect(200);
      }
      await ops(
        caseId,
        [{ type: 'item.update', opId: opId(), id: n, patch: { x: 99 } }],
        'Someone else',
      ).expect(200);
      const arranged = await prisma.caseActivity.findMany({
        where: { caseId, activityType: 'BOARD_ARRANGED' },
      });
      expect(arranged.map((a) => a.actor).sort()).toEqual(
        [actor, 'Someone else'].sort(),
      );
    });

    it('rolls back a refused op alone, including the writes it made before refusing', async () => {
      const caseId = await seedCase();
      const note = randomUUID();
      const hyp = randomUUID();
      const res = await ops(caseId, [
        { type: 'item.create', opId: 'ok', id: note, kind: 'NOTE', x: 0, y: 0 },
        // Creates a thread and a card, then fails on its support target.
        {
          type: 'hypothesis.create',
          opId: 'bad',
          itemId: hyp,
          title: 'Rolls back',
          supports: [{ itemId: note }],
        },
      ]).expect(200);
      expect(res.body.applied.map((a: { opId: string }) => a.opId)).toEqual([
        'ok',
      ]);
      expect(res.body.rejected.map((r: { opId: string }) => r.opId)).toEqual([
        'bad',
      ]);
      expect(await prisma.caseThread.count({ where: { caseId } })).toBe(0);
      expect(await prisma.caseBoardItem.count({ where: { id: hyp } })).toBe(0);
      expect(await prisma.caseBoardItem.count({ where: { id: note } })).toBe(1);
    });

    it('rejects a stale text edit and hands back the current row', async () => {
      const caseId = await seedCase();
      const n = randomUUID();
      const created = await ops(caseId, [
        {
          type: 'item.create',
          opId: opId(),
          id: n,
          kind: 'NOTE',
          x: 0,
          y: 0,
          content: { text: 'v1' },
        },
      ]).expect(200);
      const startedFrom = created.body.applied[0].updatedAt as string;
      await ops(
        caseId,
        [
          {
            type: 'item.update',
            opId: opId(),
            id: n,
            patch: { content: { text: 'v2' } },
            expectedUpdatedAt: startedFrom,
          },
        ],
        'MK',
      ).expect(200);
      const stale = await ops(caseId, [
        {
          type: 'item.update',
          opId: 'late',
          id: n,
          patch: { content: { text: 'v3' } },
          expectedUpdatedAt: startedFrom,
        },
      ]).expect(200);
      expect(stale.body.rejected[0]).toMatchObject({
        opId: 'late',
        code: 'STALE',
      });
      expect(stale.body.rejected[0].reason).toContain('MK');
      expect(stale.body.rejected[0].current.item.content).toEqual({
        text: 'v2',
      });
    });
  });

  describe('domain ops', () => {
    it('evidence.remove keeps a tombstone and replaying evidence.add restores the same rows', async () => {
      const caseId = await seedCase();
      const a = await seedAsset('remove-restore.txt');
      const ev = randomUUID();
      const hyp = randomUUID();
      await ops(caseId, [
        {
          type: 'evidence.add',
          opId: opId(),
          itemId: ev,
          entityType: 'asset',
          entityId: a.assetId,
          x: 10,
          y: 10,
        },
        {
          type: 'finding.attach',
          opId: opId(),
          itemId: ev,
          findingId: a.findingIds[0],
        },
        {
          type: 'hypothesis.create',
          opId: opId(),
          itemId: hyp,
          title: 'H',
          x: 400,
          y: 0,
        },
        {
          type: 'stance.set',
          opId: opId(),
          hypothesisItemId: hyp,
          target: { itemId: ev, findingId: a.findingIds[0] },
          stance: 'SUPPORTS',
        },
      ]).expect(200);
      const before = await board(caseId);
      const caseFindingId = before.body.evidence[0].findings[0].id as string;
      expect(before.body.supports[0].endpoint).toEqual({
        itemId: ev,
        findingId: a.findingIds[0],
      });

      await ops(caseId, [
        { type: 'evidence.remove', opId: opId(), itemId: ev },
      ]).expect(200);
      let res = await board(caseId);
      expect(res.body.evidence).toHaveLength(0);
      expect(res.body.supports[0].endpoint).toBeNull();

      await ops(caseId, [
        {
          type: 'evidence.add',
          opId: opId(),
          itemId: ev,
          entityType: 'asset',
          entityId: a.assetId,
          x: 10,
          y: 10,
        },
      ]).expect(200);
      res = await board(caseId);
      expect(res.body.evidence[0].findings[0].id).toBe(caseFindingId);
      expect(res.body.supports[0].endpoint).toEqual({
        itemId: ev,
        findingId: a.findingIds[0],
      });
      // The tombstone is server-private undo state.
      expect(
        res.body.items.find((i: { id: string }) => i.id === ev).content,
      ).toBeNull();
    });

    it('finding.detach then finding.attach brings back the same case finding and its links', async () => {
      const caseId = await seedCase();
      const a = await seedAsset('detach.txt');
      const ev = randomUUID();
      const note = randomUUID();
      const link = randomUUID();
      await ops(caseId, [
        {
          type: 'evidence.add',
          opId: opId(),
          itemId: ev,
          entityType: 'finding',
          entityId: a.findingIds[1],
          x: 0,
          y: 0,
        },
        {
          type: 'item.create',
          opId: opId(),
          id: note,
          kind: 'NOTE',
          x: 400,
          y: 0,
        },
        {
          type: 'link.create',
          opId: opId(),
          id: link,
          source: { itemId: ev, findingId: a.findingIds[1] },
          target: { itemId: note },
          kind: 'related_to',
        },
      ]).expect(200);
      const cfBefore = await prisma.caseFinding.findFirstOrThrow({
        where: { caseId },
      });

      await ops(caseId, [
        {
          type: 'finding.detach',
          opId: opId(),
          itemId: ev,
          findingId: a.findingIds[1],
        },
      ]).expect(200);
      expect(await prisma.caseFinding.count({ where: { caseId } })).toBe(0);
      expect((await board(caseId)).body.links).toHaveLength(0);

      await ops(caseId, [
        {
          type: 'finding.attach',
          opId: opId(),
          itemId: ev,
          findingId: a.findingIds[1],
        },
      ]).expect(200);
      const cfAfter = await prisma.caseFinding.findFirstOrThrow({
        where: { caseId },
      });
      expect(cfAfter.id).toBe(cfBefore.id);
      expect(
        (await board(caseId)).body.links.map((l: { id: string }) => l.id),
      ).toEqual([link]);
    });

    it('stance.set on an unattached finding row attaches it first', async () => {
      const caseId = await seedCase();
      const a = await seedAsset('stance.txt');
      const ev = randomUUID();
      const hyp = randomUUID();
      const res = await ops(caseId, [
        {
          type: 'evidence.add',
          opId: opId(),
          itemId: ev,
          entityType: 'asset',
          entityId: a.assetId,
          x: 0,
          y: 0,
        },
        {
          type: 'hypothesis.create',
          opId: opId(),
          itemId: hyp,
          title: 'H',
          x: 400,
          y: 0,
        },
        {
          type: 'stance.set',
          opId: opId(),
          hypothesisItemId: hyp,
          target: { itemId: ev, findingId: a.findingIds[1] },
          stance: 'CONTRADICTS',
        },
      ]).expect(200);
      expect(res.body.rejected).toHaveLength(0);
      expect(
        await prisma.caseFinding.count({
          where: { caseId, findingId: a.findingIds[1] },
        }),
      ).toBe(1);
      const support = await prisma.caseThreadSupport.findFirstOrThrow({
        where: { thread: { caseId } },
      });
      expect(support.stance).toBe('CONTRADICTS');
      await ops(caseId, [
        {
          type: 'stance.remove',
          opId: opId(),
          hypothesisItemId: hyp,
          target: { itemId: ev, findingId: a.findingIds[1] },
        },
      ]).expect(200);
      expect(
        await prisma.caseThreadSupport.count({ where: { id: support.id } }),
      ).toBe(0);
    });

    it('evidence.add of evidence already on the board is refused with the existing item', async () => {
      const caseId = await seedCase();
      const a = await seedAsset('dup.txt');
      const first = randomUUID();
      await ops(caseId, [
        {
          type: 'evidence.add',
          opId: opId(),
          itemId: first,
          entityType: 'asset',
          entityId: a.assetId,
        },
      ]).expect(200);
      const res = await ops(caseId, [
        {
          type: 'evidence.add',
          opId: 'again',
          itemId: randomUUID(),
          entityType: 'asset',
          entityId: a.assetId,
        },
      ]).expect(200);
      expect(res.body.rejected[0]).toMatchObject({
        code: 'ALREADY_ON_BOARD',
        current: { itemId: first },
      });
    });

    it('comment.create anchors a discussion thread and comment.resolve greys it', async () => {
      const caseId = await seedCase();
      const note = randomUUID();
      const pin = randomUUID();
      await ops(caseId, [
        {
          type: 'item.create',
          opId: opId(),
          id: note,
          kind: 'NOTE',
          x: 0,
          y: 0,
        },
        {
          type: 'comment.create',
          opId: opId(),
          itemId: pin,
          body: 'Who wrote this?',
          anchor: { itemId: note },
          x: 180,
          y: -10,
        },
      ]).expect(200);
      let res = await board(caseId);
      const thread = res.body.threads.find(
        (t: { kind: string }) => t.kind === 'DISCUSSION',
      );
      expect(thread).toMatchObject({
        entryCount: 1,
        lastExcerpt: 'Who wrote this?',
        itemId: pin,
        onBoard: true,
      });
      expect(
        res.body.items.find((i: { id: string }) => i.id === pin).parentId,
      ).toBe(note);

      await ops(caseId, [
        { type: 'comment.resolve', opId: opId(), itemId: pin, resolved: true },
      ]).expect(200);
      res = await board(caseId);
      expect(
        res.body.threads.find((t: { id: string }) => t.id === thread.id)
          .resolvedBy,
      ).toBe(actor);
    });
  });

  describe('live layer', () => {
    it('marks an attached finding whose row was deleted as missing', async () => {
      const caseId = await seedCase();
      const a = await seedAsset('ghost.txt');
      const ev = randomUUID();
      await ops(caseId, [
        {
          type: 'evidence.add',
          opId: opId(),
          itemId: ev,
          entityType: 'finding',
          entityId: a.findingIds[0],
        },
      ]).expect(200);
      await prisma.edge.deleteMany({ where: { toId: a.findingIds[0] } });
      await prisma.finding.delete({ where: { id: a.findingIds[0] } });

      const res = await board(caseId);
      const node = res.body.graph.nodes.find(
        (n: { id: string }) => n.id === a.findingIds[0],
      );
      expect(node).toMatchObject({ type: 'finding', missing: true });
      const live = res.body.graph.nodes.find(
        (n: { id: string }) => n.id === a.assetId,
      );
      expect(live.missing).toBe(false);
    });
  });

  describe('snapshots', () => {
    it('captures, lists and reads a manual snapshot, and one on close', async () => {
      const caseId = await seedCase();
      await ops(caseId, [
        {
          type: 'item.create',
          opId: opId(),
          id: randomUUID(),
          kind: 'NOTE',
          x: 0,
          y: 0,
          content: { text: 'frozen' },
        },
      ]).expect(200);
      const snap = await request(ctx.httpTarget)
        .post(`/cases/${caseId}/board/snapshots`)
        .set('X-Actor-Name', actor)
        .expect(201);
      expect(snap.body).toMatchObject({
        reason: 'MANUAL',
        version: 1,
        createdBy: actor,
      });
      const one = await request(ctx.httpTarget)
        .get(`/cases/${caseId}/board/snapshots/${snap.body.id}`)
        .expect(200);
      expect(one.body.payload.items[0].content).toEqual({ text: 'frozen' });

      await request(ctx.httpTarget)
        .post(`/cases/${caseId}/close`)
        .send({ conclusion: 'Closed with a snapshot.' })
        .expect(200);
      const list = await request(ctx.httpTarget)
        .get(`/cases/${caseId}/board/snapshots`)
        .expect(200);
      expect(list.body.map((s: { reason: string }) => s.reason)).toEqual([
        'CASE_CLOSED',
        'MANUAL',
      ]);
    });
  });
});
