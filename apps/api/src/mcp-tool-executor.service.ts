import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DemoModeService } from './demo-mode.service';
import { DemoModeException } from './demo-mode.exception';
import { CustomDetectorMethod } from '@prisma/client';
import { CliRunnerService } from './cli-runner/cli-runner.service';
import { CustomDetectorsService } from './custom-detectors.service';
import { CustomDetectorTestsService } from './custom-detector-tests.service';
import { SchedulerService } from './scheduler/scheduler.service';
import { GlossaryService } from './semantic-layer/glossary.service';
import { MetricsService } from './semantic-layer/metrics.service';
import { SourceService } from './source.service';
import { ValidationService } from './validation.service';

type JsonRecord = Record<string, unknown>;

export type CreateSourceArgs = {
  type: string;
  name?: string;
  config: JsonRecord;
  scheduleEnabled?: boolean;
  scheduleCron?: string;
  scheduleTimezone?: string;
};

export type UpdateSourceArgs = {
  id: string;
  type?: string;
  name?: string;
  config?: JsonRecord;
  scheduleEnabled?: boolean;
  scheduleCron?: string;
  scheduleTimezone?: string;
};

export type CreateCustomDetectorArgs = {
  key?: string;
  name: string;
  description?: string;
  method: CustomDetectorMethod;
  config?: JsonRecord;
  isActive?: boolean;
};

export type TrainCustomDetectorArgs = {
  id: string;
  sourceId?: string;
};

@Injectable()
export class McpToolExecutorService {
  constructor(
    private readonly sourceService: SourceService,
    private readonly validationService: ValidationService,
    private readonly customDetectorsService: CustomDetectorsService,
    private readonly customDetectorTests: CustomDetectorTestsService,
    private readonly cliRunnerService: CliRunnerService,
    private readonly schedulerService: SchedulerService,
    private readonly glossaryService: GlossaryService,
    private readonly metricsService: MetricsService,
    private readonly demoMode: DemoModeService,
  ) {}

  private assertNotDemoMode(): void {
    if (this.demoMode.isDemoMode) {
      throw new DemoModeException();
    }
  }

  async createSource(args: CreateSourceArgs) {
    this.assertNotDemoMode();
    const normalizedConfig = await this.prepareSourceConfig(
      args.type,
      args.config,
    );
    const source = await this.sourceService.createFromConfig({
      type: args.type,
      name: args.name,
      config: normalizedConfig,
    });

    if (args.scheduleEnabled === true && args.scheduleCron) {
      this.assertValidCronExpression(args.scheduleCron);
      await this.schedulerService.upsertSchedule(
        source.id,
        args.scheduleCron,
        args.scheduleTimezone ?? 'UTC',
      );
    }

    return this.requireSource(source.id);
  }

  async updateSource(args: UpdateSourceArgs) {
    this.assertNotDemoMode();
    const source = await this.requireSource(args.id);
    let normalizedConfig: JsonRecord | undefined;

    if (args.config) {
      normalizedConfig = await this.prepareSourceConfig(
        args.type ?? String(source.type),
        args.config,
      );
    }

    if (args.scheduleEnabled === true && args.scheduleCron) {
      this.assertValidCronExpression(args.scheduleCron);
    }

    const updated = await this.sourceService.updateFromConfig(args.id, {
      type: args.type,
      name: args.name,
      config: normalizedConfig,
    });

    if (args.scheduleEnabled !== undefined) {
      if (args.scheduleEnabled === true && args.scheduleCron) {
        await this.schedulerService.upsertSchedule(
          args.id,
          args.scheduleCron,
          args.scheduleTimezone ?? 'UTC',
        );
      } else if (args.scheduleEnabled === false) {
        await this.schedulerService.removeSchedule(args.id);
      }

      return this.requireSource(args.id);
    }

    return updated;
  }

  async testSourceConnection(id: string) {
    this.assertNotDemoMode();
    return this.cliRunnerService.testConnection(id);
  }

  async createCustomDetector(args: CreateCustomDetectorArgs) {
    this.assertNotDemoMode();
    return this.customDetectorsService.create({
      ...args,
      config: args.config ?? {},
    });
  }

