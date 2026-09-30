import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import '@fastify/multipart';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CustomDetectorsService } from '../custom-detectors.service';
import { ListCustomDetectorsQueryDto } from '../dto/list-custom-detectors-query.dto';
import { CustomDetectorResponseDto } from '../dto/custom-detector-response.dto';
import { CreateCustomDetectorDto } from '../dto/create-custom-detector.dto';
import { UpdateCustomDetectorDto } from '../dto/update-custom-detector.dto';
import { TrainCustomDetectorDto } from '../dto/train-custom-detector.dto';
import { CustomDetectorTrainingRunDto } from '../dto/custom-detector-training-run.dto';
import { CustomDetectorExampleDto } from '../dto/custom-detector-example.dto';
import { ParseTrainingExamplesResponseDto } from '../dto/parse-training-examples-response.dto';
import {
  SaveTrainingExamplesDto,
  TrainingExampleDto,
  TrainingExamplesStatsDto,
} from '../dto/training-example.dto';
import { AllowInDemoMode } from '../demo-mode.decorator';
import { RetireOutOfScopeFindingsDto } from '../dto/retire-out-of-scope-findings.dto';
import { FindingBulkOperationDto } from '../findings-bulk/finding-bulk-operation.dto';
import { FindingBulkOperationService } from '../findings-bulk/finding-bulk-operation.service';
import { RetireOutOfScopeService } from '../findings-bulk/retire-out-of-scope.service';
import { BlockWhenPaused } from '../namespace/block-when-paused.decorator';
import { CustomDetectorFilesService } from '../custom-detector-files.service';
import { CustomDetectorFileDto } from '../dto/custom-detector-file.dto';

@ApiTags('Custom Detectors')
@Controller('custom-detectors')
export class CustomDetectorsController {
  constructor(
    private readonly customDetectorsService: CustomDetectorsService,
    private readonly retireOutOfScope: RetireOutOfScopeService,
    private readonly findingBulkOperations: FindingBulkOperationService,
    private readonly detectorFiles: CustomDetectorFilesService,
  ) {}

  @Get('examples')
  @ApiOperation({ summary: 'List custom detector starter examples' })
  @ApiResponse({
    status: 200,
    type: [CustomDetectorExampleDto],
  })
  listExamples(): CustomDetectorExampleDto[] {
    return this.customDetectorsService.listExamples();
  }

  @Get()
  @ApiOperation({ summary: 'List custom detectors' })
  @ApiQuery({
    name: 'includeInactive',
    required: false,
    description: 'Whether to include inactive detectors',
  })
  @ApiResponse({
    status: 200,
    type: [CustomDetectorResponseDto],
  })
  async list(
    @Query() query: ListCustomDetectorsQueryDto,
  ): Promise<CustomDetectorResponseDto[]> {
    return this.customDetectorsService.list(query);
  }

  @Post()
  @ApiOperation({ summary: 'Create custom detector' })
  @ApiBody({ type: CreateCustomDetectorDto })
  @ApiResponse({ status: 201, type: CustomDetectorResponseDto })
  async create(
    @Body() dto: CreateCustomDetectorDto,
  ): Promise<CustomDetectorResponseDto> {
    return this.customDetectorsService.create(dto);
  }

