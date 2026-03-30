import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { AppService } from './app.service';
import { SourceService } from './source.service';
import { AssetService } from './asset.service';
import { ValidationService } from './validation.service';
import { CliRunnerService } from './cli-runner/cli-runner.service';
import {
  Source as SourceModel,
  Asset as AssetModel,
  RunnerStatus,
} from '@prisma/client';
import { CreateSourceDto } from './dto/create-source.dto';
import { UpdateRunnerStatusDto } from './dto/update-runner-status.dto';
import { BulkIngestAssetsDto } from './dto/bulk-ingest-assets.dto';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly sourceService: SourceService,
    private readonly assetService: AssetService,
    private readonly validationService: ValidationService,
    private readonly cliRunnerService: CliRunnerService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  getHello(): string {
    return this.appService.getHello();
  }

  // Sources
  @ApiTags('Sources')
  @Post('sources')
  @ApiOperation({ summary: 'Create a new metadata source' })
  @ApiResponse({
    status: 201,
    description: 'The source has been successfully created.',
  })
  async createSource(
    @Body() createSourceDto: CreateSourceDto,
  ): Promise<SourceModel> {
    // 1. Validate input against schemas
    const normalizedConfig = this.validationService.validate(
      String(createSourceDto.type),
      createSourceDto.config,
    );

    // 2. Generate ID and Store in database
    return this.sourceService.createFromConfig({
      ...createSourceDto,
      config: normalizedConfig,
    });
  }

  @ApiTags('Sources')
  @Get('sources')
  @ApiOperation({ summary: 'Get all sources' })
  async getSources(): Promise<SourceModel[]> {
    return this.sourceService.sources({});
  }

  @ApiTags('Sources')
  @Get('sources/:id')
  @ApiOperation({ summary: 'Get a source by ID' })
  @ApiParam({ name: 'id', description: 'The unique identifier of the source' })
  async getSourceById(@Param('id') id: string): Promise<SourceModel | null> {
    return this.sourceService.source({ id });
  }

  // Runner / Runs
  @ApiTags('Runner')
  @Post('sources/:id/runs')
  @ApiOperation({ summary: 'Start a new ingestion run for a source' })
  @ApiParam({ name: 'id', description: 'The source ID' })
  async startNewRun(@Param('id') id: string): Promise<SourceModel> {
    const source = await this.sourceService.source({ id });
    if (!source) {
      throw new BadRequestException(`Source with ID ${id} not found`);
    }

    await this.cliRunnerService.startRun(id);

    const updatedSource = await this.sourceService.source({ id });
    if (!updatedSource) {
      throw new BadRequestException(`Source with ID ${id} not found`);
    }

    return updatedSource;
  }

  @ApiTags('Runner')
  @Patch('sources/:id/status')
  @ApiOperation({ summary: 'Update the runner status for a source' })
  @ApiParam({ name: 'id', description: 'The source ID' })
  async updateRunnerStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateRunnerStatusDto,
  ): Promise<SourceModel> {
    const source = await this.sourceService.source({ id });
    if (!source) {
      throw new BadRequestException(`Source with ID ${id} not found`);
    }

    const { status } = updateStatusDto;
    if (status !== RunnerStatus.COMPLETED && status !== RunnerStatus.ERROR) {
      throw new BadRequestException(
        `Invalid status: ${status}. Must be COMPLETED or ERROR`,
      );
    }

    if (!source.currentRunnerId) {
      throw new BadRequestException(
        `Source with ID ${id} does not have an active runner`,
      );
    }

    await this.cliRunnerService.updateRunnerStatus(
      source.currentRunnerId,
      status,
    );
    const updatedSource = await this.sourceService.source({ id });
    if (!updatedSource) {
      throw new BadRequestException(`Source with ID ${id} not found`);
    }

    return updatedSource;
  }

  // Assets
  @ApiTags('Assets')
  @Get('assets')
  @ApiOperation({ summary: 'Get all ingested assets' })
  async getAssets(): Promise<AssetModel[]> {
    return this.assetService.assets({});
  }

  @ApiTags('Assets')
  @Get('assets/:id')
  @ApiOperation({ summary: 'Get an asset by ID' })
  @ApiParam({ name: 'id', description: 'The unique identifier of the asset' })
  async getAssetById(@Param('id') id: string): Promise<AssetModel | null> {
    return this.assetService.asset({ id });
  }

  @ApiTags('Assets')
  @Get('sources/:id/assets')
  @ApiOperation({ summary: 'Get all assets belonging to a specific source' })
  @ApiParam({ name: 'id', description: 'The source ID' })
  async getAssetsBySource(
    @Param('id') sourceId: string,
  ): Promise<AssetModel[]> {
    return this.assetService.assets({
      where: { sourceId },
    });
  }

  @ApiTags('Assets')
  @Post('sources/:id/assets/bulk')
  @ApiOperation({ summary: 'Bulk ingest assets for a specific source and run' })
  @ApiParam({ name: 'id', description: 'The source ID' })
  async bulkIngestAssets(
    @Param('id') sourceId: string,
    @Body() bulkIngestDto: BulkIngestAssetsDto,
  ) {
    const { runnerId, assets } = bulkIngestDto;

    if (!runnerId) {
      throw new BadRequestException('runnerId is required');
    }
    if (!assets || !Array.isArray(assets)) {
      throw new BadRequestException('assets must be an array');
    }

    // 1. Get source to know its type for validation
    const source = await this.sourceService.source({ id: sourceId });
    if (!source) {
      throw new BadRequestException(`Source with ID ${sourceId} not found`);
    }

    // 2. Validate each asset in the array
    for (const asset of assets) {
      this.validationService.validateOutput(source.type, asset);
    }

    // 3. Perform bulk ingestion
    return this.assetService.bulkIngest(sourceId, runnerId, assets);
  }
}
