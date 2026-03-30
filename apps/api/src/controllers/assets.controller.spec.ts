import { Test, TestingModule } from '@nestjs/testing';
import { SourceAssetsController } from './assets.controller';
import { AssetService } from '../asset.service';
import { SourceService } from '../source.service';
import { ValidationService } from '../validation.service';

describe('SourceAssetsController', () => {
  let controller: SourceAssetsController;

  const assetService = {
    listAssets: jest.fn(),
    bulkIngest: jest.fn(),
    finalizeIngestRun: jest.fn(),
  };
  const sourceService = {
    source: jest.fn(),
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
      { finalizeRun: false },
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
  });
});
