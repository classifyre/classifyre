import { CustomDetectorTestsService } from './custom-detector-tests.service';
import type { PrismaService } from './prisma.service';
import type { CustomDetectorsService } from './custom-detectors.service';

describe('CustomDetectorTestsService ad-hoc batches', () => {
  const detector = {
    key: 'cust_test',
    name: 'Test detector',
    pipelineSchema: { type: 'IMAGE_CLASSIFICATION', model: 'org/model' },
  };

  function createService(asset: unknown = null, uploadedFile: unknown = null) {
    const prisma = {
      asset: { findUnique: jest.fn().mockResolvedValue(asset) },
      uploadedSourceFile: {
        findFirst: jest.fn().mockResolvedValue(uploadedFile),
      },
    };
    const customDetectors = {
      injectLlmProviderRuntime: jest
        .fn()
        .mockImplementation((schema: unknown) => Promise.resolve(schema)),
    };
    const service = new CustomDetectorTestsService(
      prisma as unknown as PrismaService,
      customDetectors as unknown as CustomDetectorsService,
    );
    return { service, prisma };
  }

  it('resolves text and visual asset samples before one CLI batch', async () => {
    const { service } = createService({
      name: 'evidence.PNG',
      externalUrl: 'https://cdn.example.test/evidence.PNG?signature=redacted',
    });
    (service as any).assertPublicUrl = jest.fn().mockResolvedValue(undefined);
    const run = jest
      .fn()
      .mockResolvedValue([{ matched: true }, { matched: false }]);
    (service as any).evaluateBatchViaCli = run;

    const result = await service.evaluateSamples(detector, [
      { label: 'positive', expectedMatch: true, sampleAssetId: 'asset-1' },
      {
        label: 'counter',
        expectedMatch: false,
        sampleText: 'ordinary approval',
      },
    ]);

    expect(result).toHaveLength(2);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ pipelineSchema: detector.pipelineSchema }),
      [
        expect.objectContaining({
          label: 'positive',
          url: expect.stringContaining('evidence.PNG'),
          fileExtension: '.png',
        }),
        expect.objectContaining({
          label: 'counter',
          data: expect.any(Buffer),
          fileExtension: '.txt',
        }),
      ],
    );
  });

  it('rejects ambiguous samples before invoking the CLI', async () => {
    const { service } = createService();
    await expect(
      service.evaluateSamples(detector, [
        {
          label: 'ambiguous',
          expectedMatch: true,
          sampleText: 'text',
          sampleAssetId: 'asset-1',
        },
      ]),
    ).rejects.toThrow(/exactly one/);
  });

  it('resolves uploaded sandbox assets as real files', async () => {
    const { service } = createService(
      { name: 'private.png', externalUrl: 'sandbox://source-1/file-1' },
      { fileExtension: '.png' },
    );
    const run = jest.fn().mockResolvedValue([{ matched: true }]);
    (service as any).evaluateBatchViaCli = run;

    await service.evaluateSamples(detector, [
      { label: 'visual', expectedMatch: true, sampleAssetId: 'asset-1' },
    ]);

    expect(run).toHaveBeenCalledWith(expect.anything(), [
      expect.objectContaining({
        fileExtension: '.png',
        sandboxFile: { sourceId: 'source-1', fileId: 'file-1' },
      }),
    ]);
  });
});
