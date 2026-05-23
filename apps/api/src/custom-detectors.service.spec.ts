import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { CustomDetectorTrainingStatus } from '@prisma/client';
import { CustomDetectorsService } from './custom-detectors.service';

describe('CustomDetectorsService', () => {
  function createService() {
    const prisma = {
      $queryRaw: jest.fn(),
      customDetector: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      customDetectorFeedback: {
        findMany: jest.fn(),
      },
      customDetectorTrainingRun: {
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      customDetectorTrainingExample: {
        findMany: jest.fn(),
        createMany: jest.fn(),
        deleteMany: jest.fn(),
        findFirst: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      source: {
        findUnique: jest.fn(),
      },
    };

    const service = new CustomDetectorsService(prisma as any);
    prisma.$queryRaw.mockResolvedValue([]);

    return { service, prisma };
  }

  it('creates a custom detector with a GLINER2 pipeline schema', async () => {
    const { service, prisma } = createService();

    const pipelineSchema = {
      type: 'GLINER2',
      entities: {
        risk_term: { description: 'Legal risk term', required: false },
      },
      classification: {},
      validation: { confidence_threshold: 0.8, rules: [] },
    };

    prisma.customDetector.create.mockResolvedValue({
      id: 'det-1',
      key: 'cust_legal_risk',
      name: 'Legal Risk Detector',
      description: 'Detect risk terms',
      isActive: true,
      version: 1,
      pipelineSchema,
      lastTrainedAt: null,
      lastTrainingSummary: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      trainingRuns: [],
      _count: { findings: 0 },
    });

    const result = await service.create({
      name: 'Legal Risk Detector',
      key: 'cust_legal_risk',
      pipelineSchema,
    });

    expect(prisma.customDetector.create).toHaveBeenCalled();
    expect(result.key).toBe('cust_legal_risk');
    expect(result.pipelineSchema).toEqual(pipelineSchema);
  });

  it('rejects unknown IDs in assertActiveDetectorIds', async () => {
    const { service, prisma } = createService();

    prisma.customDetector.findMany.mockResolvedValue([{ id: 'det-1' }]);

    await expect(
      service.assertActiveDetectorIds(['det-1', 'det-2']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns conflict when detector key already exists on create', async () => {
    const { service, prisma } = createService();
    prisma.customDetector.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.create({
        name: 'Duplicate key detector',
        key: 'cust_duplicate',
        pipelineSchema: {
          type: 'REGEX',
          patterns: { x: { pattern: '\\d+' } },
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('builds runtime custom detector payloads in requested order', async () => {
    const { service, prisma } = createService();

    const regexSchema = {
      type: 'REGEX',
      patterns: { x: { pattern: '\\d+', description: 'digits' } },
    };
    const gliner2Schema = {
      type: 'GLINER2',
      entities: { entity: { description: 'any entity', required: false } },
      classification: {},
    };

    prisma.customDetector.findMany.mockResolvedValue([
      {
        id: 'det-2',
        key: 'cust_second',
        name: 'Second',
        description: null,
        isActive: true,
        version: 1,
        pipelineSchema: regexSchema,
        lastTrainedAt: null,
        lastTrainingSummary: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'det-1',
        key: 'cust_first',
        name: 'First',
        description: null,
        isActive: true,
        version: 1,
        pipelineSchema: gliner2Schema,
        lastTrainedAt: null,
        lastTrainingSummary: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const payload = await service.buildRuntimeCustomDetectors([
      'det-1',
      'det-2',
    ]);

    expect(payload.map((entry) => entry.id)).toEqual(['det-1', 'det-2']);
    expect(payload[0]?.detector.type).toBe('CUSTOM');
    expect(payload[1]?.detector.enabled).toBe(true);
  });

  it('includes usage stats in list response', async () => {
    const { service, prisma } = createService();

    prisma.customDetector.findMany.mockResolvedValue([
      {
        id: 'det-usage-1',
        key: 'cust_usage_1',
        name: 'Usage Detector',
        description: null,
        isActive: true,
        version: 1,
        pipelineSchema: {
          type: 'REGEX',
          patterns: { x: { pattern: '\\d+', description: 'digits' } },
        },
        lastTrainedAt: null,
        lastTrainingSummary: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        trainingRuns: [],
        _count: { findings: 4 },
      },
    ]);

    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          detector_id: 'det-usage-1',
          source_count: 3,
          source_names: ['Source A', 'Source B'],
        },
      ])
      .mockResolvedValueOnce([
        {
          detector_id: 'det-usage-1',
          sources_with_findings_count: 2,
        },
      ]);

    const result = await service.list({ includeInactive: true });

    expect(result).toHaveLength(1);
    expect(result[0]?.sourcesUsingCount).toBe(3);
    expect(result[0]?.sourcesWithFindingsCount).toBe(2);
    expect(result[0]?.recentSourceNames).toEqual(['Source A', 'Source B']);
  });

  it('trains GLiNER2 pipeline detector with GLINER2_PIPELINE strategy', async () => {
    const { service, prisma } = createService();

    const pipelineSchema = {
      type: 'GLINER2',
      entities: {
        order_id: { description: 'Order ID like ORD-123', required: true },
        amount: { description: 'Monetary value like 50€', required: false },
      },
      classification: {
        intent: { labels: ['refund', 'question'], multi_label: false },
      },
      validation: { confidence_threshold: 0.8, rules: [] },
    };

    prisma.customDetector.findUnique.mockResolvedValue({
      id: 'det-1',
      key: 'cust_pipeline',
      name: 'Pipeline Detector',
      description: null,
      isActive: true,
      version: 1,
      pipelineSchema,
      lastTrainedAt: null,
      lastTrainingSummary: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    prisma.customDetectorTrainingRun.create.mockResolvedValue({
      id: 'run-1',
      customDetectorId: 'det-1',
      sourceId: null,
      status: CustomDetectorTrainingStatus.RUNNING,
      strategy: null,
      startedAt: new Date(),
      completedAt: null,
      durationMs: null,
      trainedExamples: null,
      positiveExamples: null,
      negativeExamples: null,
      metrics: null,
      modelArtifactPath: null,
      configHash: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    prisma.customDetectorTrainingRun.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'run-1',
          customDetectorId: 'det-1',
          sourceId: null,
          status: data.status,
          strategy: data.strategy,
          startedAt: new Date(),
          completedAt: new Date(),
          durationMs: 12,
          trainedExamples: data.trainedExamples,
          positiveExamples: data.positiveExamples,
          negativeExamples: data.negativeExamples,
          metrics: data.metrics,
          modelArtifactPath: data.modelArtifactPath,
          configHash: data.configHash,
          errorMessage: data.errorMessage,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
    );

    prisma.customDetector.update.mockResolvedValue({});
    prisma.customDetectorTrainingExample.findMany.mockResolvedValue([]);

    const run = await service.train('det-1', {});

    // train() returns RUNNING immediately — background training is async (void)
    expect(run.status).toBe(CustomDetectorTrainingStatus.RUNNING);
    expect(prisma.customDetectorTrainingRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customDetectorId: 'det-1',
          status: CustomDetectorTrainingStatus.RUNNING,
        }),
      }),
    );
    expect(prisma.customDetectorTrainingExample.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customDetectorId: 'det-1' } }),
    );
  });

  it('stores the pipeline schema verbatim on create and reflects it in response', async () => {
    const { service, prisma } = createService();

    const pipelineSchema = {
      type: 'REGEX',
      patterns: {
        food_mention: {
          pattern: '\\b(?:pasta|pizza|sushi|burger)\\b',
          description: 'Food keyword',
        },
      },
      validation: { confidence_threshold: 0.7, rules: [] },
    };

    let capturedPipelineSchema: unknown = null;
    prisma.customDetector.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        capturedPipelineSchema = data.pipelineSchema;
        return Promise.resolve({
          id: 'det-norm',
          key: 'food_detector',
          name: 'Food Detector',
          description: null,
          isActive: true,
          version: 1,
          pipelineSchema: data.pipelineSchema,
          lastTrainedAt: null,
          lastTrainingSummary: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          trainingRuns: [],
          _count: { findings: 0 },
        });
      },
    );

    const result = await service.create({
      name: 'Food Detector',
      key: 'food_detector',
      pipelineSchema,
    });

    expect(capturedPipelineSchema).toMatchObject({ type: 'REGEX' });
    expect(result.pipelineSchema).toMatchObject({ type: 'REGEX' });
  });

  it('throws for training history lookup on missing detector', async () => {
    const { service, prisma } = createService();
    prisma.customDetector.findUnique.mockResolvedValue(null);

    await expect(service.getTrainingHistory('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('parses CSV uploads for training examples and drops duplicates', () => {
    const { service } = createService();
    const payload = Buffer.from(
      [
        'label,text',
        'risk,"Contract has a hidden liability clause"',
        'risk,"Contract has a hidden liability clause"',
        'safe,Standard clause',
        'broken-row',
      ].join('\n'),
      'utf8',
    );

    const parsed = service.parseTrainingExamplesUpload(payload, 'training.csv');

    expect(parsed.format).toBe('csv');
    expect(parsed.importedRows).toBe(2);
    expect(parsed.skippedRows).toBe(2);
    expect(parsed.examples[0]?.label).toBe('risk');
    expect(parsed.examples[1]?.label).toBe('safe');
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });

  it('parses plain text uploads in label|text format', () => {
    const { service } = createService();
    const payload = Buffer.from(
      [
        'risk|This agreement limits liability.',
        'safe|The terms are straightforward.',
      ].join('\n'),
      'utf8',
    );

    const parsed = service.parseTrainingExamplesUpload(payload, 'training.txt');

    expect(parsed.format).toBe('txt');
    expect(parsed.importedRows).toBe(2);
    expect(parsed.skippedRows).toBe(0);
    expect(parsed.examples.map((entry) => entry.label)).toEqual([
      'risk',
      'safe',
    ]);
  });

  it('parses xlsx uploads for training examples using detected columns', () => {
    const { service } = createService();
    const payload = fs.readFileSync(
      path.resolve(__dirname, '../../e2e/assets/phishing_dataset.xlsx'),
    );

    const parsed = service.parseTrainingExamplesUpload(
      payload,
      'phishing_dataset.xlsx',
    );

    expect(parsed.format).toBe('xlsx');
    expect(parsed.importedRows).toBeGreaterThan(0);
    expect(parsed.examples[0]?.label).toBe('legitimate');
    expect(parsed.examples[0]?.text).toContain('monthly report');
    expect(parsed.warnings[0]).toContain('label');
    expect(parsed.warnings[0]).toContain('email_text');
  });
});
