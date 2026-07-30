import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import '@fastify/multipart';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { ClsService } from 'nestjs-cls';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DataTransferJob } from '@prisma/client';

import { CLS_SCHEMA } from '../namespace/namespace.constants';
import { DataTransferService } from './data-transfer.service';
import {
  ArchivePreviewDto,
  DataTransferJobDto,
  DataTransferJobListDto,
  DeleteDataTransferJobResponseDto,
  StartExportDto,
  StartImportDto,
  TransferScopeDto,
  DATA_TRANSFER_CONFLICT_MODES,
} from './dto/data-transfer.dto';

/**
 * Namespace-scoped export and import.
 *
 * Every mutating route here is a plain POST, so the demo-mode guard blocks it
 * by default — a demo instance must not hand out its corpus or accept one.
 */
@ApiTags('data-transfer')
@Controller('data-transfer')
export class DataTransferController {
  constructor(
    private readonly transfers: DataTransferService,
    private readonly cls: ClsService,
  ) {}

  @Get('scopes')
  @ApiOperation({
    summary: 'List the kinds of data that can be exported, with row counts',
  })
  @ApiOkResponse({ type: [TransferScopeDto] })
  scopes(): Promise<TransferScopeDto[]> {
    return this.transfers.scopeCatalogue();
  }

  @Get('jobs')
  @ApiOperation({ summary: 'List recent export and import jobs' })
  @ApiOkResponse({ type: DataTransferJobListDto })
  async jobs(@Query('limit') limit?: string): Promise<DataTransferJobListDto> {
    const jobs = await this.transfers.list(
      limit ? Number.parseInt(limit, 10) : undefined,
    );
    return { jobs: jobs.map(toDto) };
  }

  @Get('jobs/:id')
  @ApiOperation({ summary: 'Poll one transfer job for progress' })
  @ApiOkResponse({ type: DataTransferJobDto })
  async job(@Param('id') id: string): Promise<DataTransferJobDto> {
    return toDto(await this.transfers.get(id));
  }

  @Post('exports')
  @ApiOperation({ summary: 'Start an export of the selected scopes' })
  @ApiOkResponse({ type: DataTransferJobDto })
  async startExport(@Body() dto: StartExportDto): Promise<DataTransferJobDto> {
    return toDto(
      await this.transfers.startExport({ scopes: dto.scopes ?? [] }),
    );
  }

  @Get('exports/:id/download')
  @ApiOperation({ summary: 'Download a completed export archive' })
  async download(
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = await this.transfers.downloadable(id);

    reply.raw.setHeader('Content-Type', 'application/gzip');
    reply.raw.setHeader('Content-Length', String(file.size));
    reply.raw.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName.replace(/"/g, '')}"`,
    );

    await pipeline(createReadStream(file.path), reply.raw);
  }

  @Post('imports/upload')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload an archive and read its manifest without importing it',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: ArchivePreviewDto })
  async upload(@Req() request: FastifyRequest): Promise<ArchivePreviewDto> {
    const schema = this.cls.get<string>(CLS_SCHEMA) ?? 'namespace';

    let fileName = 'archive.cfyre';
    let bytes: Buffer | undefined;
    for await (const part of request.parts()) {
      if (part.type !== 'file') continue;
      if (bytes) {
        throw new BadRequestException('Upload exactly one archive per request');
      }
      fileName = part.filename || fileName;
      bytes = await part.toBuffer();
    }

    if (!bytes) throw new BadRequestException('No archive was uploaded');

    return this.transfers.previewUpload(schema, fileName, bytes);
  }

  @Post('imports')
  @ApiOperation({ summary: 'Import selected scopes from an uploaded archive' })
  @ApiOkResponse({ type: DataTransferJobDto })
  async startImport(@Body() dto: StartImportDto): Promise<DataTransferJobDto> {
    if (!dto?.uploadId) {
      throw new BadRequestException('uploadId is required');
    }
    const conflictMode = dto.conflictMode ?? 'SKIP';
    if (!DATA_TRANSFER_CONFLICT_MODES.includes(conflictMode)) {
      throw new BadRequestException(`Unknown conflict mode '${conflictMode}'`);
    }

    return toDto(
      await this.transfers.startImport({
        schema: this.cls.get<string>(CLS_SCHEMA) ?? 'namespace',
        uploadId: dto.uploadId,
        scopes: dto.scopes ?? [],
        conflictMode,
      }),
    );
  }

  @Post('jobs/:id/cancel')
  @ApiOperation({ summary: 'Ask a running transfer to stop' })
  @ApiOkResponse({ type: DataTransferJobDto })
  async cancel(@Param('id') id: string): Promise<DataTransferJobDto> {
    return toDto(await this.transfers.cancel(id));
  }

  @Delete('jobs/:id')
  @ApiOperation({ summary: 'Delete a finished job and its archive' })
  @ApiOkResponse({ type: DeleteDataTransferJobResponseDto })
  async remove(
    @Param('id') id: string,
  ): Promise<DeleteDataTransferJobResponseDto> {
    await this.transfers.remove(id);
    return { deleted: true };
  }
}

/**
 * `fileSize` is a BigInt column and the JSON dates need to be strings, so the
 * Prisma row is never returned directly.
 */
function toDto(job: DataTransferJob): DataTransferJobDto {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    scopes: job.scopes,
    conflictMode: job.conflictMode,
    fileName: job.fileName,
    fileSize: job.fileSize === null ? null : Number(job.fileSize),
    checksum: job.checksum,
    downloadAvailable:
      job.kind === 'EXPORT' &&
      job.status === 'COMPLETED' &&
      job.storageKey !== null,
    totalRows: job.totalRows,
    processedRows: job.processedRows,
    skippedRows: job.skippedRows,
    percent: job.percent,
    currentTable: job.currentTable,
    counts: (job.counts ?? {}) as Record<string, number>,
    warnings: Array.isArray(job.warnings) ? (job.warnings as string[]) : [],
    errorMessage: job.errorMessage,
    cancelRequested: job.cancelRequested,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    expiresAt: job.expiresAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
  };
}
