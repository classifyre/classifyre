import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  AssetStatus,
  AssetType,
  DetectorType,
  FindingStatus,
  RunnerStatus,
  Severity,
  TriggerType,
} from '@prisma/client';
import { PrismaService } from '../src/prisma.service';
import { CaseCleanupService } from '../src/cases/case-cleanup.service';
import {
  AUTO_PULL_ACTOR,
  CASE_PULL,
  type CasePullPort,
} from '../src/cases/case-pull.port';
import { createTestApp, TestApp } from './create-test-app';

/**
 * Case clean-up rules and finding filters against a real schema. The source
 * sweep is raw SQL with enum casts, a pass locks the case row, removals write
 * board tombstones and cascade through case_evidence — none of which a mocked
 * Prisma would ever disagree with.
 */
describe('Case clean-up and finding filters (e2e)', () => {
  let ctx: TestApp;
  let prisma: PrismaService;
  let sourceId: string;
  let runnerId: string;

  const actor = 'Cleanup Tester';
  const api = () => request(ctx.httpTarget);

  async function seedAsset(
    name: string,
    findings: Array<{ type: string; value: string; detector?: DetectorType }>,
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
      },
    });
    const findingIds: string[] = [];
    for (const f of findings) {
      const findingId = randomUUID();
      await prisma.finding.create({
        data: {
          id: findingId,
          detectionIdentity: `detection-${findingId}`,
          assetId,
          sourceId,
          runnerId,
          detectorType: f.detector ?? DetectorType.PII,
          findingType: f.type,
          category: 'PII',
          severity: Severity.MEDIUM,
          confidence: 0.9,
          matchedContent: f.value,
          detectedAt: new Date(),
        },
      });
      findingIds.push(findingId);
    }
    return { assetId, findingIds };
  }

  async function seedCase(body: Record<string, unknown> = {}) {
    const res = await api()
      .post('/cases')
      .send({ title: 'Clean-up case', ...body })
      .expect(201);
    return res.body.id as string;
  }

  async function attach(caseId: string, findingIds: string[]) {
    await api()
      .post(`/cases/${caseId}/findings`)
      .send({ findingIds })
      .expect(200);
  }

  async function citedFindingIds(caseId: string): Promise<string[]> {
    const rows = await prisma.caseFinding.findMany({
      where: { caseId },
      select: { findingId: true },
    });
    return rows.map((r) => r.findingId).sort();
  }

  async function timeline(caseId: string) {
    const res = await api()
      .get(`/cases/${caseId}/timeline?limit=100`)
      .expect(200);
    return res.body.items as Array<{
      activityType: string;
      actor: string | null;
      payload: Record<string, unknown>;
    }>;
  }

  async function retire(findingId: string, reason: string | null) {
    await prisma.finding.update({
      where: { id: findingId },
      data: {
        status: FindingStatus.RESOLVED,
        resolvedAt: new Date(),
        resolutionReason: reason,
      },
    });
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    prisma = ctx.prisma!;
    const source = await prisma.source.create({
      data: {
        name: 'Clean-up source',
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
      await prisma.inquiry.deleteMany({});
      await prisma.edge.deleteMany({});
      await prisma.finding.deleteMany({});
      await prisma.asset.deleteMany({});
      await prisma.runner.deleteMany({});
      await prisma.source.deleteMany({});
    }
    await ctx?.close();
  });

  describe('clean-up switches', () => {
    it('are off by default and take nothing out', async () => {
      const caseId = await seedCase();
      const a = await seedAsset('off.txt', [{ type: 'PERSON', value: 'Ann' }]);
      await attach(caseId, a.findingIds);
      await retire(a.findingIds[0], 'Detection no longer present in scan');
      const res = await api().get(`/cases/${caseId}`).expect(200);
      expect(res.body.removeGoneFindings).toBe(false);
      await api().get(`/cases/${caseId}/board`).expect(200);
      expect(await citedFindingIds(caseId)).toEqual(a.findingIds);
    });

    it('preview says what switching one on would take out, and writes nothing', async () => {
      const caseId = await seedCase();
      const a = await seedAsset('preview.txt', [
        { type: 'PERSON', value: 'Ann' },
        { type: 'EMAIL_ADDRESS', value: 'ann@example.com' },
        { type: 'LOCATION', value: 'Vienna' },
      ]);
      await attach(caseId, a.findingIds);
      await retire(a.findingIds[0], 'Detection no longer present in scan');
      await retire(a.findingIds[1], 'Checked with the owner');
      const res = await api()
        .post(`/cases/${caseId}/cleanup/preview`)
        .send({ removeGoneFindings: true, removeResolvedFindings: true })
        .expect(200);
      expect(res.body).toMatchObject({
        goneFindings: 1,
        resolvedFindings: 1,
        goneAssets: 0,
      });
      expect(res.body.sample).toHaveLength(2);
      expect(await citedFindingIds(caseId)).toHaveLength(3);
    });

    it('apply on save, say so on the timeline, and keep undo state on the board', async () => {
      const caseId = await seedCase();
      const a = await seedAsset('save.txt', [
        { type: 'PERSON', value: 'Ann' },
        { type: 'EMAIL_ADDRESS', value: 'ann@example.com' },
      ]);
      await attach(caseId, a.findingIds);
      // Open the board so it has an item to keep the tombstone on.
      const before = await api().get(`/cases/${caseId}/board`).expect(200);
      const item = before.body.items.find(
        (i: { kind: string }) => i.kind === 'EVIDENCE',
      );
      await retire(a.findingIds[1], null);

      const res = await api()
        .patch(`/cases/${caseId}`)
        .set('X-Actor-Name', encodeURIComponent(actor))
        .send({ removeResolvedFindings: true })
        .expect(200);
      expect(res.body.removeResolvedFindings).toBe(true);
      expect(res.body.cleanup).toMatchObject({
        findingsRemoved: 1,
        evidenceRemoved: 0,
      });
      expect(await citedFindingIds(caseId)).toEqual([a.findingIds[0]]);

      const events = await timeline(caseId);
      const settings = events.find(
        (e) => e.activityType === 'CLEANUP_SETTINGS_UPDATED',
      );
      expect(settings?.actor).toBe(actor);
      expect(settings?.payload.changes).toEqual([
        { rule: 'removeResolvedFindings', enabled: true },
      ]);
      const removed = events.find(
        (e) => e.activityType === 'FINDINGS_AUTO_REMOVED',
      );
      expect(removed?.actor).toBe(actor);
      expect(removed?.payload).toMatchObject({
        reason: 'FINDING_RESOLVED',
        trigger: 'RULE_ENABLED',
        count: 1,
        itemId: item.id,
      });
      expect(
        (removed?.payload.findings as Array<Record<string, unknown>>)[0],
      ).toMatchObject({
        findingId: a.findingIds[1],
        label: 'EMAIL_ADDRESS',
        value: 'ann@example.com',
        assetLabel: 'save.txt',
      });
      // A PATCH that only flips switches is not a case edit.
      expect(events.some((e) => e.activityType === 'CASE_UPDATED')).toBe(false);

      // Attaching it again from the board brings back the same row.
      const cf = await prisma.caseFinding.findMany({ where: { caseId } });
      expect(cf).toHaveLength(1);
      const stored = await prisma.caseBoardItem.findUniqueOrThrow({
        where: { id: item.id },
      });
      const detached = (stored.content as Record<string, unknown>)
        .detached as Record<string, { findingId: string }>;
      expect(detached[a.findingIds[1]].findingId).toBe(a.findingIds[1]);
    });

    it('take out gone findings — retired by a scan or deleted outright', async () => {
      const caseId = await seedCase({ removeGoneFindings: true });
      const a = await seedAsset('gone.txt', [
        { type: 'PERSON', value: 'Ann' },
        { type: 'PERSON', value: 'Bob' },
        { type: 'PERSON', value: 'Cy' },
      ]);
      await attach(caseId, a.findingIds);
      await retire(a.findingIds[0], 'Detection no longer present in scan');
      await prisma.finding.delete({ where: { id: a.findingIds[1] } });

      await ctx.get(CaseCleanupService).sweepForSource(sourceId, { runnerId });

      expect(await citedFindingIds(caseId)).toEqual([a.findingIds[2]]);
      const removed = (await timeline(caseId)).find(
        (e) => e.activityType === 'FINDINGS_AUTO_REMOVED',
      );
      expect(removed?.actor).toBe('case-cleanup');
      expect(removed?.payload).toMatchObject({
        reason: 'FINDING_GONE',
        trigger: 'SCAN',
        count: 2,
        sourceId,
        sourceNames: ['Clean-up source'],
      });
      const states = (
        removed?.payload.findings as Array<{ state: string }>
      ).map((f) => f.state);
      expect(states.sort()).toEqual(['DELETED', 'RETIRED']);
      // The case said at creation which switches it started with.
      expect(
        (await timeline(caseId)).some(
          (e) => e.activityType === 'CLEANUP_SETTINGS_UPDATED',
        ),
      ).toBe(true);
    });

    it('take out assets gone from their source, with their findings', async () => {
      const caseId = await seedCase({ removeGoneAssets: true });
      const gone = await seedAsset('deleted.txt', [
        { type: 'PERSON', value: 'Ann' },
      ]);
      const kept = await seedAsset('kept.txt', [
        { type: 'PERSON', value: 'Bo' },
      ]);
      await attach(caseId, [...gone.findingIds, ...kept.findingIds]);
      await api().get(`/cases/${caseId}/board`).expect(200);
      await prisma.asset.update({
        where: { id: gone.assetId },
        data: { status: AssetStatus.DELETED },
      });

      await ctx.get(CaseCleanupService).sweepForSource(sourceId);

      const evidence = await prisma.caseEvidence.findMany({
        where: { caseId },
      });
      expect(evidence.map((e) => e.entityId)).toEqual([kept.assetId]);
      expect(await citedFindingIds(caseId)).toEqual(kept.findingIds);
      const items = await prisma.caseBoardItem.findMany({
        where: { board: { caseId }, kind: 'EVIDENCE' },
      });
      expect(items.filter((i) => i.deletedAt).length).toBe(1);
      const removed = (await timeline(caseId)).find(
        (e) => e.activityType === 'EVIDENCE_AUTO_REMOVED',
      );
      expect(removed?.payload).toMatchObject({
        reason: 'ASSET_GONE',
        count: 1,
        findingsRemoved: 1,
      });
    });

    it('react to a person resolving a cited finding', async () => {
      const caseId = await seedCase({ removeResolvedFindings: true });
      const a = await seedAsset('status.txt', [
        { type: 'PERSON', value: 'Ann' },
        { type: 'PERSON', value: 'Bob' },
      ]);
      await attach(caseId, a.findingIds);
      await api()
        .patch(`/findings/${a.findingIds[0]}`)
        .send({ status: 'RESOLVED' })
        .expect(200);
      expect(await citedFindingIds(caseId)).toEqual([a.findingIds[1]]);
      const removed = (await timeline(caseId)).find(
        (e) => e.activityType === 'FINDINGS_AUTO_REMOVED',
      );
      expect(removed?.payload).toMatchObject({
        reason: 'FINDING_RESOLVED',
        trigger: 'STATUS_CHANGE',
      });
    });

    it('leave a closed case alone', async () => {
      const caseId = await seedCase({ removeResolvedFindings: true });
      const a = await seedAsset('closed.txt', [{ type: 'PERSON', value: 'A' }]);
      await attach(caseId, a.findingIds);
      await api()
        .post(`/cases/${caseId}/close`)
        .send({ conclusion: 'Done.' })
        .expect(200);
      await retire(a.findingIds[0], null);
      await ctx.get(CaseCleanupService).sweepForSource(sourceId);
      expect(await citedFindingIds(caseId)).toEqual(a.findingIds);
    });

    it('fold the passes of a busy source into one timeline entry', async () => {
      const caseId = await seedCase({ removeGoneFindings: true });
      const a = await seedAsset('busy.txt', [
        { type: 'PERSON', value: 'Ann' },
        { type: 'PERSON', value: 'Bob' },
      ]);
      await attach(caseId, a.findingIds);
      const cleanup = ctx.get(CaseCleanupService);

      await retire(a.findingIds[0], 'Detection no longer present in scan');
      await cleanup.sweepForSource(sourceId, { runnerId });
      await retire(a.findingIds[1], 'Detection no longer present in scan');
      await cleanup.sweepForSource(sourceId, { runnerId });

      const removals = (await timeline(caseId)).filter(
        (e) => e.activityType === 'FINDINGS_AUTO_REMOVED',
      );
      expect(removals).toHaveLength(1);
      expect(removals[0].payload).toMatchObject({
        reason: 'FINDING_GONE',
        count: 2,
        passes: 2,
        triggers: { SCAN: 2 },
        sourceNames: ['Clean-up source'],
      });
      // Newest first.
      expect(
        (removals[0].payload.findings as Array<{ findingId: string }>).map(
          (f) => f.findingId,
        ),
      ).toEqual([a.findingIds[1], a.findingIds[0]]);
    });
  });

  describe('watches on the timeline', () => {
    it('say which watch had auto-add switched, and only when it changed', async () => {
      const inquiry = await api()
        .post('/inquiries')
        .send({
          title: 'Toggle me',
          sourceIds: [sourceId],
          detectorTypes: ['PII'],
        })
        .expect(201);
      const caseId = await seedCase({ inquiryIds: [inquiry.body.id] });
      const toggle = (autoPull: boolean) =>
        api()
          .patch(`/cases/${caseId}/inquiries/${inquiry.body.id}`)
          .set('X-Actor-Name', encodeURIComponent(actor))
          .send({ autoPull })
          .expect(200);
      await toggle(true);
      await toggle(true);
      await toggle(false);

      const settings = (await timeline(caseId)).filter(
        (e) => e.activityType === 'INQUIRY_SETTINGS_UPDATED',
      );
      expect(settings.map((e) => e.payload.changes)).toEqual([
        [{ setting: 'autoPull', from: true, to: false }],
        [{ setting: 'autoPull', from: false, to: true }],
      ]);
      expect(settings[0]).toMatchObject({
        actor,
        payload: { inquiryId: inquiry.body.id, inquiryTitle: 'Toggle me' },
      });
    });

    it('name the findings a watch auto-added, one entry per stretch of scans', async () => {
      const inquiry = await api()
        .post('/inquiries')
        .send({ title: 'Auto', sourceIds: [sourceId], detectorTypes: ['PII'] })
        .expect(201);
      const caseId = await seedCase({ inquiryIds: [inquiry.body.id] });
      const first = await seedAsset('auto-1.txt', [
        { type: 'EMAIL_ADDRESS', value: 'a@example.com' },
      ]);
      const second = await seedAsset('auto-2.txt', [
        { type: 'EMAIL_ADDRESS', value: 'b@example.com' },
      ]);
      const cases = ctx.get<CasePullPort>(CASE_PULL);
      await cases.pullFromInquiry(
        caseId,
        { inquiryId: inquiry.body.id, findingIds: first.findingIds },
        AUTO_PULL_ACTOR,
        { sourceId, runnerId },
      );
      await cases.pullFromInquiry(
        caseId,
        { inquiryId: inquiry.body.id, findingIds: second.findingIds },
        AUTO_PULL_ACTOR,
        { sourceId, runnerId },
      );
      // Nothing new: nothing to say.
      await cases.pullFromInquiry(
        caseId,
        { inquiryId: inquiry.body.id, findingIds: second.findingIds },
        AUTO_PULL_ACTOR,
        { sourceId, runnerId },
      );

      const pulls = (await timeline(caseId)).filter(
        (e) => e.activityType === 'INQUIRY_PULLED',
      );
      expect(pulls).toHaveLength(1);
      expect(pulls[0].actor).toBe(AUTO_PULL_ACTOR);
      expect(pulls[0].payload).toMatchObject({
        automatic: true,
        pulled: 2,
        passes: 2,
        sourceNames: ['Clean-up source'],
      });
      expect(
        (pulls[0].payload.findings as Array<Record<string, unknown>>).map(
          (f) => [f.label, f.value, f.assetLabel],
        ),
      ).toEqual([
        ['EMAIL_ADDRESS', 'b@example.com', 'auto-2.txt'],
        ['EMAIL_ADDRESS', 'a@example.com', 'auto-1.txt'],
      ]);

      // A person's pull is its own entry, never folded into the watch's.
      const third = await seedAsset('manual.txt', [
        { type: 'EMAIL_ADDRESS', value: 'c@example.com' },
      ]);
      await api()
        .post(`/cases/${caseId}/pull`)
        .send({ inquiryId: inquiry.body.id, findingIds: third.findingIds })
        .expect(200);
      expect(
        (await timeline(caseId)).filter(
          (e) => e.activityType === 'INQUIRY_PULLED',
        ),
      ).toHaveLength(2);
    });
  });

  describe('finding filters', () => {
    it('detach what a case-wide type filter matches, and skip it on pull-all', async () => {
      const inquiry = await api()
        .post('/inquiries')
        .send({
          title: 'Everything PII',
          sourceIds: [sourceId],
          detectorTypes: ['PII'],
        })
        .expect(201);
      const caseId = await seedCase({ inquiryIds: [inquiry.body.id] });
      const a = await seedAsset('filter.txt', [
        { type: 'IP_ADDRESS', value: '10.0.0.1' },
        { type: 'PERSON', value: 'Ann' },
      ]);
      await attach(caseId, a.findingIds);

      const preview = await api()
        .post(`/cases/${caseId}/finding-filters/preview`)
        .send({ rules: [{ kind: 'FINDING_TYPE', pattern: 'IP_ADDRESS' }] })
        .expect(200);
      expect(preview.body).toMatchObject({ matched: 1, perRule: [1] });

      const added = await api()
        .post(`/cases/${caseId}/finding-filters`)
        .set('X-Actor-Name', encodeURIComponent(actor))
        .send({
          rules: [
            {
              kind: 'FINDING_TYPE',
              pattern: 'IP_ADDRESS',
              description: 'Internal addresses',
            },
          ],
        })
        .expect(200);
      expect(added.body.detached).toBe(1);
      expect(added.body.filters).toHaveLength(1);
      expect(added.body.filters[0]).toMatchObject({
        kind: 'FINDING_TYPE',
        pattern: 'IP_ADDRESS',
        inquiryId: null,
        createdBy: actor,
      });
      expect(await citedFindingIds(caseId)).toEqual([a.findingIds[1]]);

      const events = await timeline(caseId);
      expect(
        events.find((e) => e.activityType === 'FINDING_FILTER_ADDED')?.payload,
      ).toMatchObject({ scope: 'CASE' });
      expect(
        events.find((e) => e.activityType === 'FINDINGS_AUTO_REMOVED')?.payload,
      ).toMatchObject({ reason: 'FILTER', trigger: 'FILTER_ADDED', count: 1 });

      // Pull everything: the filter keeps the IP address out…
      const pulled = await api()
        .post(`/cases/${caseId}/pull`)
        .send({ inquiryId: inquiry.body.id })
        .expect(200);
      expect(pulled.body.filtered).toBeGreaterThanOrEqual(1);
      expect(await citedFindingIds(caseId)).not.toContain(a.findingIds[0]);
      // …but a person picking it by hand is obeyed.
      await api()
        .post(`/cases/${caseId}/pull`)
        .send({ inquiryId: inquiry.body.id, findingIds: [a.findingIds[0]] })
        .expect(200);
      expect(await citedFindingIds(caseId)).toContain(a.findingIds[0]);
    });

    it('scope a filter to one watch: only that watch’s answers leave', async () => {
      const pii = await api()
        .post('/inquiries')
        .send({ title: 'PII', sourceIds: [sourceId], detectorTypes: ['PII'] })
        .expect(201);
      const secrets = await api()
        .post('/inquiries')
        .send({
          title: 'Secrets',
          sourceIds: [sourceId],
          detectorTypes: ['SECRETS'],
        })
        .expect(201);
      const caseId = await seedCase({
        inquiryIds: [pii.body.id, secrets.body.id],
      });
      const a = await seedAsset('scoped.txt', [
        { type: 'TOKEN', value: 'abc', detector: DetectorType.PII },
        { type: 'TOKEN', value: 'xyz', detector: DetectorType.SECRETS },
      ]);
      await attach(caseId, a.findingIds);

      const options = await api()
        .get(
          `/cases/${caseId}/finding-filters/options?inquiryId=${pii.body.id}`,
        )
        .expect(200);
      expect(
        options.body.types.find(
          (t: { findingType: string }) => t.findingType === 'TOKEN',
        ),
      ).toMatchObject({ inCase: 1 });

      const added = await api()
        .post(`/cases/${caseId}/finding-filters`)
        .send({
          inquiryId: pii.body.id,
          rules: [{ kind: 'FINDING_TYPE', pattern: 'TOKEN' }],
        })
        .expect(200);
      expect(added.body.detached).toBe(1);
      expect(added.body.filters[0]).toMatchObject({
        inquiryId: pii.body.id,
        inquiryTitle: 'PII',
      });
      expect(await citedFindingIds(caseId)).toEqual([a.findingIds[1]]);

      // Unlinking the watch drops its own filters, and says so.
      await api()
        .delete(`/cases/${caseId}/inquiries/${pii.body.id}`)
        .expect(200);
      const left = await api()
        .get(`/cases/${caseId}/finding-filters`)
        .expect(200);
      expect(left.body).toEqual([]);
      expect(
        (await timeline(caseId)).find(
          (e) => e.activityType === 'INQUIRY_UNLINKED',
        )?.payload,
      ).toMatchObject({ filtersDropped: 1 });
    });

    it('filter values by regular expression, and refuse one that does not compile', async () => {
      const caseId = await seedCase();
      const a = await seedAsset('values.txt', [
        { type: 'IP_ADDRESS', value: '10.1.2.3' },
        { type: 'IP_ADDRESS', value: '8.8.8.8' },
      ]);
      await attach(caseId, a.findingIds);

      const preview = await api()
        .post(`/cases/${caseId}/finding-filters/preview`)
        .send({
          rules: [
            { kind: 'VALUE_PATTERN', pattern: '^10\\.' },
            { kind: 'VALUE_PATTERN', pattern: '(' },
          ],
        })
        .expect(200);
      expect(preview.body.perRule).toEqual([1, 0]);
      expect(preview.body.problems[0]).toBe('');
      expect(preview.body.problems[1]).toMatch(/regular expression/);

      await api()
        .post(`/cases/${caseId}/finding-filters`)
        .send({ rules: [{ kind: 'VALUE_PATTERN', pattern: '(' }] })
        .expect(400);

      const added = await api()
        .post(`/cases/${caseId}/finding-filters`)
        .send({
          rules: [
            {
              kind: 'VALUE_PATTERN',
              pattern: '^10\\.',
              description: 'Private range',
            },
          ],
        })
        .expect(200);
      expect(added.body.detached).toBe(1);
      const filterId = added.body.filters[0].id as string;

      // A wider pattern takes out what it now matches too.
      const updated = await api()
        .patch(`/cases/${caseId}/finding-filters/${filterId}`)
        .send({ pattern: '^(10|8)\\.' })
        .expect(200);
      expect(updated.body.detached).toBe(1);
      expect(await citedFindingIds(caseId)).toEqual([]);
      expect(
        (await timeline(caseId)).find(
          (e) => e.activityType === 'FINDING_FILTER_UPDATED',
        )?.payload,
      ).toMatchObject({ before: { pattern: '^10\\.' } });

      await api()
        .delete(`/cases/${caseId}/finding-filters/${filterId}`)
        .expect(200);
      expect(
        (await timeline(caseId)).some(
          (e) => e.activityType === 'FINDING_FILTER_REMOVED',
        ),
      ).toBe(true);
    });
  });

  describe('escalation rules', () => {
    it('mark what the case holds, count it on the case, and say so', async () => {
      const caseId = await seedCase();
      const a = await seedAsset('escalate.txt', [
        { type: 'IBAN', value: 'AT61 1904 3002 3457 3201' },
        { type: 'PERSON', value: 'Ann' },
      ]);
      await attach(caseId, a.findingIds);

      const preview = await api()
        .post(`/cases/${caseId}/finding-filters/preview`)
        .send({
          action: 'ESCALATE',
          rules: [{ kind: 'FINDING_TYPE', pattern: 'IBAN' }],
        })
        .expect(200);
      expect(preview.body.matched).toBe(1);

      const added = await api()
        .post(`/cases/${caseId}/finding-filters`)
        .set('X-Actor-Name', encodeURIComponent(actor))
        .send({
          action: 'ESCALATE',
          rules: [
            {
              kind: 'FINDING_TYPE',
              pattern: 'IBAN',
              description: 'Money trail',
            },
          ],
        })
        .expect(200);
      expect(added.body).toMatchObject({ escalated: 1, detached: 0 });
      expect(added.body.filters[0]).toMatchObject({ action: 'ESCALATE' });
      // An escalation is not a filter: nothing left the case.
      expect(await citedFindingIds(caseId)).toEqual([...a.findingIds].sort());

      const marked = await prisma.caseFinding.findFirstOrThrow({
        where: { caseId, findingId: a.findingIds[0] },
      });
      expect(marked.escalatedAt).not.toBeNull();
      expect(marked.escalationLabel).toBe('type IBAN — Money trail');

      const found = await api().get(`/cases/${caseId}`).expect(200);
      expect(found.body.escalatedCount).toBe(1);
      expect(found.body.lastEscalatedAt).not.toBeNull();
      const listed = await api().get('/cases?escalated=true').expect(200);
      expect(listed.body.items.map((c: { id: string }) => c.id)).toContain(
        caseId,
      );

      const events = await timeline(caseId);
      expect(
        events.find((e) => e.activityType === 'FINDING_FILTER_ADDED')?.payload,
      ).toMatchObject({ action: 'ESCALATE' });
      expect(
        events.find((e) => e.activityType === 'FINDINGS_ESCALATED'),
      ).toMatchObject({
        actor,
        payload: { trigger: 'RULE_ADDED', count: 1 },
      });

      // Clearing takes the mark off; the finding stays.
      const cleared = await api()
        .post(`/cases/${caseId}/escalations/clear`)
        .send({})
        .expect(200);
      expect(cleared.body.cleared).toBe(1);
      expect((await api().get(`/cases/${caseId}`)).body.escalatedCount).toBe(0);
      expect(
        (await timeline(caseId)).some(
          (e) => e.activityType === 'ESCALATION_CLEARED',
        ),
      ).toBe(true);
    });

    it('mark a finding attached by hand under a case-wide rule', async () => {
      const caseId = await seedCase();
      await api()
        .post(`/cases/${caseId}/finding-filters`)
        .send({
          action: 'ESCALATE',
          rules: [{ kind: 'VALUE_PATTERN', pattern: '^evil' }],
        })
        .expect(200);
      const a = await seedAsset('hand.txt', [
        { type: 'URL', value: 'evil.example.com' },
        { type: 'URL', value: 'good.example.com' },
      ]);
      await attach(caseId, a.findingIds);
      const rows = await prisma.caseFinding.findMany({
        where: { caseId },
        select: { findingId: true, escalatedAt: true },
      });
      expect(rows.filter((r) => r.escalatedAt).map((r) => r.findingId)).toEqual(
        [a.findingIds[0]],
      );
      expect(
        (await timeline(caseId)).find(
          (e) => e.activityType === 'FINDINGS_ESCALATED',
        )?.payload,
      ).toMatchObject({ trigger: 'ATTACHED', count: 1 });
    });

    it('bring escalating answers in with auto-add off, notify once, and fold the entries', async () => {
      const inquiry = await api()
        .post('/inquiries')
        .send({
          title: 'Quiet watch',
          sourceIds: [sourceId],
          detectorTypes: ['PII'],
        })
        .expect(201);
      const caseId = await seedCase({ inquiryIds: [inquiry.body.id] });
      await api()
        .post(`/cases/${caseId}/finding-filters`)
        .send({
          action: 'ESCALATE',
          inquiryId: inquiry.body.id,
          rules: [{ kind: 'FINDING_TYPE', pattern: 'PASSPORT' }],
        })
        .expect(200);
      const first = await seedAsset('run-1.txt', [
        { type: 'PASSPORT', value: 'P1234567' },
        { type: 'PERSON', value: 'Ann' },
      ]);
      const second = await seedAsset('run-2.txt', [
        { type: 'PASSPORT', value: 'P7654321' },
      ]);
      // The instance the matching worker gets (the AppModule's, with
      // notifications), not whichever module's CasesService resolves first.
      const cases = ctx.get<CasePullPort>(CASE_PULL);
      const pull = (findingIds: string[]) =>
        cases.pullFromInquiry(
          caseId,
          { inquiryId: inquiry.body.id, findingIds },
          AUTO_PULL_ACTOR,
          { sourceId, runnerId, onlyEscalating: true },
        );
      const res = await pull(first.findingIds);
      expect(res.pulled).toBe(1);
      // Only the passport came in: auto-add is off, the person did not escalate.
      expect(await citedFindingIds(caseId)).toEqual([first.findingIds[0]]);
      await pull(second.findingIds);

      const events = await timeline(caseId);
      // No "pulled" entry: the escalation entry says why they came in.
      expect(events.some((e) => e.activityType === 'INQUIRY_PULLED')).toBe(
        false,
      );
      const escalated = events.filter(
        (e) => e.activityType === 'FINDINGS_ESCALATED',
      );
      expect(escalated).toHaveLength(1);
      expect(escalated[0]).toMatchObject({
        actor: AUTO_PULL_ACTOR,
        payload: {
          trigger: 'ARRIVAL',
          added: true,
          count: 2,
          passes: 2,
          inquiryTitle: 'Quiet watch',
        },
      });
      const notifications = await prisma.notification.findMany({
        where: {
          event: 'case.findings_escalated',
          metadata: { path: ['caseId'], equals: caseId },
        },
      });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].actionUrl).toBe(`/investigations/${caseId}`);
    });

    it('lose to a filter: a filtered finding never comes in', async () => {
      const inquiry = await api()
        .post('/inquiries')
        .send({ title: 'Both', sourceIds: [sourceId], detectorTypes: ['PII'] })
        .expect(201);
      const caseId = await seedCase({ inquiryIds: [inquiry.body.id] });
      for (const action of ['EXCLUDE', 'ESCALATE']) {
        await api()
          .post(`/cases/${caseId}/finding-filters`)
          .send({ action, rules: [{ kind: 'FINDING_TYPE', pattern: 'SSN' }] })
          .expect(200);
      }
      const a = await seedAsset('both.txt', [
        { type: 'SSN', value: '078-05-1120' },
      ]);
      const res = await ctx
        .get<CasePullPort>(CASE_PULL)
        .pullFromInquiry(
          caseId,
          { inquiryId: inquiry.body.id, findingIds: a.findingIds },
          AUTO_PULL_ACTOR,
          { sourceId, runnerId, onlyEscalating: true },
        );
      expect(res.pulled).toBe(0);
      expect(await citedFindingIds(caseId)).toEqual([]);
    });
  });
});
