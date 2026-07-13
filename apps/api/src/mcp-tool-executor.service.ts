import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DemoModeService } from './demo-mode.service';
import { DemoModeException } from './demo-mode.exception';
import { CliRunnerService } from './cli-runner/cli-runner.service';
import { CustomDetectorsService } from './custom-detectors.service';
import { CustomDetectorTestsService } from './custom-detector-tests.service';
import { SchedulerService } from './scheduler/scheduler.service';
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
  pipelineSchema: JsonRecord;
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
    private readonly demoMode: DemoModeService,
  ) {}

  /** Guard for any mutating MCP tool. Public so the factory can call it
   * directly for tools that talk to a domain service without an executor
   * passthrough method. */
  assertNotDemoMode(): void {
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
    return this.customDetectorsService.create(args);
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
