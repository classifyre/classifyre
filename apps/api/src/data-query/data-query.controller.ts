import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import { AllowInDemoMode } from '../demo-mode.decorator';
import {
  CreateQueryRunDto,
  DataQuerySettingsDto,
  QueryCatalogDto,
  QueryRunDto,
  UpdateDataQuerySettingsDto,
} from './data-query.dto';
import { QueryCatalogService } from './query-catalog.service';
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
  ) {}

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
    summary: 'Whether this workspace answers SQL, and its limits',
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
  @AllowInDemoMode()
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
  @AllowInDemoMode()
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
  @AllowInDemoMode()
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
