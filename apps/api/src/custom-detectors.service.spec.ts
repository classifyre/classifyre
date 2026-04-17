import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  CustomDetectorMethod,
  CustomDetectorTrainingStatus,
  FindingStatus,
} from '@prisma/client';
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
      source: {
        findUnique: jest.fn(),
      },
    };

    const service = new CustomDetectorsService(prisma as any);
    prisma.$queryRaw.mockResolvedValue([]);

    return { service, prisma };
  }

  it('creates a custom detector with canonicalized custom config', async () => {
    const { service, prisma } = createService();

    prisma.customDetector.create.mockResolvedValue({
      id: 'det-1',
      key: 'cust_legal_risk',
      name: 'Legal Risk Detector',
      description: 'Detect risk terms',
      method: CustomDetectorMethod.CLASSIFIER,
      isActive: true,
      version: 1,
      config: {
        custom_detector_key: 'cust_legal_risk',
        name: 'Legal Risk Detector',
        method: 'CLASSIFIER',
      },
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
      method: CustomDetectorMethod.CLASSIFIER,
      config: {
        classifier: {
          labels: [{ id: 'risk', name: 'Risk' }],
        },
      },
    });

    expect(prisma.customDetector.create).toHaveBeenCalled();
    expect(result.key).toBe('cust_legal_risk');
    expect(result.method).toBe(CustomDetectorMethod.CLASSIFIER);
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
        method: CustomDetectorMethod.RULESET,
        config: {
          custom_detector_key: 'cust_duplicate',
          name: 'Duplicate key detector',
          method: 'RULESET',
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('builds runtime custom detector payloads in requested order', async () => {
    const { service, prisma } = createService();

    prisma.customDetector.findMany.mockResolvedValue([
      {
        id: 'det-2',
        key: 'cust_second',
        name: 'Second',
        description: null,
        method: CustomDetectorMethod.RULESET,
        isActive: true,
        version: 1,
        config: {
          custom_detector_key: 'cust_second',
          name: 'Second',
          method: 'RULESET',
        },
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
        method: CustomDetectorMethod.ENTITY,
        isActive: true,
        version: 1,
        config: {
          custom_detector_key: 'cust_first',
          name: 'First',
          method: 'ENTITY',
        },
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
        method: CustomDetectorMethod.RULESET,
        isActive: true,
        version: 1,
        config: {
          custom_detector_key: 'cust_usage_1',
          name: 'Usage Detector',
          method: 'RULESET',
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

  it('trains classifier with SETFIT strategy when label threshold is met', async () => {
    const { service, prisma } = createService();

    prisma.customDetector.findUnique.mockResolvedValue({
      id: 'det-1',
      key: 'cust_classifier',
      name: 'Classifier',
      description: null,
      method: CustomDetectorMethod.CLASSIFIER,
      isActive: true,
      version: 1,
      config: {
        custom_detector_key: 'cust_classifier',
        name: 'Classifier',
        method: 'CLASSIFIER',
        classifier: {
          min_examples_per_label: 2,
          labels: [
            { id: 'risk', name: 'Risk' },
            { id: 'safe', name: 'Safe' },
          ],
          training_examples: [
            { text: 'a', label: 'risk', accepted: true },
            { text: 'b', label: 'safe', accepted: true },
          ],
        },
      },
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

    prisma.customDetectorFeedback.findMany.mockResolvedValue([
      {
        id: 'fb-1',
        customDetectorId: 'det-1',
        customDetectorKey: 'cust_classifier',
        sourceId: 'src-1',
        status: FindingStatus.RESOLVED,
        label: 'risk',
        findingType: 'class:risk',
      },
      {
        id: 'fb-2',
        customDetectorId: 'det-1',
        customDetectorKey: 'cust_classifier',
        sourceId: 'src-1',
        status: FindingStatus.RESOLVED,
        label: 'safe',
        findingType: 'class:safe',
      },
    ]);

    prisma.customDetectorTrainingRun.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
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

    const run = await service.train('det-1', {});

    expect(run.status).toBe(CustomDetectorTrainingStatus.SUCCEEDED);
    expect(run.strategy).toBe('SETFIT');
    expect(prisma.customDetector.update).toHaveBeenCalled();
  });

  it('normalizes plain-string classifier labels to {id, name} objects on create', async () => {
    const { service, prisma } = createService();

    let capturedConfig: Record<string, unknown> | null = null;
    prisma.customDetector.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        capturedConfig = data.config as Record<string, unknown>;
        return Promise.resolve({
          id: 'det-norm',
          key: 'food_detector',
          name: 'Food Detector',
          description: null,
          method: CustomDetectorMethod.CLASSIFIER,
          isActive: true,
          version: 1,
          config: data.config,
          lastTrainedAt: null,
          lastTrainingSummary: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          trainingRuns: [],
          _count: { findings: 0 },
        });
      },
    );

    await service.create({
      name: 'Food Detector',
      key: 'food_detector',
      method: CustomDetectorMethod.CLASSIFIER,
      config: {
        classifier: {
          // Plain string labels — legacy format that the CLI cannot parse
          labels: ['food discussion', 'not food discussion'],
          training_examples: [
            {
              text: 'I made pasta last night.',
              label: 'food discussion',
              accepted: true,
            },
            {
              text: 'Quarterly earnings are up.',
              label: 'not food discussion',
              accepted: true,
            },
          ],
        },
      },
    });

    const classifier = capturedConfig!['classifier'] as Record<string, unknown>;
    const labels = classifier?.labels as Array<Record<string, unknown>>;
    expect(labels).toEqual([
      { id: 'food_discussion', name: 'food discussion' },
      { id: 'not_food_discussion', name: 'not food discussion' },
    ]);

    // Training example labels must be remapped to IDs
    const examples = classifier?.training_examples as Array<
      Record<string, unknown>
    >;
    expect(examples[0]?.label).toBe('food_discussion');
    expect(examples[1]?.label).toBe('not_food_discussion');
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
