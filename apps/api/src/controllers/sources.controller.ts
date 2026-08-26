import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { SourceService } from '../source.service';
import { ValidationService } from '../validation.service';
import { CustomDetectorsService } from '../custom-detectors.service';
import { CliRunnerService } from '../cli-runner/cli-runner.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import {
  AutoScheduleService,
  type AutoScheduleStatus,
} from '../scheduler/auto-schedule.service';
import {
  Source as SourceModel,
  RunnerStatus,
  Prisma,
  SourceScheduleMode,
} from '@prisma/client';
import { CreateSourceDto } from '../dto/create-source.dto';
import { UpdateSourceDto } from '../dto/update-source.dto';
import {
  BulkUpdateSourcesDto,
  BulkUpdateSourcesResponseDto,
} from '../dto/bulk-update-sources.dto';
import {
  BulkRunSourcesDto,
  BulkRunSourcesResponseDto,
} from '../dto/bulk-run-sources.dto';
import { UpdateRunnerStatusDto } from '../dto/update-runner-status.dto';
import { SourceResponseDto } from '../dto/source-response.dto';
import { TestConnectionResponseDto } from '../dto/test-connection-response.dto';
import {
  SearchSourcesFiltersDto,
  SearchSourcesRequestDto,
} from '../dto/search-sources-request.dto';
import { SearchSourcesResponseDto } from '../dto/search-sources-response.dto';
import { AllowInDemoMode } from '../demo-mode.decorator';
import { ReadOnlyEndpoint } from '../db/read-only-endpoint.decorator';
import { SourceFilesService } from '../source-files.service';

@Controller('sources')
@ApiTags('Sources')
export class SourcesController {
  constructor(
    private readonly sourceService: SourceService,
    private readonly validationService: ValidationService,
    private readonly customDetectorsService: CustomDetectorsService,
    private readonly cliRunnerService: CliRunnerService,
    private readonly schedulerService: SchedulerService,
    private readonly autoScheduleService: AutoScheduleService,
    private readonly sourceFilesService: SourceFilesService,
  ) {}

