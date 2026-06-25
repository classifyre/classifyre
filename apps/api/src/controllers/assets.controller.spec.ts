import { Test, TestingModule } from '@nestjs/testing';
import { SourceAssetsController } from './assets.controller';
import { AssetService } from '../asset.service';
import { SourceService } from '../source.service';
import { ValidationService } from '../validation.service';
import { ALLOW_IN_DEMO_MODE_KEY } from '../demo-mode.decorator';

describe('SourceAssetsController', () => {
  let controller: SourceAssetsController;

  const assetService = {
    listAssets: jest.fn(),
    bulkIngest: jest.fn(),
    finalizeIngestRun: jest.fn(),
  };
  const sourceService = {
    source: jest.fn(),
    updateSamplingCursor: jest.fn(),
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
    );
    expect(sourceService.updateSamplingCursor).not.toHaveBeenCalled();
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
    );
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
    // AUTOMATIC ingests one slice per run → absence never implies deletion.
    expect(assetService.finalizeIngestRun).toHaveBeenCalledWith(
      'source-1',
      'runner-1',
      ['h1'],
      false,
    );
  });

  it('allows scheduler ingestion callbacks in demo mode', () => {
    const bulkIngest = Object.getOwnPropertyDescriptor(
      SourceAssetsController.prototype,
      'bulkIngest',
    )?.value;
    const finalizeIngest = Object.getOwnPropertyDescriptor(
      SourceAssetsController.prototype,
      'finalizeIngest',
    )?.value;

    expect(Reflect.getMetadata(ALLOW_IN_DEMO_MODE_KEY, bulkIngest)).toBe(true);
    expect(Reflect.getMetadata(ALLOW_IN_DEMO_MODE_KEY, finalizeIngest)).toBe(
      true,
    );
  });
});