  async trainCustomDetector(args: TrainCustomDetectorArgs) {
    this.assertNotDemoMode();
    return this.customDetectorsService.train(args.id, {
      sourceId: args.sourceId,
    });
  }

  async listDetectorTestScenarios(detectorId: string) {
    return this.customDetectorTests.listScenarios(detectorId);
  }

  async createDetectorTestScenario(args: {
    detectorId: string;
    name: string;
    description?: string;
    inputText: string;
    expectedOutcome: Record<string, unknown>;
  }) {
    this.assertNotDemoMode();
    return this.customDetectorTests.createScenario(args.detectorId, args);
  }

  async runDetectorTests(args: { detectorId: string; triggeredBy?: string }) {
    this.assertNotDemoMode();
    return this.customDetectorTests.runScenarios(
      args.detectorId,
      (args.triggeredBy as any) || 'ASSISTANT',
    );
  }

  async createGlossaryTerm(args: {
    displayName: string;
    description?: string;
    category?: string;
    filterMapping: Record<string, unknown>;
    color?: string;
    icon?: string;
  }) {
    this.assertNotDemoMode();
    return this.glossaryService.create({
      displayName: args.displayName,
      description: args.description,
      category: args.category,
      filterMapping: args.filterMapping as any,
      color: args.color,
      icon: args.icon,
    });
  }

  async createMetricDefinition(args: {
    displayName: string;
    description?: string;
    type: 'SIMPLE' | 'RATIO' | 'DERIVED' | 'TREND';
    definition: Record<string, any>;
    allowedDimensions?: string[];
    glossaryTermId?: string;
    format?: string;
    unit?: string;
    owner?: string;
  }) {
    this.assertNotDemoMode();
    return this.metricsService.create({
      displayName: args.displayName,
      description: args.description,
      type: args.type,
      definition: args.definition,
      allowedDimensions: args.allowedDimensions,
      glossaryTermId: args.glossaryTermId,
      format: args.format,
      unit: args.unit,
      owner: args.owner,
    });
  }

  async certifyMetric(id: string, certifiedBy: string) {
    this.assertNotDemoMode();
    return this.metricsService.certify(id, certifiedBy);
  }

  async updateGlossaryTerm(
    id: string,
    args: {
      displayName?: string;
      description?: string;
      category?: string;
      filterMapping?: Record<string, unknown>;
      color?: string;
      icon?: string;
      isActive?: boolean;
    },
  ) {
    this.assertNotDemoMode();
    return this.glossaryService.update(id, args as any);
  }

  async deleteGlossaryTerm(id: string) {
    this.assertNotDemoMode();
    return this.glossaryService.delete(id);
  }

  async updateMetricDefinition(
    id: string,
    args: {
      displayName?: string;
      description?: string;
      definition?: Record<string, any>;
      allowedDimensions?: string[];
      glossaryTermId?: string;
      format?: string;
      unit?: string;
      owner?: string;
      isActive?: boolean;
    },
  ) {
    this.assertNotDemoMode();
    return this.metricsService.update(id, args as any);
  }

  async deleteMetricDefinition(id: string) {
    this.assertNotDemoMode();
    return this.metricsService.delete(id);
  }

  private async prepareSourceConfig(
    type: string,
    config: JsonRecord,
  ): Promise<JsonRecord> {
    const normalized = this.validationService.validate(type, config);
    const normalizedRecord =
      normalized && typeof normalized === 'object' ? normalized : {};
    const customDetectors =
      await this.customDetectorsService.assertActiveDetectorIds(
        normalizedRecord.custom_detectors,
      );

    if (customDetectors.length > 0) {
      normalizedRecord.custom_detectors = customDetectors;
    }

    return normalizedRecord;
  }

  private async requireSource(id: string) {
    const source = await this.sourceService.source({ id });
    if (!source) {
      throw new NotFoundException(`Source with ID ${id} not found`);
    }

    return source;
  }

  private assertValidCronExpression(cron: string): void {
    const cronPartPattern = /^[-\d*/,]+$/;
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new BadRequestException(
        'Invalid cron expression. Expected 5 fields.',
      );
    }

    for (const part of parts) {
      if (!cronPartPattern.test(part)) {
        throw new BadRequestException('Invalid cron expression.');
      }
    }
  }
}