  @Post('bulk-update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bulk update data sources',
    description:
      'Update scheduling and/or sampling for explicit source IDs or every source matching a filter snapshot. Omitted sections and all other source fields are preserved.',
  })
  @ApiBody({ type: BulkUpdateSourcesDto })
  @ApiResponse({
    status: 200,
    description: 'Sources updated successfully',
    type: BulkUpdateSourcesResponseDto,
  })
  async bulkUpdateSources(
    @Body() dto: BulkUpdateSourcesDto,
  ): Promise<BulkUpdateSourcesResponseDto> {
    if (!dto.schedule && !dto.sampling) {
      throw new BadRequestException(
        'Provide a schedule and/or sampling update.',
      );
    }
    if (dto.schedule?.mode === 'CRON') {
      if (!dto.schedule.cron) {
        throw new BadRequestException(
          'schedule.cron is required when schedule.mode is CRON.',
        );
      }
      this.assertValidCronExpression(dto.schedule.cron);
    }

    const sources = await this.sourceService.sources({
      where: this.buildSourceSelectionWhere(dto),
    });

    // Validate every sampling merge before the first write so an incompatible
    // source cannot leave an otherwise valid batch half-applied.
    const preparedConfigs = new Map<string, Record<string, unknown>>();
    if (dto.sampling) {
      for (const source of sources) {
        const currentConfig = this.sourceService.decryptSourceConfig(
          source.config,
        );
        const normalizedConfig = this.validationService.validate(
          String(source.type),
          { ...currentConfig, sampling: dto.sampling },
        );
        await this.customDetectorsService.sanitizeSourceConfigDetectors(
          normalizedConfig,
        );
        preparedConfigs.set(source.id, normalizedConfig);
      }
    }

    const updatedIds: string[] = [];
    for (const source of sources) {
      const normalizedConfig = preparedConfigs.get(source.id);
      if (normalizedConfig) {
        await this.sourceService.updateFromConfig(source.id, {
          config: normalizedConfig,
        });
      }
      try {
        if (dto.schedule) {
          await this.applyScheduleMode(
            source.id,
            {
              scheduleMode: dto.schedule.mode,
              scheduleCron: dto.schedule.cron,
              scheduleTimezone: dto.schedule.timezone,
            },
            'updated',
          );
        }
      } catch (error) {
        if (normalizedConfig) {
          await this.sourceService.updateSource({
            where: { id: source.id },
            data: { config: source.config as Prisma.InputJsonValue },
          });
        }
        throw error;
      }
      updatedIds.push(source.id);
    }

    return { updatedCount: updatedIds.length, ids: updatedIds };
  }

  @Post('bulk-run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start a scan for many data sources at once',
    description:
      'Queues a manual run for explicit source IDs or every source matching a filter snapshot. Runs beyond the configured concurrency limit stay PENDING until a slot frees up; sources that are already in flight are reported as skipped.',
  })
  @ApiBody({ type: BulkRunSourcesDto })
  @ApiResponse({
    status: 200,
    description: 'Runs queued',
    type: BulkRunSourcesResponseDto,
  })
  async bulkRunSources(
    @Body() dto: BulkRunSourcesDto,
  ): Promise<BulkRunSourcesResponseDto> {
    const sources = await this.sourceService.sources({
      where: this.buildSourceSelectionWhere(dto),
    });

    const ids: string[] = [];
    const skipped: BulkRunSourcesResponseDto['skipped'] = [];
    // Sequential on purpose: startRun claims the source, decrypts the config
    // and initialises log storage, and the queue is what absorbs the backlog.
    for (const source of sources) {
      try {
        await this.cliRunnerService.startRun(
          source.id,
          'MANUAL',
          undefined,
          dto.forceFullRescan === true,
        );
        ids.push(source.id);
      } catch (error) {
        skipped.push({
          id: source.id,
          name: source.name,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { startedCount: ids.length, ids, skipped };
  }

  private buildSourceSelectionWhere(dto: {
    ids?: string[];
    filters?: SearchSourcesFiltersDto;
  }): Prisma.SourceWhereInput {
    const hasIds = Boolean(dto.ids?.length);
    const hasFilters = dto.filters !== undefined;
    if (hasIds === hasFilters) {
      throw new BadRequestException(
        'Provide either source ids or filters, but not both.',
      );
    }

    return hasIds
      ? { id: { in: dto.ids } }
      : {
          ...(dto.filters?.search
            ? {
                name: {
                  contains: dto.filters.search,
                  mode: 'insensitive' as const,
                },
              }
            : {}),
          ...(dto.filters?.type?.length
            ? { type: { in: dto.filters.type } }
            : {}),
          ...(dto.filters?.status?.length
            ? { runnerStatus: { in: dto.filters.status } }
            : {}),
        };
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new data source',
    description:
      'Register a new data source for metadata ingestion (WordPress, Slack, S3-Compatible Storage, Azure Blob Storage, Google Cloud Storage, PostgreSQL, MySQL, MSSQL, Oracle, Hive, Databricks, Snowflake, MongoDB, PowerBI, Tableau, Confluence, Jira, Service Desk, Notion, Email, YouTube).',
  })
  @ApiBody({
    type: CreateSourceDto,
    examples: {
      wordpress: {
        summary: 'WordPress Source',
        value: {
          type: 'WORDPRESS',
          name: 'Production WordPress',
          config: {
            type: 'WORDPRESS',
            required: {
              url: 'https://blog.example.com',
            },
            masked: {
              username: 'admin',
              application_password: 'your-application-password',
            },
            optional: {
              content: {
                fetch_posts: true,
                fetch_pages: true,
              },
            },
            sampling: {
              strategy: 'RANDOM',
              limit: 25,
            },
          },
        },
      },
      slack: {
        summary: 'Slack Source',
        value: {
          type: 'SLACK',
          name: 'Production Slack',
          config: {
            type: 'SLACK',
            required: {
              workspace: 'acme',
            },
            masked: {
              bot_token: 'xoxb-your-bot-token',
            },
            optional: {
              channels: {
                channel_types: ['public_channel'],
              },
              ingestion: {
                limit_total_messages: 5000,
              },
            },
            sampling: {
              strategy: 'RANDOM',
              limit: 100,
            },
          },
        },
      },
      youtube: {
        summary: 'YouTube Source',
        value: {
          type: 'YOUTUBE',
          name: 'Brand channels',
          config: {
            type: 'YOUTUBE',
            required: {
              channels: ['https://www.youtube.com/@OpenAI'],
            },
            optional: {
              transcript: {
                languages: ['en'],
              },
            },
            sampling: {
              strategy: 'LATEST',
              rows_per_page: 25,
            },
          },
        },
      },
      reddit: {
        summary: 'Reddit Source',
        value: {
          type: 'REDDIT',
          name: 'Community subreddits',
          config: {
            type: 'REDDIT',
            required: {
              auth_mode: 'READ_ONLY',
              subreddits: ['datasets', 'MachineLearning'],
              user_agent: 'classifyre:com.example.scanner:v1.0 (by u/example)',
            },
            masked: {
              client_id: 'your-client-id',
              client_secret: 'your-client-secret',
            },
            optional: {
              scope: {
                include_comments: true,
                max_comments_per_post: 200,
              },
            },
            sampling: {
              strategy: 'AUTOMATIC',
              rows_per_page: 50,
            },
          },
        },
      },
      s3CompatibleStorage: {
        summary: 'S3-Compatible Storage Source',
        value: {
          type: 'S3_COMPATIBLE_STORAGE',
          name: 'S3-compatible exports',
          config: {
            type: 'S3_COMPATIBLE_STORAGE',
            required: {
              bucket: 'customer-exports',
            },
            masked: {
              aws_access_key_id: 'access-key',
              aws_secret_access_key: 'secret-key',
            },
            optional: {
              connection: {
                endpoint_url: 'https://storage.example.internal',
              },
              scope: {
                prefix: 'daily/',
                include_extensions: ['.csv', '.pdf'],
              },
            },
            sampling: {
              strategy: 'LATEST',
              limit: 100,
            },
          },
        },
      },
      azureBlobStorage: {
        summary: 'Azure Blob Storage Source',
        value: {
          type: 'AZURE_BLOB_STORAGE',
          name: 'Azure blob exports',
          config: {
            type: 'AZURE_BLOB_STORAGE',
            required: {
              account_url: 'https://acme.blob.core.windows.net',
              container: 'customer-exports',
            },
            masked: {
              azure_account_key: 'account-key',
            },
            optional: {
              scope: {
                prefix: 'daily/',
                include_extensions: ['.csv', '.pdf'],
              },
            },
            sampling: {
              strategy: 'LATEST',
              limit: 100,
            },
          },
        },
      },
      googleCloudStorage: {
        summary: 'Google Cloud Storage Source',
        value: {
          type: 'GOOGLE_CLOUD_STORAGE',
          name: 'GCS exports',
          config: {
            type: 'GOOGLE_CLOUD_STORAGE',
            required: {
              bucket: 'customer-exports',
            },
            masked: {
              gcp_credentials_json:
                '{"type":"service_account","project_id":"acme"}',
            },
            optional: {
              connection: {
                project_id: 'acme-prod',
              },
              scope: {
                prefix: 'daily/',
                include_extensions: ['.csv', '.pdf'],
              },
            },
            sampling: {
              strategy: 'LATEST',
              limit: 100,
            },
          },
        },
      },
      postgresql: {
        summary: 'PostgreSQL Source',
        value: {
          type: 'POSTGRESQL',
          name: 'Production PostgreSQL',
          config: {
            type: 'POSTGRESQL',
            required: {
              host: 'localhost',
              port: 5432,
            },
            masked: {
              username: 'postgres',
              password: 'test',
            },
            optional: {
              scope: {
                database: 'postgres',
              },
            },
            sampling: {
              strategy: 'RANDOM',
              limit: 20,
            },
          },
        },
      },
      mysql: {
        summary: 'MySQL Source',
        value: {
          type: 'MYSQL',
          name: 'Production MySQL',
          config: {
            type: 'MYSQL',
            required: {
              host: 'localhost',
              port: 3306,
            },
            masked: {
              username: 'root',
              password: 'example',
            },
            optional: {
              scope: {
                database: 'app_db',
              },
            },
            sampling: {
              strategy: 'RANDOM',
              limit: 20,
            },
          },
        },
      },
      confluence: {
        summary: 'Confluence Source',
        value: {
          type: 'CONFLUENCE',
          name: 'Engineering Confluence',
          config: {
            type: 'CONFLUENCE',
            required: {
              base_url: 'https://your-domain.atlassian.net',
              account_email: 'user@example.com',
            },
            masked: {
              api_token: 'atlassian-api-token',
            },
            optional: {
              scope: {
                spaces: {
                  keys: ['ENG'],
                  status: 'current',
                },
              },
              content: {
                include_attachments: true,
                include_footer_comments: true,
                include_inline_comments: true,
              },
            },
            sampling: {
              strategy: 'LATEST',
              limit: 50,
            },
          },
        },
      },
      jira: {
        summary: 'Jira Source',
        value: {
          type: 'JIRA',
          name: 'Platform Jira',
          config: {
            type: 'JIRA',
            required: {
              base_url: 'https://your-domain.atlassian.net',
              account_email: 'user@example.com',
            },
            masked: {
              api_token: 'atlassian-api-token',
            },
            optional: {
              scope: {
                project_keys: ['PLAT'],
                jql: 'statusCategory != Done',
              },
              content: {
                include_comments: true,
                include_attachments: true,
              },
            },
            sampling: {
              strategy: 'LATEST',
              limit: 100,
            },
          },
        },
      },
      notion: {
        summary: 'Notion Source',
        value: {
          type: 'NOTION',
          name: 'Product Notion',
          config: {
            type: 'NOTION',
            required: {},
            masked: {
              notion_token: 'ntn_your-internal-integration-token',
            },
            optional: {
              content: {
                include_comments: true,
                include_files: true,
                include_data_sources: true,
              },
            },
            sampling: {
              strategy: 'LATEST',
              rows_per_page: 50,
            },
          },
        },
      },
      servicedesk: {
        summary: 'Service Desk Source',
        value: {
          type: 'SERVICEDESK',
          name: 'Support Service Desk',
          config: {
            type: 'SERVICEDESK',
            required: {
              base_url: 'https://your-domain.atlassian.net',
              account_email: 'user@example.com',
            },
            masked: {
              api_token: 'atlassian-api-token',
            },
            optional: {
              scope: {
                service_desk_ids: [1],
                request_status: 'OPEN_REQUESTS',
              },
              content: {
                include_comments: true,
                include_attachments: true,
              },
            },
            sampling: {
              strategy: 'LATEST',
              limit: 100,
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Source successfully created',
    type: SourceResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request - validation failed',
  })
  async createSource(
    @Body() createSourceDto: CreateSourceDto,
  ): Promise<SourceModel> {
    // Validate input against schemas
    const normalizedConfig = this.validationService.validate(
      String(createSourceDto.type),
      createSourceDto.config,
    );
    const normalizedConfigRecord =
      normalizedConfig && typeof normalizedConfig === 'object'
        ? normalizedConfig
        : {};
    await this.customDetectorsService.sanitizeSourceConfigDetectors(
      normalizedConfigRecord,
    );

    // Create source in database
    const source = await this.sourceService.createFromConfig({
      ...createSourceDto,
      config: normalizedConfigRecord,
    });

    await this.applyScheduleMode(source.id, createSourceDto, 'created');

    return source;
  }

  @Get()
  @ApiOperation({
    summary: 'List all data sources',
    description: 'Retrieve a list of all registered data sources',
  })
  @ApiResponse({
    status: 200,
    description: 'List of sources',
    type: [SourceResponseDto],
  })
  async listSources(): Promise<SourceModel[]> {
    return this.sourceService.sources({});
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get source by ID',
    description: 'Retrieve detailed information about a specific data source',
  })
  @ApiParam({
    name: 'id',
    description: 'Source unique identifier',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'Source details',
    type: SourceResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Source not found' })
  async getSource(@Param('id') id: string): Promise<SourceModel> {
    const source = await this.sourceService.source({ id });
    if (!source) {
      throw new NotFoundException(`Source with ID ${id} not found`);
    }
    return source;
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update a data source',
    description:
      'Update the configuration and/or name of an existing data source',
  })
  @ApiParam({
    name: 'id',
    description: 'Source unique identifier',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiBody({
    type: UpdateSourceDto,
    examples: {
      updateConfig: {
        summary: 'Update source configuration',
        value: {
          config: {
            type: 'WORDPRESS',
            required: {
              url: 'https://updated-blog.example.com',
            },
            masked: {
              username: 'admin',
              application_password: 'updated-application-password',
            },
            optional: {
              content: {
                fetch_posts: true,
                fetch_pages: false,
              },
            },
            sampling: {
              strategy: 'RANDOM',
              limit: 25,
            },
          },
        },
      },
      updateName: {
        summary: 'Update source name only',
        value: {
          name: 'Updated Source Name',
        },
      },
      updateBoth: {
        summary: 'Update both name and config',
        value: {
          name: 'Updated Source Name',
          config: {
            type: 'WORDPRESS',
            required: {
              url: 'https://updated-blog.example.com',
            },
            masked: {
              username: 'admin',
              application_password: 'updated-application-password',
            },
            sampling: {
              strategy: 'RANDOM',
              limit: 25,
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Source successfully updated',
    type: SourceResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request - validation failed',
  })
  @ApiResponse({ status: 404, description: 'Source not found' })
  async updateSource(
    @Param('id') id: string,
    @Body() updateSourceDto: UpdateSourceDto,
  ): Promise<SourceModel> {
    const source = await this.sourceService.source({ id });
    if (!source) {
      throw new NotFoundException(`Source with ID ${id} not found`);
    }

    // Validate config if provided
    let normalizedConfig = updateSourceDto.config;
    let normalizedConfigRecord: Record<string, unknown> | undefined;
    if (updateSourceDto.config) {
      const sourceType = updateSourceDto.type || source.type;
      normalizedConfig = this.validationService.validate(
        String(sourceType),
        normalizedConfig,
      );
      normalizedConfigRecord =
        normalizedConfig && typeof normalizedConfig === 'object'
          ? (normalizedConfig as Record<string, unknown>)
          : {};
      await this.customDetectorsService.sanitizeSourceConfigDetectors(
        normalizedConfigRecord,
      );
    }

    // Validate cron expression up-front before any mutations
    if (
      (updateSourceDto.scheduleEnabled === true ||
        updateSourceDto.scheduleMode === 'CRON') &&
      updateSourceDto.scheduleCron
    ) {
      this.assertValidCronExpression(updateSourceDto.scheduleCron);
    }
    if (
      updateSourceDto.scheduleMode === 'CRON' &&
      !updateSourceDto.scheduleCron
    ) {
      throw new BadRequestException(
        'scheduleCron is required when scheduleMode is CRON.',
      );
    }

    let updated: SourceModel;
    let scheduleUpdated = false;

    try {
      // Update source first and compensate if schedule mutation fails.
      updated = await this.sourceService.updateFromConfig(id, {
        ...updateSourceDto,
        config: normalizedConfigRecord ?? normalizedConfig,
      });

      scheduleUpdated = await this.applyScheduleMode(
        id,
        updateSourceDto,
        'updated',
      );
    } catch (error) {
      await this.sourceService.updateSource({
        where: { id },
        data: {
          name: source.name,
          type: source.type,
          config: source.config as Prisma.InputJsonValue,
        },
      });
      throw error;
    }

    // Re-fetch so the response reflects the schedule update
    if (scheduleUpdated) {
      const refreshed = await this.sourceService.source({ id });
      return refreshed ?? updated;
    }

    return updated;
  }

  /**
   * Put a source under exactly one scheduler.
   *
   * `scheduleMode` is the modern field; when it is absent the legacy
   * `scheduleEnabled`/`scheduleCron` pair is honoured unchanged, so existing
   * API clients and the MCP tools keep working. Returns whether anything about
   * the schedule changed (the caller re-reads the source when it did).
   */
  private async applyScheduleMode(
    sourceId: string,
    dto: {
      scheduleMode?: 'OFF' | 'CRON' | 'AUTO';
      scheduleEnabled?: boolean;
      scheduleCron?: string;
      scheduleTimezone?: string;
    },
    verb: 'created' | 'updated',
  ): Promise<boolean> {
    const mode =
      dto.scheduleMode ??
      (dto.scheduleEnabled === true && dto.scheduleCron
        ? 'CRON'
        : dto.scheduleEnabled === false
          ? 'OFF'
          : undefined);
    if (!mode) return false;

    if (mode === 'AUTO') {
      // Drop any cron schedule first, handing ownership straight to the
      // adaptive scheduler so the source is never briefly unowned. A source
      // being created has none, and calling pg-boss for it would put a
      // needless failure mode in the create path.
      if (verb === 'updated') {
        await this.schedulerService.removeSchedule(
          sourceId,
          SourceScheduleMode.AUTO,
        );
      }
      await this.autoScheduleService.enable(
        sourceId,
        `Automatic scheduling ${verb} by an operator — starting the initial sweep.`,
      );
      return true;
    }

    if (mode === 'CRON') {
      if (!dto.scheduleCron) {
        throw new BadRequestException(
          'scheduleCron is required when scheduleMode is CRON.',
        );
      }
      this.assertValidCronExpression(dto.scheduleCron);
      await this.schedulerService.upsertSchedule(
        sourceId,
        dto.scheduleCron,
        dto.scheduleTimezone ?? 'UTC',
      );
      return true;
    }

    // OFF is the default for a new source — nothing to unschedule.
    if (verb === 'updated') {
      await this.schedulerService.removeSchedule(
        sourceId,
        SourceScheduleMode.OFF,
      );
      return true;
    }
    return false;
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

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Test source connection',
    description:
      'Runs a lightweight CLI connection test for the specified source.',
  })
  @ApiParam({
    name: 'id',
    description: 'Source unique identifier',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'Connection test completed',
    type: TestConnectionResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Source not found',
  })
  async testConnection(
    @Param('id') id: string,
  ): Promise<TestConnectionResponseDto> {
    await this.sourceFilesService.assertHasFiles(id);
    const result = await this.cliRunnerService.testConnection(id);
    return result as TestConnectionResponseDto;
  }

  @Post(':id/runs')
  @ApiOperation({
    summary: 'Start a new ingestion run',
    description:
      'Initiate a new data ingestion run for the specified source. This creates a new run ID and sets the runner status to PENDING.',
  })
  @ApiParam({
    name: 'id',
    description: 'Source unique identifier',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'Run started successfully',
    type: SourceResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Source not found' })
  async startRun(@Param('id') id: string): Promise<SourceModel> {
    const source = await this.sourceService.source({ id });
    if (!source) {
      throw new NotFoundException(`Source with ID ${id} not found`);
    }
    await this.sourceFilesService.assertHasFiles(id);
    await this.cliRunnerService.startRun(id);

    const updatedSource = await this.sourceService.source({ id });
    if (!updatedSource) {
      throw new NotFoundException(`Source with ID ${id} not found`);
    }

    return updatedSource;
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Update runner status',
    description:
      'Compatibility wrapper that updates the current runner for a source. Only terminal statuses are allowed.',
  })
  @ApiParam({
    name: 'id',
    description: 'Source unique identifier',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['COMPLETED', 'ERROR'],
          example: 'COMPLETED',
        },
      },
      required: ['status'],
    },
    examples: {
      running: {
        summary: 'Set to running',
        value: { status: 'RUNNING' },
      },
      completed: {
        summary: 'Mark as completed',
        value: { status: 'COMPLETED' },
      },
      error: {
        summary: 'Mark as error',
        value: { status: 'ERROR' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Status updated successfully',
    type: SourceResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid status value' })
  @ApiResponse({ status: 404, description: 'Source not found' })
  async updateStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateRunnerStatusDto,
  ): Promise<SourceModel> {
    const source = await this.sourceService.source({ id });
    if (!source) {
      throw new NotFoundException(`Source with ID ${id} not found`);
    }

    const { status } = updateStatusDto;
    if (status !== RunnerStatus.COMPLETED && status !== RunnerStatus.ERROR) {
      throw new BadRequestException(
        `Invalid status: ${status}. Must be one of: ${RunnerStatus.COMPLETED}, ${RunnerStatus.ERROR}`,
      );
    }

    if (!source.currentRunnerId) {
      throw new BadRequestException(
        `Source ${id} does not have an active runner to update`,
      );
    }

    await this.cliRunnerService.updateRunnerStatus(
      source.currentRunnerId,
      status,
    );

    const updatedSource = await this.sourceService.source({ id });
    if (!updatedSource) {
      throw new NotFoundException(`Source with ID ${id} not found`);
    }

    return updatedSource;
  }

  @Get(':id/schedule')
  @ApiOperation({
    summary: 'Get source schedule',
    description:
      'Retrieve the current cron schedule settings for a data source.',
  })
  @ApiParam({
    name: 'id',
    description: 'Source unique identifier',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'Schedule details',
    schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', example: true },
        cron: { type: 'string', example: '0 2 * * *', nullable: true },
        timezone: { type: 'string', example: 'UTC', nullable: true },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Source not found' })
  async getSchedule(@Param('id') id: string): Promise<{
    enabled: boolean;
    cron: string | null;
    timezone: string | null;
    mode: SourceScheduleMode;
    auto: AutoScheduleStatus | null;
  }> {
    const source = await this.sourceService.source({ id });
    if (!source) {
      throw new NotFoundException(`Source with ID ${id} not found`);
    }
    const [schedule, auto] = await Promise.all([
      this.schedulerService.getSchedule(id),
      this.autoScheduleService.describe(id),
    ]);
    return { ...schedule, auto };
  }

  @Post(':id/schedule/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resume automatic scanning',
    description:
      'Clear the circuit breaker on a source whose automatic schedule was ' +
      'paused after repeated scan failures, and queue it to run immediately.',
  })
  @ApiParam({ name: 'id', description: 'Source unique identifier' })
  @ApiResponse({ status: 200, description: 'Automatic scanning resumed' })
  @ApiResponse({ status: 404, description: 'Source not found' })
  @ApiResponse({
    status: 400,
    description: 'Source is not using automatic scheduling',
  })
  async resumeSchedule(
    @Param('id') id: string,
  ): Promise<AutoScheduleStatus | null> {
    const status = await this.autoScheduleService.describe(id);
    if (!status) {
      throw new NotFoundException(`Source with ID ${id} not found`);
    }
    if (status.mode !== SourceScheduleMode.AUTO) {
      throw new BadRequestException(
        'This source does not use automatic scheduling.',
      );
    }
    await this.autoScheduleService.resume(id, 'Resumed by an operator.');
    return this.autoScheduleService.describe(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a data source',
    description: 'Permanently delete a data source and all its associated data',
  })
  @ApiParam({
    name: 'id',
    description: 'Source unique identifier',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 204,
    description: 'Source successfully deleted',
  })
  @ApiResponse({
    status: 404,
    description: 'Source not found',
  })
  async deleteSource(@Param('id') id: string): Promise<void> {
    const source = await this.sourceService.source({ id });
    if (!source) {
      throw new NotFoundException(`Source with ID ${id} not found`);
    }

    await this.schedulerService.removeSchedule(id);
    await this.sourceService.deleteSource({ id });
  }

  @Delete(':id/findings')
  @ApiOperation({
    summary: 'Purge all findings of a data source',
    description:
      'Permanently delete every finding of the source (all statuses, including resolved and false-positive). ' +
      'Case evidence snapshots survive; correlation fingerprints are recomputed in the background. Irreversible.',
  })
  @ApiParam({
    name: 'id',
    description: 'Source unique identifier',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'Findings purged; returns the number of deleted findings',
  })
  @ApiResponse({
    status: 404,
    description: 'Source not found',
  })
  async purgeFindings(
    @Param('id') id: string,
  ): Promise<{ purgedFindings: number }> {
    return this.sourceService.purgeFindings(id);
  }

  @Delete(':id/assets')
  @ApiOperation({
    summary: 'Purge all assets of a data source',
    description:
      'Permanently delete every asset of the source, along with their findings, extractions, ' +
      'correlation values, signatures and chunks (all cascade via FK). Correlation fingerprints ' +
      'are recomputed in the background. Irreversible.',
  })
  @ApiParam({
    name: 'id',
    description: 'Source unique identifier',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'Assets purged; returns the number of deleted assets',
  })
  @ApiResponse({
    status: 404,
    description: 'Source not found',
  })
  async purgeAssets(
    @Param('id') id: string,
  ): Promise<{ purgedAssets: number }> {
    return this.sourceService.purgeAssets(id);
  }
}

@AllowInDemoMode()
@ReadOnlyEndpoint()
@Controller('search/sources')
@ApiTags('Sources')
export class SearchSourcesController {
  constructor(private readonly sourceService: SourceService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Search data sources',
    description:
      'Paginated search over data sources with optional filters. Returns source details with the latest runner summary and aggregate totals (total, healthy, errors, running).',
  })
  @ApiBody({ type: SearchSourcesRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of sources with totals',
    type: SearchSourcesResponseDto,
  })
  async searchSources(
    @Body() request: SearchSourcesRequestDto,
  ): Promise<SearchSourcesResponseDto> {
    return this.sourceService.searchSources(request);
  }
}
