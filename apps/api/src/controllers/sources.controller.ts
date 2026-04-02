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
import { Source as SourceModel, RunnerStatus, Prisma } from '@prisma/client';
import { CreateSourceDto } from '../dto/create-source.dto';
import { UpdateSourceDto } from '../dto/update-source.dto';
import { UpdateRunnerStatusDto } from '../dto/update-runner-status.dto';
import { SourceResponseDto } from '../dto/source-response.dto';
import { TestConnectionResponseDto } from '../dto/test-connection-response.dto';
import { SearchSourcesRequestDto } from '../dto/search-sources-request.dto';
import { SearchSourcesResponseDto } from '../dto/search-sources-response.dto';

@Controller('sources')
@ApiTags('Sources')
export class SourcesController {
  constructor(
    private readonly sourceService: SourceService,
    private readonly validationService: ValidationService,
    private readonly customDetectorsService: CustomDetectorsService,
    private readonly cliRunnerService: CliRunnerService,
    private readonly schedulerService: SchedulerService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new data source',
    description:
      'Register a new data source for metadata ingestion (WordPress, Slack, S3-Compatible Storage, Azure Blob Storage, Google Cloud Storage, PostgreSQL, MySQL, MSSQL, Oracle, Hive, Databricks, Snowflake, MongoDB, PowerBI, Tableau, Confluence, Jira, Service Desk).',
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
    const customDetectors =
      await this.customDetectorsService.assertActiveDetectorIds(
        normalizedConfigRecord.custom_detectors,
      );
    if (customDetectors.length > 0) {
      normalizedConfigRecord.custom_detectors = customDetectors;
    }

    // Create source in database
    const source = await this.sourceService.createFromConfig({
      ...createSourceDto,
      config: normalizedConfigRecord,
    });

    // Handle schedule (upsert if enabled, no-op if not provided)
    if (
      createSourceDto.scheduleEnabled === true &&
      createSourceDto.scheduleCron
    ) {
      this.assertValidCronExpression(createSourceDto.scheduleCron);
      await this.schedulerService.upsertSchedule(
        source.id,
        createSourceDto.scheduleCron,
        createSourceDto.scheduleTimezone ?? 'UTC',
      );
    }

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
      const customDetectors =
        await this.customDetectorsService.assertActiveDetectorIds(
          normalizedConfigRecord.custom_detectors,
        );
      if (customDetectors.length > 0) {
        normalizedConfigRecord.custom_detectors = customDetectors;
      }
    }

    // Validate cron expression up-front before any mutations
    if (
      updateSourceDto.scheduleEnabled === true &&
      updateSourceDto.scheduleCron
    ) {
      this.assertValidCronExpression(updateSourceDto.scheduleCron);
    }

    let updated: SourceModel;
    let scheduleUpdated = false;

    try {
      // Update source first and compensate if schedule mutation fails.
      updated = await this.sourceService.updateFromConfig(id, {
        ...updateSourceDto,
        config: normalizedConfigRecord ?? normalizedConfig,
      });

      // Handle schedule
      if (updateSourceDto.scheduleEnabled !== undefined) {
        if (
          updateSourceDto.scheduleEnabled === true &&
          updateSourceDto.scheduleCron
        ) {
          await this.schedulerService.upsertSchedule(
            id,
            updateSourceDto.scheduleCron,
            updateSourceDto.scheduleTimezone ?? 'UTC',
          );
          scheduleUpdated = true;
        } else if (updateSourceDto.scheduleEnabled === false) {
          await this.schedulerService.removeSchedule(id);
          scheduleUpdated = true;
        }
      }
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
  }> {
    const source = await this.sourceService.source({ id });
    if (!source) {
      throw new NotFoundException(`Source with ID ${id} not found`);
    }
    return this.schedulerService.getSchedule(id);
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
}

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
