import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PublicRoute, Requires } from '../identity/access.decorators';
import { ReadsOnly } from '../reads-only.decorator';
import {
  CreateQueryRunDto,
  DataQuerySettingsDto,
  QueryCatalogDto,
  QueryRunDto,
  SavedQueryDto,
  SaveSavedQueryDto,
  UpdateDataQuerySettingsDto,
} from './data-query.dto';
import { QueryCatalogService } from './query-catalog.service';
import { SavedQueriesService } from './saved-queries.service';
import {
  EXPORT_MEDIA_TYPES,
  QueryRunService,
  type ExportFormat,
} from './query-run.service';

/**
 * SQL over the tables of a workspace (docs/prd/DQ-data-query.md).
 *
 * The routes need only `workspace.view`: what a person may read is decided
 * per table, by the catalog, from a role on the whole workspace or a
 * data-reader grant on single sources and tables.
 */
@ApiTags('Data query')
@Controller()
export class DataQueryController {
  constructor(
    private readonly catalog: QueryCatalogService,
    private readonly runs: QueryRunService,
    private readonly saved: SavedQueriesService,
  ) {}

  @Get('saved-queries')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Your saved SQL in this workspace' })
  @ApiOkResponse({ type: [SavedQueryDto] })
  listSaved(): Promise<SavedQueryDto[]> {
    return this.saved.list();
  }

  @Post('saved-queries')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Save SQL under a name' })
  @ApiOkResponse({ type: SavedQueryDto })
  createSaved(@Body() body: SaveSavedQueryDto): Promise<SavedQueryDto> {
    return this.saved.create(body?.name ?? '', body?.sql ?? '');
  }

  @Get('saved-queries/:id')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'One of your saved queries' })
  @ApiOkResponse({ type: SavedQueryDto })
  getSaved(@Param('id', ParseUUIDPipe) id: string): Promise<SavedQueryDto> {
    return this.saved.get(id);
  }

  @Patch('saved-queries/:id')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Rename a saved query or save new SQL under it' })
  @ApiOkResponse({ type: SavedQueryDto })
  updateSaved(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SaveSavedQueryDto,
  ): Promise<SavedQueryDto> {
    return this.saved.update(id, body?.name, body?.sql);
  }

  @Delete('saved-queries/:id')
  @Requires('workspace.view')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a saved query' })
  removeSaved(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.saved.remove(id);
  }

  @Get('data-query/catalog')
  @Requires('workspace.view')
  @ApiOperation({
    summary:
      'The tables you can query with SQL, and those you could with access',
  })
  @ApiOkResponse({ type: QueryCatalogDto })
  getCatalog(): Promise<QueryCatalogDto> {
    return this.catalog.catalog();
  }

  @Get('data-query/settings')
  @Requires('workspace.view')
  @ApiOperation({
    summary: 'The SQL limits of this workspace',
  })
  @ApiOkResponse({ type: DataQuerySettingsDto })
  getSettings(): Promise<DataQuerySettingsDto> {
    return this.catalog.settings();
  }

  @Put('data-query/settings')
  @Requires('workspace.settings')
  @ApiOperation({ summary: 'Set the limits of SQL queries in this workspace' })
  @ApiOkResponse({ type: DataQuerySettingsDto })
  updateSettings(
    @Body() body: UpdateDataQuerySettingsDto,
  ): Promise<DataQuerySettingsDto> {
    return this.catalog.updateSettings(body ?? {});
  }

  @Post('query-runs')
  @Requires('workspace.view')
  @ReadsOnly()
  @ApiOperation({
    summary: 'Run one SELECT; poll the run for its status',
    description:
      'Runs as a short-lived job. Only tables you may query exist for the query; ' +
      'name them `<source>.<schema>.<table>` as the catalog lists them.',
  })
  @ApiOkResponse({ type: QueryRunDto })
  create(@Body() body: CreateQueryRunDto): Promise<QueryRunDto> {
    return this.runs.create(body?.sql ?? '', body?.format);
  }

  @Get('query-runs')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Your recent queries in this workspace' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({ type: [QueryRunDto] })
  list(@Query('limit') limit?: string): Promise<QueryRunDto[]> {
    return this.runs.list(limit ? Number(limit) : 20);
  }

  @Get('query-runs/:id')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'One of your queries' })
  @ApiOkResponse({ type: QueryRunDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<QueryRunDto> {
    return this.runs.get(id);
  }

  @Get('query-runs/:id/result')
  @Requires('workspace.view')
  @ApiOperation({
    summary:
      'The rows of a finished query (Arrow IPC stream), or its exported file',
  })
  @ApiProduces(
    'application/vnd.apache.arrow.stream',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/vnd.apache.parquet',
  )
  async result(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { bytes, format, createdAt } = await this.runs.result(id);
    reply.header('Cache-Control', 'private, no-store');
    if (format && format in EXPORT_MEDIA_TYPES) {
      const stamp = createdAt.toISOString().slice(0, 16).replace(/[:T]/g, '-');
      reply
        .header('Content-Type', EXPORT_MEDIA_TYPES[format as ExportFormat])
        .header(
          'Content-Disposition',
          `attachment; filename="query-${stamp}.${format}"`,
        );
    } else {
      reply.header('Content-Type', 'application/vnd.apache.arrow.stream');
    }
    await reply.send(bytes);
  }

  @Post('query-runs/:id/cancel')
  @Requires('workspace.view')
  @ReadsOnly()
  @ApiOperation({ summary: 'Stop one of your queries' })
  @ApiOkResponse({ type: QueryRunDto })
  cancel(@Param('id', ParseUUIDPipe) id: string): Promise<QueryRunDto> {
    return this.runs.cancel(id);
  }

  /**
   * The query job's result. Not signed in and holding no key: it proves
   * itself with the run's own token (X-Query-Run-Token), good for this one
   * run and cleared once the result is in.
   */
  @Post('query-runs/:id/result')
  @PublicRoute()
  @ReadsOnly()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Internal: a query job posts its result here',
  })
  async receive(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-query-run-token') token: string | undefined,
    @Headers('x-query-run-meta') meta: string | undefined,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.runs.receiveResult(
      id,
      token,
      request.body as Buffer | Record<string, unknown> | undefined,
      meta,
    );
  }
}
