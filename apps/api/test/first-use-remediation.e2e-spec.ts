import { Test, TestingModule } from '@nestjs/testing';
import {
  AssetStatus,
  AssetType,
  DetectorType,
  FindingStatus,
  Prisma,
  RunnerAssetChangeType,
  RunnerAssetStatus,
  RunnerStatus,
  Severity,
  TextExtractionStatus,
  TriggerType,
} from '@prisma/client';
import { AssetService } from '../src/asset.service';
import { CliRunnerService } from '../src/cli-runner/cli-runner.service';
import { CustomDetectorExtractionsService } from '../src/custom-detector-extractions.service';
import { EmbeddingAnalysisService } from '../src/embedding/embedding-analysis.service';
import { EmbeddingConfigService } from '../src/embedding/embedding-config.service';
import { EmbeddingService } from '../src/embedding/embedding.service';
import { QueryEmbeddingService } from '../src/embedding/query-embedding.service';
import { MaskedConfigCryptoService } from '../src/masked-config-crypto.service';
import { PrismaService } from '../src/prisma.service';
import { computeScopeFingerprint } from '../src/utils/scope-fingerprint';

const assetPayload = (
  hash: string,
  findings: Record<string, unknown>[] = [],
  detectorOutcomes: Record<string, unknown>[] = [],
) => ({
  hash,
  checksum: `checksum-${hash}`,
  name: `${hash}.txt`,
  external_url: `file:///corpus/${hash}.txt`,
  links: [],
  asset_type: 'TXT',
  findings,
  scan_stats: {
    empty_text: false,
    text_extraction_status: 'EXTRACTED',
    detector_outcomes: detectorOutcomes,
  },
});

const findingPayload = (key: string, content: string) => ({
  detector_type: 'CUSTOM',
  custom_detector_key: key,
  finding_type: 'LEGAL_REFERENCE',
  category: 'custom',
  severity: 'medium',
  confidence: 0.9,
  matched_content: content,
  detected_at: new Date().toISOString(),
});

