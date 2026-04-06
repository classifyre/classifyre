import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
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
import { AssetService } from '../asset.service';
import { FindingsService } from '../findings.service';
import { SourceService } from '../source.service';
import { ValidationService } from '../validation.service';
import { BulkIngestAssetsDto } from '../dto/bulk-ingest-assets.dto';
import { FinalizeIngestRunDto } from '../dto/finalize-ingest-run.dto';
import { QueryAssetsDto } from '../dto/query-assets.dto';
import { AssetListItemDto } from '../dto/asset-list-item.dto';
import { AssetListResponseDto } from '../dto/asset-list-response.dto';
import { SearchAssetsRequestDto } from '../dto/search-assets-request.dto';
import { SearchAssetsResponseDto } from '../dto/search-assets-response.dto';
import { SearchAssetsChartsRequestDto } from '../dto/search-assets-charts-request.dto';
import { SearchAssetsChartsResponseDto } from '../dto/search-assets-charts-response.dto';
import { AllowInDemoMode } from '../demo-mode.decorator';
import { SearchFindingsRequestDto } from '../dto/search-findings-request.dto';
import { SearchFindingsResponseDto } from '../dto/search-findings-response.dto';
import { SearchFindingsChartsRequestDto } from '../dto/search-findings-charts-request.dto';
import { SearchFindingsChartsResponseDto } from '../dto/search-findings-charts-response.dto';
import { SearchFindingsCustomDetectorOptionDto } from '../dto/search-findings-custom-detectors.dto';

@Controller('assets')
@ApiTags('Assets')
export class AssetsController {
  constructor(
    private readonly assetService: AssetService,
    private readonly sourceService: SourceService,
    private readonly validationService: ValidationService,
  ) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Get asset by ID',
    description: 'Retrieve detailed information about a specific asset',
  })
  @ApiParam({
    name: 'id',
    description: 'Asset unique identifier (deterministic UUID)',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 404,
    description: 'Asset not found',
  })
  @ApiResponse({
    status: 200,
    description: 'Asset details',
    type: AssetListItemDto,
  })
  async getAsset(@Param('id') id: string): Promise<AssetListItemDto> {
    const assetDetails = await this.assetService.getAssetById(id);
    if (!assetDetails) {
      throw new NotFoundException(`Asset with ID ${id} not found`);
    }
    return assetDetails;
  }
}

@AllowInDemoMode()
@Controller('search')
@ApiTags('Assets')
export class SearchAssetsController {
  constructor(
    private readonly assetService: AssetService,
    private readonly findingsService: FindingsService,
  ) {}

  @Post('assets')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Search assets with findings',
    description:
      'Search paginated assets and their matching findings with nested body filters.',
  })
  @ApiBody({ type: SearchAssetsRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Search results containing assets with findings',
    type: SearchAssetsResponseDto,
  })
  async searchAssets(
    @Body() request: SearchAssetsRequestDto,
  ): Promise<SearchAssetsResponseDto> {
    return this.assetService.searchAssets(request);
  }

  @Post('assets/charts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Search assets charts overview',
    description:
      'Returns dashboard totals and chart datasets for assets in a single response.',
  })
  @ApiBody({ type: SearchAssetsChartsRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Chart overview containing totals and top lists',
    type: SearchAssetsChartsResponseDto,
  })
  async searchAssetsCharts(
    @Body() request: SearchAssetsChartsRequestDto,
  ): Promise<SearchAssetsChartsResponseDto> {
    return this.assetService.searchAssetsCharts(request);
  }

  @Post('findings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Search findings',
    description:
      'Search paginated findings with nested body filters and server-side text search.',
  })
  @ApiBody({ type: SearchFindingsRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Search results containing findings',
    type: SearchFindingsResponseDto,
  })
  async searchFindings(@Body() request: SearchFindingsRequestDto) {
    return this.findingsService.searchFindings(request);
  }

  @Post('findings/custom-detectors')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List custom detector filter options',
    description:
      'Returns custom detector key/name options with counts for findings filters.',
  })
  @ApiBody({ type: SearchFindingsRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Custom detector options',
    type: [SearchFindingsCustomDetectorOptionDto],
  })
  async searchFindingsCustomDetectors(
    @Body() request: SearchFindingsRequestDto,
  ): Promise<SearchFindingsCustomDetectorOptionDto[]> {
    return this.findingsService.searchCustomDetectorOptions(request);
  }

  @Post('findings/charts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Findings charts overview',
    description:
      'Returns totals, severity timeline, and top assets for findings in a single response.',
  })
  @ApiBody({ type: SearchFindingsChartsRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Chart overview containing totals, timeline and top assets',
    type: SearchFindingsChartsResponseDto,
  })
  async searchFindingsCharts(
    @Body() request: SearchFindingsChartsRequestDto,
  ): Promise<SearchFindingsChartsResponseDto> {
    return this.findingsService.searchFindingsCharts(request);
  }
}

