import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { Requires, SignedInOnly } from '../identity/access.decorators';
import { AccessManagementService } from '../identity/access-management.service';
import {
  BlockSharedDatasetDto,
  CreateSharedDatasetDto,
  DescribeSharedDatasetDto,
  PromoteSharedDatasetDto,
  SharedDatasetDescriptionDto,
  SharedDatasetDto,
  SharedDatasetOptionsDto,
  SharedDatasetSummaryDto,
  SharedDatasetUseDto,
  SharedDatasetVersionDto,
  UpdateSharedDatasetDto,
} from './shared-datasets.dto';
import { SharedDatasetsService } from './shared-datasets.service';

/**
 * Shared datasets (docs/prd/DQ-data-query.md §5.12). Reading one is a query
 * like any other (query-runs); these routes keep its definition. Its SQL
 * and versions need `asset.view`, like any asset's details (the SQL can
 * hold literal values); the rest `workspace.view`, and the service decides who may share (dataset.publish,
 * or governing every input), change and promote (its owner and stewards),
 * and block (an input's owners and stewards).
 */
@ApiTags('Shared datasets')
@SignedInOnly()
@Controller('shared-datasets')
export class SharedDatasetsController {
  constructor(
    private readonly datasets: SharedDatasetsService,
    private readonly access: AccessManagementService,
  ) {}

  @Get()
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Every shared dataset of the workspace' })
  @ApiOkResponse({ type: [SharedDatasetSummaryDto] })
  list(): Promise<SharedDatasetSummaryDto[]> {
    return this.datasets.list();
  }

  @Get('options')
  @Requires('workspace.view')
  @ApiOperation({
    summary: 'Whether you may share datasets here, and your groups',
  })
  @ApiOkResponse({ type: SharedDatasetOptionsDto })
  options(): Promise<SharedDatasetOptionsDto> {
    return this.datasets.options();
  }

  @Get('uses')
  @Requires('workspace.view')
  @ApiOperation({
    summary: 'Shared datasets that read a table or any table of a source',
  })
  @ApiQuery({ name: 'scopeType', enum: ['asset', 'source'] })
  @ApiQuery({ name: 'scopeId' })
  @ApiOkResponse({ type: [SharedDatasetUseDto] })
  uses(
    @Query('scopeType') scopeType: string,
    @Query('scopeId') scopeId: string,
  ): Promise<SharedDatasetUseDto[]> {
    return this.datasets.usesOf(scopeType, scopeId);
  }

  @Post('describe')
  @Requires('workspace.view')
  @ApiOperation({
    summary:
      'What a query would be as a shared dataset: columns, inherited classification, inputs, whether you may share it',
  })
  @ApiOkResponse({ type: SharedDatasetDescriptionDto })
  describe(
    @Body() body: DescribeSharedDatasetDto,
  ): Promise<SharedDatasetDescriptionDto> {
    return this.datasets.describe(body ?? {});
  }

  @Post()
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Share a query as a dataset' })
  @ApiOkResponse({ type: SharedDatasetDto })
  async create(
    @Req() request: FastifyRequest,
    @Body() body: CreateSharedDatasetDto,
  ): Promise<SharedDatasetDto> {
    const principal = await this.access.identity.authenticate(request.raw);
    return this.datasets.create(principal, body ?? {});
  }

  @Get(':id')
  @Requires('asset.view')
  @ApiOperation({ summary: 'One shared dataset (its asset id)' })
  @ApiOkResponse({ type: SharedDatasetDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<SharedDatasetDto> {
    return this.datasets.get(id);
  }

  @Patch(':id')
  @Requires('workspace.view')
  @ApiOperation({
    summary: 'Change the SQL, description or owning group (a new version)',
  })
  @ApiOkResponse({ type: SharedDatasetDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateSharedDatasetDto,
  ): Promise<SharedDatasetDto> {
    return this.datasets.update(id, body ?? {});
  }

  @Get(':id/versions')
  @Requires('asset.view')
  @ApiOperation({ summary: 'Every saved version of its definition' })
  @ApiOkResponse({ type: [SharedDatasetVersionDto] })
  versions(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SharedDatasetVersionDto[]> {
    return this.datasets.versions(id);
  }

  @Post(':id/promote')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Mark it promoted (ready), or take that back' })
  @ApiOkResponse({ type: SharedDatasetDto })
  promote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PromoteSharedDatasetDto,
  ): Promise<SharedDatasetDto> {
    return this.datasets.promote(id, Boolean(body?.promoted));
  }

  @Post(':id/blocks')
  @Requires('workspace.view')
  @ApiOperation({
    summary:
      'Block it from reading your table (or source): nobody reads it until lifted',
  })
  @ApiOkResponse({ type: [SharedDatasetUseDto] })
  block(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: BlockSharedDatasetDto,
  ): Promise<SharedDatasetUseDto[]> {
    return this.datasets.block(id, body ?? {});
  }

  @Delete(':id/blocks/:blockId')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Lift a block' })
  @ApiOkResponse({ type: [SharedDatasetUseDto] })
  unblock(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('blockId', ParseUUIDPipe) blockId: string,
  ): Promise<SharedDatasetUseDto[]> {
    return this.datasets.unblock(id, blockId);
  }
}
