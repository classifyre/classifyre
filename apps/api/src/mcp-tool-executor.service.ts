import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
  ) {}

  async createSource(args: CreateSourceArgs) {
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
    return this.cliRunnerService.testConnection(id);
  }

  async createCustomDetector(args: CreateCustomDetectorArgs) {
    return this.customDetectorsService.create(args);
  }

  async trainCustomDetector(args: TrainCustomDetectorArgs) {
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
    inputText?: string;
    inputAsset?: Record<string, unknown>;
    expectedOutcome: Record<string, unknown>;
  }) {
    return this.customDetectorTests.createScenario(args.detectorId, args);
  }

  async runDetectorTests(args: {
    detectorId: string;
    triggeredBy?: string;
    scenarioIds?: string[];
  }) {
    return this.customDetectorTests.runScenarios(
      args.detectorId,
      (args.triggeredBy as any) || 'ASSISTANT',
      args.scenarioIds,
    );
  }

  async deleteDetectorTestScenario(detectorId: string, scenarioId: string) {
    await this.customDetectorTests.deleteScenario(detectorId, scenarioId);
    return { deleted: true, scenarioId };
  }

  private async prepareSourceConfig(
    type: string,
    config: JsonRecord,
  ): Promise<JsonRecord> {
    const normalized = this.validationService.validate(type, config);
    const normalizedRecord =
      normalized && typeof normalized === 'object' ? normalized : {};
    await this.customDetectorsService.sanitizeSourceConfigDetectors(
      normalizedRecord,
    );

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
