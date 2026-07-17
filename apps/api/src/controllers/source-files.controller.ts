import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import '@fastify/multipart';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SourceFilesService } from '../source-files.service';
import { UploadedSourceFileDto } from '../dto/uploaded-source-file.dto';

@ApiTags('Sources')
@Controller('sources/:sourceId/files')
export class SourceFilesController {
  constructor(private readonly files: SourceFilesService) {}

  @Get()
  @ApiOperation({ summary: 'List uploaded files for a Sandbox source' })
  @ApiResponse({ status: 200, type: [UploadedSourceFileDto] })
  list(@Param('sourceId') sourceId: string) {
    return this.files.list(sourceId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload one file to a Sandbox source' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 201, type: UploadedSourceFileDto })
  async upload(
    @Param('sourceId') sourceId: string,
    @Req() request: FastifyRequest,
  ) {
    let upload:
      | { data: Buffer; fileName: string; declaredMimeType: string }
      | undefined;
    for await (const part of request.parts()) {
      if (part.type !== 'file') continue;
      if (upload) {
        throw new BadRequestException('Upload exactly one file per request');
      }
      const data = await part.toBuffer();
      upload = {
        data,
        fileName: part.filename ?? 'upload',
        declaredMimeType: part.mimetype ?? 'application/octet-stream',
      };
    }
    if (!upload) throw new BadRequestException('No file uploaded');
    return this.files.create({ sourceId, ...upload });
  }

  @Get(':fileId/content')
  @ApiOperation({ summary: 'Stream uploaded source file bytes' })
  async content(
    @Param('sourceId') sourceId: string,
    @Param('fileId') fileId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = await this.files.content(sourceId, fileId);
    const data = Buffer.from(file.data);
    await reply
      .header('Content-Type', file.declaredMimeType)
      .header('Content-Length', String(data.length))
      .header(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      )
      .send(data);
  }

  @Delete(':fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an uploaded source file' })
  delete(@Param('sourceId') sourceId: string, @Param('fileId') fileId: string) {
    return this.files.delete(sourceId, fileId);
  }
}
