import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  AssetStatus,
  AssetType,
  DetectorType,
  Prisma,
  RunnerStatus,
  Severity,
  TriggerType,
} from '@prisma/client';
import { PrismaService } from '../src/prisma.service';
import { createTestApp, TestApp } from './create-test-app';

/**
 * Case leads against a real schema: the partial unique index on asset leads,
 * the look-alike source reading the duplicates engine's edges and Duplicate
 * review's verdicts, settling, and the timeline entry a refresh writes. The
 * semantic source needs pgvector and is covered by the unit spec.
 */
describe('Case leads (e2e)', () => {
  let ctx: TestApp;
  let prisma: PrismaService;
  let sourceId: string;
  let runnerId: string;

  const actor = 'Lead Tester';
  const post = (path: string) =>
    request(ctx.httpTarget)
      .post(path)
      .set('X-Actor-Name', encodeURIComponent(actor));

  async function seedAsset(
    name: string,
    opts: { status?: AssetStatus; finding?: string } = {},
  ) {
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
        ...(opts.status ? { status: opts.status } : {}),
      },
    });
    let findingId: string | null = null;
    if (opts.finding) {
      findingId = randomUUID();
      await prisma.finding.create({
        data: {
          id: findingId,
          detectionIdentity: `detection-${findingId}`,
          assetId,
          sourceId,
          runnerId,
          detectorType: DetectorType.PII,
          findingType: 'EMAIL',
          category: 'pii',
          severity: Severity.HIGH,
          confidence: 0.9,
          matchedContent: opts.finding,
          detectedAt: new Date(),
        },
      });
    }
    return { assetId, findingId };
  }

  async function link(
    fromId: string,
    toId: string,
    relationType: 'identical_content' | 'likely_duplicate',
    confidence: number,
    metadata?: Prisma.InputJsonValue,
  ) {
    await prisma.edge.create({
      data: {
        fromType: 'asset',
        fromId,
        toType: 'asset',
        toId,
        relationType,
        confidence,
        relationClass:
          relationType === 'identical_content' ? 'IDENTITY' : 'REFERENCE',
        ...(metadata ? { metadata } : {}),
      },
    });
  }

  async function verdict(x: string, y: string, v: 'CONFIRMED' | 'REJECTED') {
    const [aId, bId] = x <= y ? [x, y] : [y, x];
    await prisma.correlationPairVerdict.create({
      data: {
        aId,
        bId,
        verdict: v,
        patternKey: 'EMAIL',
        scoreAtVerdict: 0.8,
        batchId: randomUUID(),
        decidedBy: actor,
      },
    });
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    prisma = ctx.prisma!;
    const source = await prisma.source.create({
      data: {
        name: 'Leads source',
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
      await prisma.correlationPairVerdict.deleteMany({});
      await prisma.edge.deleteMany({});
      await prisma.finding.deleteMany({});
      await prisma.asset.deleteMany({});
      await prisma.runner.deleteMany({});
      await prisma.source.deleteMany({});
    }
    await ctx?.close();
  });

  it('suggests look-alike documents, honours Duplicate review, and settles itself', async () => {
    const evidence = await seedAsset('contract.txt', {
      finding: 'jane@example.com',
    });
    const copy = await seedAsset('contract (copy).txt');
    const lookAlike = await seedAsset('contract-v2.txt');
    const rejected = await seedAsset('newsletter.txt');
    const confirmed = await seedAsset('scan-of-contract.txt');
    const deleted = await seedAsset('deleted.txt', {
      status: AssetStatus.DELETED,
    });
    await link(evidence.assetId, copy.assetId, 'identical_content', 1);
    await link(lookAlike.assetId, evidence.assetId, 'likely_duplicate', 0.74, {
      sharedByLabel: { EMAIL: 2, PERSON: 1 },
    });
    await link(evidence.assetId, rejected.assetId, 'identical_content', 1);
    await link(evidence.assetId, deleted.assetId, 'likely_duplicate', 0.9);
    await verdict(evidence.assetId, rejected.assetId, 'REJECTED');
    await verdict(evidence.assetId, confirmed.assetId, 'CONFIRMED');

    const created = await post('/cases')
      .send({ title: 'Leads case' })
      .expect(201);
    const caseId = created.body.id as string;
    await post(`/cases/${caseId}/findings`)
      .send({ findingIds: [evidence.findingId] })
      .expect(200);

    // ── A refresh: three look-alikes, none rejected or deleted ─────────────
    const generated = await post(`/cases/${caseId}/leads/generate`).expect(201);
    expect(generated.body).toEqual(
      expect.objectContaining({ proposed: 3, byOrigin: { DUPLICATE: 3 } }),
    );
    const listed = await request(ctx.httpTarget)
      .get(`/cases/${caseId}/leads`)
      .expect(200);
    const byAsset = new Map(
      (listed.body as Array<Record<string, unknown>>).map((l) => [
        l.assetId as string,
        l,
      ]),
    );
    expect([...byAsset.keys()].sort()).toEqual(
      [copy.assetId, lookAlike.assetId, confirmed.assetId].sort(),
    );
    for (const lead of byAsset.values()) {
      expect(lead).toEqual(
        expect.objectContaining({
          kind: 'ASSET',
          findingId: null,
          origin: 'DUPLICATE',
          state: 'OPEN',
          viaAssetId: evidence.assetId,
          viaAssetName: 'contract.txt',
        }),
      );
    }
    expect(byAsset.get(confirmed.assetId)!.details).toEqual({
      relation: 'confirmed',
      verdict: 'CONFIRMED',
    });
    expect(byAsset.get(copy.assetId)!.details).toEqual({
      relation: 'identical_content',
    });
    expect(byAsset.get(lookAlike.assetId)!.rationale).toBe(
      'Shares EMAIL, PERSON with "contract.txt" · match weight 74%',
    );

    // Nothing is proposed twice, and the partial index holds the line too.
    const again = await post(`/cases/${caseId}/leads/generate`).expect(201);
    expect(again.body.proposed).toBe(0);
    const duplicateRow = await prisma.caseLead.createMany({
      data: [
        {
          caseId,
          assetId: copy.assetId,
          origin: 'DUPLICATE',
          rationale: 'again',
          title: 'again',
          proposedBy: 'e2e',
        },
      ],
      skipDuplicates: true,
    });
    expect(duplicateRow.count).toBe(0);

    // ── Accepting a look-alike adds the document and follows its verdict ──
    const confirmedLead = byAsset.get(confirmed.assetId)!;
    await post(`/cases/${caseId}/leads/${confirmedLead.id as string}/review`)
      .send({ action: 'ACCEPT' })
      .expect(201);
    expect(
      await prisma.caseEvidence.count({
        where: { caseId, entityId: confirmed.assetId },
      }),
    ).toBe(1);
    const [aId, bId] = [evidence.assetId, confirmed.assetId].sort();
    expect(
      (
        await prisma.correlationPairVerdict.findUniqueOrThrow({
          where: { aId_bId: { aId, bId } },
        })
      ).caseId,
    ).toBe(caseId);

    // ── A lead whose document joins another way settles as accepted ───────
    await post(`/cases/${caseId}/evidence`)
      .send({ entityType: 'asset', entityId: copy.assetId })
      .expect(201);
    const marked = await request(ctx.httpTarget)
      .get(`/cases/${caseId}/leads`)
      .expect(200);
    expect(
      (marked.body as Array<Record<string, unknown>>).find(
        (l) => l.assetId === copy.assetId,
      )?.state,
    ).toBe('IN_CASE');
    const settled = await post(`/cases/${caseId}/leads/generate`).expect(201);
    expect(settled.body.settled).toBe(1);
    const copyLead = await prisma.caseLead.findFirstOrThrow({
      where: { caseId, assetId: copy.assetId, findingId: null },
    });
    expect(copyLead).toEqual(
      expect.objectContaining({ status: 'ACCEPTED', reviewedBy: 'case-leads' }),
    );

    // ── Dismissing is remembered: never proposed again ─────────────────────
    const lookAlikeLead = byAsset.get(lookAlike.assetId)!;
    const dismissed = await post(`/cases/${caseId}/leads/review`)
      .send({
        leadIds: [lookAlikeLead.id, randomUUID()],
        action: 'DISMISS',
        reason: 'another version, not relevant',
      })
      .expect(201);
    expect(dismissed.body).toEqual({ updated: 1, failed: 1 });
    const after = await post(`/cases/${caseId}/leads/generate`).expect(201);
    expect(after.body.proposed).toBe(0);

    // ── One timeline entry per refresh, not one per lead ───────────────────
    const timeline = await request(ctx.httpTarget)
      .get(`/cases/${caseId}/timeline`)
      .query({ limit: '100' })
      .expect(200);
    const items = timeline.body.items as Array<{
      activityType: string;
      actor: string | null;
      payload: Record<string, unknown>;
    }>;
    const refreshes = items.filter((i) => i.activityType === 'LEADS_GENERATED');
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]).toEqual(
      expect.objectContaining({
        actor,
        payload: expect.objectContaining({
          proposed: 3,
          byOrigin: { DUPLICATE: 3 },
        }),
      }),
    );
    expect(items.some((i) => i.activityType === 'LEAD_PROPOSED')).toBe(false);
  });

  it('suggests nothing for a closed case', async () => {
    const evidence = await seedAsset('closed.txt');
    const copy = await seedAsset('closed (copy).txt');
    await link(evidence.assetId, copy.assetId, 'identical_content', 1);
    const created = await post('/cases').send({ title: 'Closed' }).expect(201);
    const caseId = created.body.id as string;
    await post(`/cases/${caseId}/evidence`)
      .send({ entityType: 'asset', entityId: evidence.assetId })
      .expect(201);
    await post(`/cases/${caseId}/close`)
      .send({ conclusion: 'Done.' })
      .expect(200);

    const res = await post(`/cases/${caseId}/leads/generate`).expect(201);

    expect(res.body.proposed).toBe(0);
  });
});