describe('Post-first-use store remediation (e2e)', () => {
  let moduleFixture: TestingModule;
  let prisma: PrismaService;
  let assets: AssetService;
  let runners: CliRunnerService;
  const sourceIds: string[] = [];
  const embeddingSpaceIds: string[] = [];

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      providers: [
        PrismaService,
        AssetService,
        {
          provide: CustomDetectorExtractionsService,
          useValue: { createFromIngestion: jest.fn() },
        },
        { provide: EmbeddingService, useValue: {} },
        { provide: QueryEmbeddingService, useValue: {} },
      ],
    }).compile();
    prisma = moduleFixture.get(PrismaService);
    assets = moduleFixture.get(AssetService);
    runners = new CliRunnerService(
      prisma,
      { create: jest.fn().mockResolvedValue(undefined) } as never,
      new MaskedConfigCryptoService(),
      {} as never,
      {
        finalizeRunner: jest.fn().mockResolvedValue(undefined),
        getRunnerSourceId: jest.fn().mockReturnValue(undefined),
      } as never,
    );
  });

  afterEach(async () => {
    if (sourceIds.length) {
      await prisma.source.deleteMany({ where: { id: { in: sourceIds } } });
      sourceIds.length = 0;
    }
    if (embeddingSpaceIds.length) {
      await prisma.embeddingSpace.deleteMany({
        where: { id: { in: embeddingSpaceIds } },
      });
      embeddingSpaceIds.length = 0;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleFixture.close();
  });

  async function createSource(config: Record<string, unknown>) {
    const source = await prisma.source.create({
      data: {
        name: `First-use fixture ${Date.now()}-${sourceIds.length}`,
        type: AssetType.WORDPRESS,
        config: config as Prisma.InputJsonObject,
      },
    });
    sourceIds.push(source.id);
    return source;
  }

  async function createRunner(
    sourceId: string,
    config: Record<string, unknown>,
    assetHashes: string[],
  ) {
    const runner = await prisma.runner.create({
      data: {
        sourceId,
        triggerType: TriggerType.MANUAL,
        status: RunnerStatus.RUNNING,
        startedAt: new Date(),
        scopeFingerprint: computeScopeFingerprint(AssetType.WORDPRESS, config),
      },
    });
    if (assetHashes.length) {
      await prisma.runnerAsset.createMany({
        data: assetHashes.map((assetHash) => ({
          runnerId: runner.id,
          assetHash,
          status: RunnerAssetStatus.PROCESSED,
        })),
      });
    }
    return runner;
  }

  it('retains assets and findings when an ALL scan narrows scope (G-019)', async () => {
    const wideConfig = {
      required: { url: 'https://example.test', prefix: '/corpus' },
      sampling: { strategy: 'ALL' },
    };
    const source = await createSource(wideConfig);
    const first = await createRunner(source.id, wideConfig, ['a', 'b']);
    await assets.bulkIngest(
      source.id,
      first.id,
      [
        assetPayload('a'),
        assetPayload(
          'b',
          [findingPayload('detector-a', '18 U.S.C. 1591')],
          [
            {
              detector_type: 'CUSTOM',
              custom_detector_key: 'detector-a',
              status: 'OK',
            },
          ],
        ),
      ],
      { finalizeRun: false },
    );
    await assets.finalizeIngestRun(source.id, first.id, ['a', 'b'], true);

    const narrowConfig = {
      ...wideConfig,
      required: { ...wideConfig.required, prefix: '/corpus/a' },
    };
    await prisma.source.update({
      where: { id: source.id },
      data: { config: narrowConfig },
    });
    const second = await createRunner(source.id, narrowConfig, ['a']);
    await assets.bulkIngest(source.id, second.id, [assetPayload('a')], {
      finalizeRun: false,
    });

    const result = await assets.finalizeIngestRun(
      source.id,
      second.id,
      ['a'],
      true,
    );

    expect(result).toEqual({
      deleted: 0,
      outOfScope: 1,
      resolvedForAbsence: 0,
    });
    expect(
      await prisma.asset.findUnique({
        where: { sourceId_hash: { sourceId: source.id, hash: 'b' } },
      }),
    ).toMatchObject({ status: AssetStatus.NEW });
    expect(
      await prisma.finding.findFirst({ where: { sourceId: source.id } }),
    ).toMatchObject({ status: FindingStatus.OPEN });
    expect(
      await prisma.runner.findUnique({ where: { id: second.id } }),
    ).toMatchObject({ assetsDeleted: 0, assetsOutOfScope: 1 });
  });

  it('never deletes a populated source after a zero-result ALL scan (G-019)', async () => {
    const config = {
      required: { url: 'https://example.test', prefix: '/corpus' },
      sampling: { strategy: 'ALL' },
    };
    const source = await createSource(config);
    const first = await createRunner(source.id, config, ['a']);
    await assets.bulkIngest(source.id, first.id, [assetPayload('a')], {
      finalizeRun: false,
    });
    await assets.finalizeIngestRun(source.id, first.id, ['a'], true);
    const emptyRun = await createRunner(source.id, config, []);

    expect(
      await assets.finalizeIngestRun(source.id, emptyRun.id, [], true),
    ).toEqual({ deleted: 0, outOfScope: 0, resolvedForAbsence: 0 });
    expect(
      await prisma.asset.findUnique({
        where: { sourceId_hash: { sourceId: source.id, hash: 'a' } },
      }),
    ).not.toMatchObject({ status: AssetStatus.DELETED });
  });

  it("keeps detector A's findings open when detector B is added (G-021)", async () => {
    const firstConfig = {
      required: { url: 'https://example.test' },
      sampling: { strategy: 'ALL' },
      custom_detectors: ['detector-a'],
    };
    const source = await createSource(firstConfig);
    const first = await createRunner(source.id, firstConfig, ['document']);
    await assets.bulkIngest(
      source.id,
      first.id,
      [
        assetPayload(
          'document',
          [findingPayload('detector-a', '18 U.S.C. 1591')],
          [
            {
              detector_type: 'CUSTOM',
              custom_detector_key: 'detector-a',
              status: 'OK',
            },
          ],
        ),
      ],
      { finalizeRun: false },
    );
    await assets.finalizeIngestRun(source.id, first.id, ['document'], true);

    const secondConfig = {
      ...firstConfig,
      custom_detectors: ['detector-a', 'detector-b'],
    };
    await prisma.source.update({
      where: { id: source.id },
      data: { config: secondConfig },
    });
    const second = await createRunner(source.id, secondConfig, ['document']);
    await assets.bulkIngest(
      source.id,
      second.id,
      [
        assetPayload(
          'document',
          [findingPayload('detector-b', 'semantic neighbour')],
          [
            {
              detector_type: 'CUSTOM',
              custom_detector_key: 'detector-b',
              status: 'OK',
            },
          ],
        ),
      ],
      { finalizeRun: false },
    );
    await assets.finalizeIngestRun(source.id, second.id, ['document'], true);

    const findings = await prisma.finding.findMany({
      where: { sourceId: source.id },
      orderBy: { customDetectorKey: 'asc' },
    });
    expect(findings).toHaveLength(2);
    expect(
      findings.map((finding) => [finding.customDetectorKey, finding.status]),
    ).toEqual([
      ['detector-a', FindingStatus.OPEN],
      ['detector-b', FindingStatus.OPEN],
    ]);
  });

  it('computes every terminal counter and text-coverage state from per-run facts', async () => {
    const config = { required: { url: 'https://example.test' } };
    const source = await createSource(config);
    const runner = await prisma.runner.create({
      data: {
        sourceId: source.id,
        triggerType: TriggerType.MANUAL,
        status: RunnerStatus.RUNNING,
        startedAt: new Date(Date.now() - 1000),
        findingsCreated: 2,
        assetsDeleted: 99,
      },
    });
    await prisma.source.update({
      where: { id: source.id },
      data: { currentRunnerId: runner.id, runnerStatus: RunnerStatus.RUNNING },
    });
    const coverage = [
      [
        RunnerAssetChangeType.CREATED,
        TextExtractionStatus.ENGINE_UNAVAILABLE,
        true,
      ],
      [RunnerAssetChangeType.UPDATED, TextExtractionStatus.EXTRACTED, false],
      [RunnerAssetChangeType.UNCHANGED, TextExtractionStatus.EMPTY, true],
      [RunnerAssetChangeType.DELETED, TextExtractionStatus.ZERO_FRAMES, true],
    ] as const;
    await prisma.runnerAsset.createMany({
      data: coverage.map(
        ([changeType, textExtractionStatus, emptyText], index) => ({
          runnerId: runner.id,
          assetHash: `counter-${index}`,
          status: RunnerAssetStatus.PROCESSED,
          changeType,
          textExtractionStatus,
          emptyText,
        }),
      ),
    });
    const asset = await prisma.asset.create({
      data: {
        hash: 'counter-finding-asset',
        checksum: 'counter-checksum',
        name: 'counter.txt',
        externalUrl: 'file:///counter.txt',
        links: [],
        assetType: 'TXT',
        sourceType: source.type,
        sourceId: source.id,
      },
    });
    await prisma.finding.createMany({
      data: Array.from({ length: 5 }, (_, index) => ({
        detectionIdentity: `counter-${runner.id}-${index}`,
        assetId: asset.id,
        sourceId: source.id,
        runnerId: runner.id,
        detectorType: DetectorType.PII,
        findingType: 'EMAIL_ADDRESS',
        category: 'pii',
        severity: Severity.MEDIUM,
        confidence: 0.9,
        matchedContent: `person-${index}@example.test`,
        status: index === 4 ? FindingStatus.RESOLVED : FindingStatus.OPEN,
        resolvedAt: index === 4 ? new Date() : null,
        detectedAt: new Date(),
      })),
    });

    await runners.updateRunnerStatus(runner.id, RunnerStatus.COMPLETED);

    expect(
      await prisma.runner.findUnique({ where: { id: runner.id } }),
    ).toMatchObject({
      status: RunnerStatus.WARNING,
      assetsCreated: 1,
      assetsUpdated: 1,
      assetsUnchanged: 1,
      assetsDeleted: 1,
      assetsWithoutText: 3,
      totalFindings: 5,
      findingsCreated: 2,
      findingsResolved: 1,
      findingsRetained: 2,
      textCoverage: {
        extracted: 1,
        empty: 1,
        engineUnavailable: 1,
        zeroFrames: 1,
        failed: 0,
        notApplicable: 0,
        unknown: 0,
      },
    });
  });

  it('ranks and explains evidence identically through pgvector and exact cosine', async () => {
    const source = await createSource({
      required: { url: 'https://example.test' },
    });
    const asset = await prisma.asset.create({
      data: {
        hash: 'semantic-asset',
        checksum: 'semantic-checksum',
        name: 'semantic.txt',
        externalUrl: 'file:///semantic.txt',
        links: [],
        assetType: 'TXT',
        sourceType: source.type,
        sourceId: source.id,
      },
    });
    // Six distinct hashes: a semantic-outlier signal requires at least
    // MIN_NEIGHBORHOOD comparable vectors; smaller neighbourhoods are
    // explicitly treated as unknown rather than extreme.
    const hashes = [
      '1'.repeat(64),
      '2'.repeat(64),
      '3'.repeat(64),
      '4'.repeat(64),
      '5'.repeat(64),
      '6'.repeat(64),
    ];
    const findingInputs: Array<{ hash: string; content: string }> = [
      { hash: hashes[0], content: 'Contract payment schedule and legal reference' },
      { hash: hashes[0], content: 'Contract payment schedule and legal reference' },
      { hash: hashes[1], content: 'Agreement payment timetable and statutory citation' },
      { hash: hashes[2], content: 'Unrelated aviation maintenance record' },
      { hash: hashes[3], content: 'Contract invoicing calendar and legal citation' },
      { hash: hashes[4], content: 'Payment agreement schedule with statute reference' },
      { hash: hashes[5], content: 'Contractual payment plan and code citation' },
    ];
    const createdFindings = await Promise.all(
      findingInputs.map(({ hash, content }, index) =>
        prisma.finding.create({
          data: {
            detectionIdentity: `semantic-${Date.now()}-${index}`,
            assetId: asset.id,
            sourceId: source.id,
            detectorType: DetectorType.CUSTOM,
            findingType: 'LEGAL_REFERENCE',
            category: 'custom',
            severity: Severity.MEDIUM,
            confidence: 0.9,
            matchedContent: content,
            contextBefore: 'Readable evidence context before the match',
            contextAfter: 'Readable evidence context after the match',
            embedContentHash: hash,
            detectedAt: new Date(),
          },
        }),
      ),
    );
    const analysis = new EmbeddingAnalysisService(prisma);
    // Pin the configured space to the test's own space: without this, active
    // space resolution follows EMBEDDING_* env defaults, and on a database
    // that already holds real vectors the semantic queries would search the
    // production space instead of the fixtures below.
    const revision = `revision-${Date.now()}`;
    const previousModel = process.env.EMBEDDING_MODEL;
    const previousRevision = process.env.EMBEDDING_MODEL_REVISION;
    process.env.EMBEDDING_MODEL = 'first-use-e2e-model';
    process.env.EMBEDDING_MODEL_REVISION = revision;
    const testConfig = new EmbeddingConfigService();
    process.env.EMBEDDING_MODEL = previousModel;
    process.env.EMBEDDING_MODEL_REVISION = previousRevision;
    const pgvector = new EmbeddingService(
      prisma,
      { hasVector: () => true } as never,
      analysis,
      testConfig,
    );
    const exact = new EmbeddingService(
      prisma,
      { hasVector: () => false } as never,
      analysis,
      testConfig,
    );
    const space = await pgvector.ensureSpace({
      model: 'first-use-e2e-model',
      revision,
      dim: 384,
      pooling: 'mean',
      normalized: true,
    });
    embeddingSpaceIds.push(space.id);
    const vector = (x: number, y: number) => {
      const norm = Math.sqrt(x * x + y * y);
      return [x / norm, y / norm, ...Array<number>(382).fill(0)];
    };
    const queryVector = vector(1, 0);
    await pgvector.putVectors({
      spaceId: space.id,
      items: [
        { contentHash: hashes[0], vector: queryVector },
        { contentHash: hashes[1], vector: vector(0.999, 0.04) },
        { contentHash: hashes[2], vector: vector(0, 1) },
        { contentHash: hashes[3], vector: vector(0.998, 0.06) },
        { contentHash: hashes[4], vector: vector(0.997, 0.08) },
        { contentHash: hashes[5], vector: vector(0.996, 0.09) },
      ],
    });

    const [indexedRows, exactRows] = await Promise.all([
      pgvector.semanticFindingIds(queryVector, 7),
      exact.semanticFindingIds(queryVector, 7),
    ]);
    expect(new Set(indexedRows.slice(0, 3).map((row) => row.id))).toEqual(
      new Set(exactRows.slice(0, 3).map((row) => row.id)),
    );
    expect(indexedRows.at(-1)?.id).toBe(createdFindings[3].id);
    expect(exactRows.at(-1)?.id).toBe(createdFindings[3].id);

    const duplicateAnalysis = await prisma.findingEvidenceAnalysis.findUnique({
      where: { findingId: createdFindings[0].id },
    });
    expect(duplicateAnalysis).toMatchObject({
      duplicateGroupHash: hashes[0],
    });
    expect(duplicateAnalysis?.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'duplicate_group', impact: 'down' }),
        expect.objectContaining({ code: 'near_duplicate', impact: 'down' }),
      ]),
    );
    const outlierAnalysis = await prisma.findingEvidenceAnalysis.findUnique({
      where: { findingId: createdFindings[3].id },
    });
    expect(outlierAnalysis?.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'semantic_outlier', impact: 'up' }),
      ]),
    );
    expect(await pgvector.boilerplateClusters(source.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          groupHash: hashes[0],
          findingCount: expect.any(Number),
          threshold: 0.95,
        }),
      ]),
    );
    expect(
      (await pgvector.similarFindings(createdFindings[0].id, 3)).map(
        (finding) => finding.id,
      ),
    ).toEqual(
      expect.arrayContaining([createdFindings[1].id, createdFindings[2].id]),
    );

    await prisma.findingEvidenceAnalysis.delete({
      where: { findingId: createdFindings[0].id },
    });
    expect(
      await pgvector.missing(
        {
          model: space.model,
          revision: space.revision,
          dim: space.dim,
          pooling: space.pooling,
          normalized: space.normalized,
        },
        [hashes[0]],
      ),
    ).toEqual({ spaceId: space.id, missing: [] });
    expect(
      await prisma.findingEvidenceAnalysis.findUnique({
        where: { findingId: createdFindings[0].id },
      }),
    ).not.toBeNull();
  });
});