@Controller('sources/:sourceId/assets')
@ApiTags('Sources', 'Assets')
export class SourceAssetsController {
  constructor(
    private readonly assetService: AssetService,
    private readonly sourceService: SourceService,
    private readonly validationService: ValidationService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List assets for a source',
    description: 'Retrieve all assets belonging to a specific data source',
  })
  @ApiParam({
    name: 'sourceId',
    description: 'Source unique identifier',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'List of assets for the source',
    type: AssetListResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Source not found',
  })
  async listSourceAssets(
    @Param('sourceId') sourceId: string,
    @Query() query: QueryAssetsDto,
  ): Promise<AssetListResponseDto> {
    const source = await this.sourceService.source({ id: sourceId });
    if (!source) {
      throw new NotFoundException(`Source with ID ${sourceId} not found`);
    }

    return this.assetService.listAssets({
      ...query,
      sourceId,
    });
  }

  @Post('bulk')
  @ApiOperation({
    summary: 'Bulk ingest assets',
    description:
      'Ingest multiple assets at once for a specific source and run. Assets are upserted based on deterministic IDs.',
  })
  @ApiParam({
    name: 'sourceId',
    description: 'Source unique identifier',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiBody({
    type: BulkIngestAssetsDto,
    examples: {
      wordpressPosts: {
        summary: 'WordPress posts bulk ingest',
        value: {
          runId: 'run_2026-01-31T10:00:00.000Z',
          assets: [
            {
              hash: 'V09SRFBSRVNTXyNfaHR0cHM6Ly9ibG9nLmV4YW1wbGUuY29tXyNfcG9zdHNfMTIz',
              external_url: 'https://blog.example.com/posts/team-onboarding',
              name: 'Team Onboarding',
              checksum:
                '617f1f8f8df58d7b34f8de63f6549d0a35f0bcde8ba08ec66db7f1db886f7f00',
              links: [],
              asset_type: 'URL',
              created_at: '2026-01-30T15:30:00.000Z',
              updated_at: '2026-01-30T15:30:00.000Z',
            },
            {
              hash: 'V09SRFBSRVNTXyNfaHR0cHM6Ly9ibG9nLmV4YW1wbGUuY29tXyNfcG9zdHNfNDU2',
              external_url:
                'https://blog.example.com/posts/development-guidelines',
              name: 'Development Guidelines',
              checksum:
                '8ad39df6eb7f8bc9f67523455e8fd7f09d841f05d8be376de2600f62fc34265f',
              links: [],
              asset_type: 'URL',
              created_at: '2026-01-31T09:15:00.000Z',
              updated_at: '2026-01-31T09:15:00.000Z',
            },
          ],
        },
      },
      slackMessages: {
        summary: 'Slack messages bulk ingest',
        value: {
          runId: 'run_2026-01-31T10:00:00.000Z',
          assets: [
            {
              hash: 'U0xBQ0tfI19fYWNtZV8jX0MxMjNfI18xNzAwMDAwMDAwLjAwMDAwMA',
              external_url:
                'https://acme.slack.com/archives/C123/p1700000000000000',
              name: 'Message in #engineering',
              checksum:
                '298881fa7ff22472cf8dd773f4e3cae6412f8f393f5bcaea00ff2f8439b6f897',
              links: [],
              asset_type: 'TXT',
              created_at: '2026-01-28T10:00:00.000Z',
              updated_at: '2026-01-31T08:45:00.000Z',
            },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Assets ingested successfully',
    schema: {
      type: 'object',
      properties: {
        ingested: { type: 'number', example: 150 },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request - validation failed',
  })
  @ApiResponse({
    status: 404,
    description: 'Source not found',
  })
  async bulkIngest(
    @Param('sourceId') sourceId: string,
    @Body() bulkIngestDto: BulkIngestAssetsDto,
  ) {
    const { runnerId, assets, finalizeRun } = bulkIngestDto;

    if (!runnerId) {
      throw new BadRequestException('runnerId is required');
    }
    if (!assets || !Array.isArray(assets)) {
      throw new BadRequestException('assets must be an array');
    }

    // Get source to know its type for validation
    const source = await this.sourceService.source({ id: sourceId });
    if (!source) {
      throw new NotFoundException(`Source with ID ${sourceId} not found`);
    }

    // Validate each asset
    for (const asset of assets) {
      this.validationService.validateOutput(source.type, asset);
    }

    // Perform bulk ingestion
    return this.assetService.bulkIngest(sourceId, runnerId, assets, {
      finalizeRun,
    });
  }

  @Post('finalize')
  @ApiOperation({
    summary: 'Finalize ingest run',
    description:
      'Finalizes ingest run. For sources with sampling strategy ALL, marks assets absent from seenHashes as DELETED and auto-resolves their open findings. For RANDOM/LATEST strategies this is a no-op since absence does not imply deletion.',
  })
  @ApiParam({
    name: 'sourceId',
    description: 'Source unique identifier',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  async finalizeIngest(
    @Param('sourceId') sourceId: string,
    @Body() finalizeDto: FinalizeIngestRunDto,
  ) {
    const { runnerId, seenHashes } = finalizeDto;
    if (!runnerId) {
      throw new BadRequestException('runnerId is required');
    }
    if (!Array.isArray(seenHashes)) {
      throw new BadRequestException('seenHashes must be an array');
    }

    const source = await this.sourceService.source({ id: sourceId });
    if (!source) {
      throw new NotFoundException(`Source with ID ${sourceId} not found`);
    }

    // Derive whether this was a full scan from the source's sampling strategy.
    // Only strategy=ALL guarantees every asset was visited, so only then can
    // absence imply deletion.
    const config = source.config as Record<string, any> | null;
    const samplingStrategy = config?.sampling?.strategy as string | undefined;
    const isFullScan = samplingStrategy === 'ALL';

    return this.assetService.finalizeIngestRun(
      sourceId,
      runnerId,
      seenHashes,
      isFullScan,
    );
  }
}
