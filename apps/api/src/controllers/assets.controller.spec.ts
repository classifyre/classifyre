import { Test, TestingModule } from '@nestjs/testing';
import { SourceAssetsController } from './assets.controller';
import { AssetService } from '../asset.service';
import { SourceService } from '../source.service';
import { ValidationService } from '../validation.service';
import { ALLOW_IN_DEMO_MODE_KEY } from '../demo-mode.decorator';
import { INTERNAL_ONLY_KEY } from '../internal-only.decorator';

describe('SourceAssetsController', () => {
  let controller: SourceAssetsController;

  const assetService = {
    listAssets: jest.fn(),
    bulkIngest: jest.fn(),
    finalizeIngestRun: jest.fn(),
    recordScanCacheSavings: jest.fn(),
    recordRunSamplingCursor: jest.fn().mockResolvedValue(undefined),
    recordRelationshipOutcome: jest.fn().mockResolvedValue({
      failed: 0,
      lost: 0,
      errors: [],
    }),
  };
  const sourceService = {
    source: jest.fn(),
    updateSamplingCursor: jest.fn(),
    updateDegradedDetectors: jest.fn(),
    acknowledgeSamplingFingerprint: jest.fn().mockResolvedValue(undefined),
  };
  const validationService = {
    validateOutput: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SourceAssetsController],
      providers: [
        { provide: AssetService, useValue: assetService },
        { provide: SourceService, useValue: sourceService },
        { provide: ValidationService, useValue: validationService },
      ],
    }).compile();

    controller = module.get(SourceAssetsController);
  });

  it('passes finalizeRun through to bulk ingest service', async () => {
    sourceService.source.mockResolvedValue({
      id: 'source-1',
      type: 'WORDPRESS',
    });
    assetService.bulkIngest.mockResolvedValue({ created: 1, updated: 0 });

    await controller.bulkIngest('source-1', {
      runnerId: 'runner-1',
      assets: [{ hash: 'h1' }],
      finalizeRun: false,
    });

    expect(validationService.validateOutput).toHaveBeenCalledWith('WORDPRESS', {
      hash: 'h1',
    });
    expect(assetService.bulkIngest).toHaveBeenCalledWith(
      'source-1',
      'runner-1',
      [{ hash: 'h1' }],
      { finalizeRun: false, isFullScan: false },
    );
  });

  it('finalizes ingest run via finalize endpoint', async () => {
    sourceService.source.mockResolvedValue({
      id: 'source-1',
      type: 'WORDPRESS',
    });
    assetService.finalizeIngestRun.mockResolvedValue({ deleted: 2 });

    await controller.finalizeIngest('source-1', {
      runnerId: 'runner-1',
      seenHashes: ['h1'],
    });

    expect(assetService.finalizeIngestRun).toHaveBeenCalledWith(
      'source-1',
      'runner-1',
      ['h1'],
      false,
      false,
    );
    expect(sourceService.updateSamplingCursor).not.toHaveBeenCalled();
  });

  it('persists the sent sampling cursor on a clean run', async () => {
    sourceService.source.mockResolvedValue({
      id: 'source-1',
      type: 'LOCAL_FOLDER',
    });
    assetService.finalizeIngestRun.mockResolvedValue({ deleted: 0 });
    const cursor = { objects: { v: 1 } };

    await controller.finalizeIngest('source-1', {
      runnerId: 'runner-1',
      seenHashes: ['h1'],
      samplingCursor: cursor,
    });

    expect(sourceService.updateSamplingCursor).toHaveBeenCalledWith(
      'source-1',
      cursor,
    );
  });

  it('persists an advancing cursor across degraded runs and remembers them', async () => {
    // Dropping the cursor on every degraded run would pin the sweep to its
    // first window for as long as the detector stays refused. The sweep keeps
    // advancing instead; the degraded keys are remembered for later.
    for (const [runnerId, cursor] of [
      ['runner-1', { objects: { v: 1 } }],
      ['runner-2', { objects: { v: 2 } }],
    ] as const) {
      sourceService.source.mockResolvedValue({
        id: 'source-1',
        type: 'LOCAL_FOLDER',
        degradedDetectors: runnerId === 'runner-1' ? null : ['CUSTOM::ticket_triage'],
      });
      assetService.finalizeIngestRun.mockResolvedValue({ deleted: 0 });

      await controller.finalizeIngest('source-1', {
        runnerId,
        seenHashes: ['h1'],
        samplingCursor: cursor,
        detectorsDegraded: ['CUSTOM::ticket_triage'],
      });

      expect(sourceService.updateSamplingCursor).toHaveBeenCalledWith(
        'source-1',
        cursor,
      );
    }
    expect(assetService.recordRunSamplingCursor).toHaveBeenCalledTimes(2);
    expect(sourceService.updateDegradedDetectors).toHaveBeenLastCalledWith(
      'source-1',
      ['CUSTOM::ticket_triage'],
    );
  });

  it('unions newly degraded detectors with the remembered ones', async () => {
    sourceService.source.mockResolvedValue({
      id: 'source-1',
      type: 'LOCAL_FOLDER',
      degradedDetectors: ['CUSTOM::old_detector'],
    });
    assetService.finalizeIngestRun.mockResolvedValue({ deleted: 0 });

    await controller.finalizeIngest('source-1', {
      runnerId: 'runner-2',
      seenHashes: ['h1'],
      samplingCursor: { objects: { v: 2 } },
      detectorsDegraded: ['CUSTOM::ticket_triage'],
    });

    expect(sourceService.updateSamplingCursor).toHaveBeenCalledWith(
      'source-1',
      { objects: { v: 2 } },
    );
    expect(sourceService.updateDegradedDetectors).toHaveBeenCalledWith(
      'source-1',
      ['CUSTOM::old_detector', 'CUSTOM::ticket_triage'],
    );
  });

  it('drops the cursor once on the first clean run after degraded ones', async () => {
    sourceService.source.mockResolvedValue({
      id: 'source-1',
      type: 'LOCAL_FOLDER',
      degradedDetectors: ['CUSTOM::ticket_triage'],
    });
    assetService.finalizeIngestRun.mockResolvedValue({ deleted: 0 });

    await controller.finalizeIngest('source-1', {
      runnerId: 'runner-3',
      seenHashes: ['h1'],
      samplingCursor: { objects: { v: 3 } },
    });

    // The sent cursor is ignored: this is the one run that restarts the
    // sweep so the skipped assets are retried.
    expect(sourceService.updateSamplingCursor).toHaveBeenCalledTimes(1);
    expect(sourceService.updateSamplingCursor).toHaveBeenCalledWith(
      'source-1',
      undefined,
    );
    expect(sourceService.updateDegradedDetectors).toHaveBeenCalledWith(
      'source-1',
      null,
    );
    expect(assetService.recordRunSamplingCursor).not.toHaveBeenCalled();
  });

  it('leaves a notebook source cursor alone across the degraded episode', async () => {
    // A CUSTOM source keeps its own resume state in the cursor; only it can
    // decide what a degraded run means for its position.
    sourceService.source.mockResolvedValue({
      id: 'source-1',
      type: 'CUSTOM',
      degradedDetectors: ['CUSTOM::ticket_triage'],
    });
    assetService.finalizeIngestRun.mockResolvedValue({ deleted: 0 });

    await controller.finalizeIngest('source-1', {
      runnerId: 'runner-1',
      seenHashes: ['h1'],
      samplingCursor: { notebook: { offset: 3 } },
      detectorsDegraded: ['CUSTOM::ticket_triage'],
    });
    expect(sourceService.updateSamplingCursor).toHaveBeenCalledWith(
      'source-1',
      { notebook: { offset: 3 } },
    );

    await controller.finalizeIngest('source-1', {
      runnerId: 'runner-2',
      seenHashes: ['h1'],
      samplingCursor: { notebook: { offset: 4 } },
    });
    expect(sourceService.updateSamplingCursor).toHaveBeenLastCalledWith(
      'source-1',
      { notebook: { offset: 4 } },
    );
    expect(sourceService.updateDegradedDetectors).toHaveBeenLastCalledWith(
      'source-1',
      null,
    );
  });

  it('treats ALL sampling as a full scan (enables deletion)', async () => {
    sourceService.source.mockResolvedValue({
      id: 'source-1',
      type: 'POSTGRESQL',
      config: { sampling: { strategy: 'ALL' } },
    });
    assetService.finalizeIngestRun.mockResolvedValue({ deleted: 3 });

    await controller.finalizeIngest('source-1', {
      runnerId: 'runner-1',
      seenHashes: ['h1'],
    });

    expect(assetService.finalizeIngestRun).toHaveBeenCalledWith(
      'source-1',
      'runner-1',
      ['h1'],
      true,
      true,
    );
  });

  it('a cohort run under ALL retires no absent asset, but its scanned assets were read whole', async () => {
    sourceService.source.mockResolvedValue({
      id: 'source-1',
      type: 'CUSTOM',
      config: { sampling: { strategy: 'ALL' } },
    });
    assetService.finalizeIngestRun.mockResolvedValue({ deleted: 0 });

    await controller.finalizeIngest('source-1', {
      runnerId: 'runner-1',
      seenHashes: ['h1'],
      partialCoverage: true,
    });

    // Not a full scan (absence proves nothing), yet findings a completed
    // detector no longer reports on the assets it did scan may be resolved.
    expect(assetService.finalizeIngestRun).toHaveBeenCalledWith(
      'source-1',
      'runner-1',
      ['h1'],
      false,
      true,
    );
  });

  it('records the settings a finished run was started under', async () => {
    sourceService.source.mockResolvedValue({
      id: 'source-1',
      type: 'CUSTOM',
      config: { sampling: { strategy: 'ALL' } },
    });
    assetService.finalizeIngestRun.mockResolvedValue({ deleted: 0 });

    await controller.finalizeIngest('source-1', {
      runnerId: 'runner-1',
      seenHashes: [],
      samplingFingerprint: 'abc123',
    });
    expect(sourceService.acknowledgeSamplingFingerprint).toHaveBeenCalledWith(
      'source-1',
      'abc123',
    );

    sourceService.acknowledgeSamplingFingerprint.mockClear();
    await controller.finalizeIngest('source-1', {
      runnerId: 'runner-1',
      seenHashes: [],
    });
    expect(sourceService.acknowledgeSamplingFingerprint).not.toHaveBeenCalled();
  });

  it('persists the AUTOMATIC sampling cursor and is not a full scan', async () => {
    sourceService.source.mockResolvedValue({
      id: 'source-1',
      type: 'POSTGRESQL',
      config: { sampling: { strategy: 'AUTOMATIC' } },
    });
    assetService.finalizeIngestRun.mockResolvedValue({ deleted: 0 });

    const cursor = { tables: { 'db_#_users': { pk: [42] } } };
    await controller.finalizeIngest('source-1', {
      runnerId: 'runner-1',
      seenHashes: ['h1'],
      samplingCursor: cursor,
    });

    expect(sourceService.updateSamplingCursor).toHaveBeenCalledWith(
      'source-1',
      cursor,
    );
    // Snapshotted on the run too. The source row is overwritten in place, so
    // without a per-run copy the scheduler cannot tell a sweep that advanced
    // from one going over ground it already covered — and reading that wrong
    // stopped a live sweep at 9% of its corpus.
    expect(assetService.recordRunSamplingCursor).toHaveBeenCalledWith(
      'runner-1',
      cursor,
    );
    // AUTOMATIC ingests one slice per run → absence never implies deletion.
    expect(assetService.finalizeIngestRun).toHaveBeenCalledWith(
      'source-1',
      'runner-1',
      ['h1'],
      false,
      false,
    );
  });

  it('reserves ingestion callbacks for internal callers', () => {
    // Scheduled and autopilot-triggered scans still write back on a demo
    // instance, but only from a CLI job the API launched: the internal key
    // both satisfies this guard and exempts the call from DemoModeGuard.
    const bulkIngest = Object.getOwnPropertyDescriptor(
      SourceAssetsController.prototype,
      'bulkIngest',
    )?.value;
    const finalizeIngest = Object.getOwnPropertyDescriptor(
      SourceAssetsController.prototype,
      'finalizeIngest',
    )?.value;

    expect(Reflect.getMetadata(INTERNAL_ONLY_KEY, bulkIngest)).toBe(true);
    expect(Reflect.getMetadata(INTERNAL_ONLY_KEY, finalizeIngest)).toBe(true);

    expect(
      Reflect.getMetadata(ALLOW_IN_DEMO_MODE_KEY, bulkIngest),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(ALLOW_IN_DEMO_MODE_KEY, finalizeIngest),
    ).toBeUndefined();
  });
});