  @AllowInDemoMode()
  @Post('training-examples/parse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Parse uploaded training examples file',
    description:
      'Accepts csv/tsv/txt/md/log/json and returns normalized label/text training examples.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Training data file to parse',
        },
      },
    },
  })
  @ApiResponse({ status: 200, type: ParseTrainingExamplesResponseDto })
  async parseTrainingExamples(
    @Req() req: FastifyRequest,
  ): Promise<ParseTrainingExamplesResponseDto> {
    let fileBuffer: Buffer | undefined;
    let fileName = 'training-data.txt';
    let labelColumn: string | undefined;
    let textColumn: string | undefined;

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        fileBuffer = await part.toBuffer();
        fileName = part.filename ?? fileName;
      } else if (part.type === 'field') {
        if (
          part.fieldname === 'labelColumn' &&
          typeof part.value === 'string'
        ) {
          labelColumn = part.value || undefined;
        } else if (
          part.fieldname === 'textColumn' &&
          typeof part.value === 'string'
        ) {
          textColumn = part.value || undefined;
        }
      }
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException('No file uploaded.');
    }

    return this.customDetectorsService.parseTrainingExamplesUpload(
      fileBuffer,
      fileName,
      { labelColumn, textColumn },
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get custom detector by ID' })
  @ApiParam({ name: 'id', description: 'Custom detector UUID' })
  @ApiResponse({ status: 200, type: CustomDetectorResponseDto })
  async getById(@Param('id') id: string): Promise<CustomDetectorResponseDto> {
    return this.customDetectorsService.getById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update custom detector' })
  @ApiParam({ name: 'id', description: 'Custom detector UUID' })
  @ApiBody({ type: UpdateCustomDetectorDto })
  @ApiResponse({ status: 200, type: CustomDetectorResponseDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomDetectorDto,
  ): Promise<CustomDetectorResponseDto> {
    return this.customDetectorsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete custom detector' })
  @ApiParam({ name: 'id', description: 'Custom detector UUID' })
  @ApiResponse({ status: 200, schema: { example: { deleted: true } } })
  async delete(@Param('id') id: string): Promise<{ deleted: true }> {
    return this.customDetectorsService.delete(id);
  }

  @Get(':id/files')
  @ApiOperation({
    summary: "List a code detector's uploaded files",
    description:
      'Code detectors (CUSTOM_DETECTOR) read these with ctx.file(name).',
  })
  @ApiResponse({ status: 200, type: [CustomDetectorFileDto] })
  listFiles(@Param('id') id: string) {
    return this.detectorFiles.list(id);
  }

  @Post(':id/files')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload one file to a code detector',
    description:
      'A screening list, a model, a reference table. A file with a name the detector already has is replaced. Bumps the detector version.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 201, type: CustomDetectorFileDto })
  async uploadFile(@Param('id') id: string, @Req() request: FastifyRequest) {
    let upload:
      | { data: Buffer; fileName: string; declaredMimeType: string }
      | undefined;
    for await (const part of request.parts()) {
      if (part.type !== 'file') continue;
      if (upload) {
        throw new BadRequestException('Upload exactly one file per request');
      }
      upload = {
        data: await part.toBuffer(),
        fileName: part.filename ?? 'upload',
        declaredMimeType: part.mimetype ?? 'application/octet-stream',
      };
    }
    if (!upload) throw new BadRequestException('No file uploaded');
    return this.detectorFiles.create({ customDetectorId: id, ...upload });
  }

  @Get(':id/files/:fileId/content')
  @ApiOperation({ summary: "Stream a code detector file's bytes" })
  async fileContent(
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = await this.detectorFiles.content(id, fileId);
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

  @Delete(':id/files/:fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a code detector file' })
  deleteFile(@Param('id') id: string, @Param('fileId') fileId: string) {
    return this.detectorFiles.delete(id, fileId);
  }

  @Post(':id/retire-out-of-scope-findings')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Retire findings this detector can no longer produce',
    description:
      'After narrowing scope.asset_kinds or removing regex patterns, the old ' +
      'findings stay OPEN. Both steps run in the background; follow the ' +
      'returned operation with GET /findings/bulk-operations/:operationId. ' +
      '(1) dryRun (default) counts candidates by reason, case citations and ' +
      'inquiry matches. (2) dryRun: false with fromOperationId, expectedCount ' +
      'and confirm: true resolves them. Findings a case cites are never ' +
      'retired; findings an ACTIVE inquiry watches only with includeInquiryWatched.',
  })
  @ApiParam({ name: 'id', description: 'Custom detector UUID' })
  @ApiBody({ type: RetireOutOfScopeFindingsDto })
  @ApiResponse({ status: 202, type: FindingBulkOperationDto })
  async retireOutOfScopeFindings(
    @Param('id') id: string,
    @Body() dto: RetireOutOfScopeFindingsDto,
  ): Promise<FindingBulkOperationDto> {
    const body = dto ?? {};
    const operation =
      body.dryRun === false
        ? await this.retireOutOfScope.startRetire(id, body, {
            allowInquiryOverride: true,
          })
        : await this.retireOutOfScope.startDryRun(id, body);
    return this.findingBulkOperations.toDto(operation);
  }

  // ── Training examples ──────────────────────────────────────────────────────

  @Get(':id/training-examples')
  @ApiOperation({ summary: 'List stored training examples for a detector' })
  @ApiParam({ name: 'id', description: 'Custom detector UUID' })
  @ApiResponse({ status: 200, type: [TrainingExampleDto] })
  async listTrainingExamples(
    @Param('id') id: string,
  ): Promise<TrainingExampleDto[]> {
    return this.customDetectorsService.listTrainingExamples(id);
  }

  @Get(':id/training-examples/stats')
  @ApiOperation({ summary: 'Get training example counts grouped by label' })
  @ApiParam({ name: 'id', description: 'Custom detector UUID' })
  @ApiResponse({ status: 200, type: TrainingExamplesStatsDto })
  async trainingExamplesStats(
    @Param('id') id: string,
  ): Promise<TrainingExamplesStatsDto> {
    return this.customDetectorsService.getTrainingExamplesStats(id);
  }

  @Post(':id/training-examples')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Save training examples for a detector',
    description:
      'Appends (or replaces) labeled examples. Set clearExisting=true to wipe previous examples first.',
  })
  @ApiParam({ name: 'id', description: 'Custom detector UUID' })
  @ApiBody({ type: SaveTrainingExamplesDto })
  @ApiResponse({ status: 200, schema: { example: { saved: 42 } } })
  async saveTrainingExamples(
    @Param('id') id: string,
    @Body() dto: SaveTrainingExamplesDto,
  ): Promise<{ saved: number }> {
    return this.customDetectorsService.saveTrainingExamples(id, dto);
  }

  @Delete(':id/training-examples')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete all training examples for a detector' })
  @ApiParam({ name: 'id', description: 'Custom detector UUID' })
  @ApiResponse({ status: 200, schema: { example: { deleted: 42 } } })
  async clearTrainingExamples(
    @Param('id') id: string,
  ): Promise<{ deleted: number }> {
    return this.customDetectorsService.clearTrainingExamples(id);
  }

  @Delete(':id/training-examples/:exampleId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a single training example' })
  @ApiParam({ name: 'id', description: 'Custom detector UUID' })
  @ApiParam({ name: 'exampleId', description: 'Training example UUID' })
  @ApiResponse({ status: 200, schema: { example: { deleted: true } } })
  async deleteTrainingExample(
    @Param('id') id: string,
    @Param('exampleId') exampleId: string,
  ): Promise<{ deleted: true }> {
    await this.customDetectorsService.deleteTrainingExample(id, exampleId);
    return { deleted: true };
  }

  // ── Training ───────────────────────────────────────────────────────────────

  @BlockWhenPaused()
  @Post(':id/train')
  @ApiOperation({ summary: 'Trigger custom detector training' })
  @ApiParam({ name: 'id', description: 'Custom detector UUID' })
  @ApiBody({ type: TrainCustomDetectorDto, required: false })
  @ApiResponse({ status: 200, type: CustomDetectorTrainingRunDto })
  async train(
    @Param('id') id: string,
    @Body() dto: TrainCustomDetectorDto,
  ): Promise<CustomDetectorTrainingRunDto> {
    return this.customDetectorsService.train(id, dto ?? {});
  }

  @Get(':id/training-history')
  @ApiOperation({ summary: 'List training history for custom detector' })
  @ApiParam({ name: 'id', description: 'Custom detector UUID' })
  @ApiQuery({
    name: 'take',
    required: false,
    description: 'Maximum history rows to return',
  })
  @ApiResponse({ status: 200, type: [CustomDetectorTrainingRunDto] })
  async trainingHistory(
    @Param('id') id: string,
    @Query('take') take?: string,
  ): Promise<CustomDetectorTrainingRunDto[]> {
    const parsed = Number(take);
    const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
    return this.customDetectorsService.getTrainingHistory(id, limit);
  }
}
