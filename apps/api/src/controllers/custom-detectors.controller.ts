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
import type { FastifyRequest } from 'fastify';
import { CustomDetectorsService } from '../custom-detectors.service';
import { ListCustomDetectorsQueryDto } from '../dto/list-custom-detectors-query.dto';
import { CustomDetectorResponseDto } from '../dto/custom-detector-response.dto';
import { CreateCustomDetectorDto } from '../dto/create-custom-detector.dto';
import { UpdateCustomDetectorDto } from '../dto/update-custom-detector.dto';
import { TrainCustomDetectorDto } from '../dto/train-custom-detector.dto';
import { CustomDetectorTrainingRunDto } from '../dto/custom-detector-training-run.dto';
import { CustomDetectorExampleDto } from '../dto/custom-detector-example.dto';
import { ParseTrainingExamplesResponseDto } from '../dto/parse-training-examples-response.dto';
import { AllowInDemoMode } from '../demo-mode.decorator';

@ApiTags('Custom Detectors')
@Controller('custom-detectors')
export class CustomDetectorsController {
  constructor(
    private readonly customDetectorsService: CustomDetectorsService,
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
      'Accepts csv/tsv/txt/md/log/json/xlsx and returns normalized label/text training examples.',
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
        if (part.fieldname === 'labelColumn' && typeof part.value === 'string') {
          labelColumn = part.value || undefined;
        } else if (part.fieldname === 'textColumn' && typeof part.value === 'string') {
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
