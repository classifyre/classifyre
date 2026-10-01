import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import {
  AUGMENTATION_OPTIONAL_FUNCTIONS,
  AUGMENTATION_REQUIRED_FUNCTIONS,
  DETECTOR_OPTIONAL_FUNCTIONS,
  DETECTOR_REQUIRED_FUNCTIONS,
  NotebookService,
  OPTIONAL_FUNCTIONS,
  REQUIRED_FUNCTIONS,
  type NotebookScope,
  type TemplateScope,
} from './notebook.service';
import { NotebookExecutionService } from './notebook-execution.service';
import { BlockWhenPaused } from '../namespace/block-when-paused.decorator';
import {
  CreateDetectorNotebookExecutionDto,
  CreateNotebookExecutionDto,
  NotebookDto,
  NotebookExecutionDto,
  NotebookScaffoldDto,
  NotebookTemplateDto,
  UpdateNotebookDto,
  UpdateNotebookResponseDto,
} from './dto/notebook.dto';

@ApiTags('Notebooks')
@Controller()
export class NotebookController {
  constructor(
    private readonly notebooks: NotebookService,
    private readonly executions: NotebookExecutionService,
  ) {}

  @Get('notebooks/scaffold')
  @ApiOperation({
    summary: 'The starter cells and the functions a notebook must define',
  })
  @ApiResponse({ status: 200, type: NotebookScaffoldDto })
  @ApiQuery({
    name: 'scope',
    required: false,
    enum: ['connector', 'augmentation', 'detector'],
  })
  scaffold(@Query('scope') scope?: TemplateScope): NotebookScaffoldDto {
    const resolved = this.resolveTemplateScope(scope);
    const [required, optional] =
      resolved === 'augmentation'
        ? [AUGMENTATION_REQUIRED_FUNCTIONS, AUGMENTATION_OPTIONAL_FUNCTIONS]
        : resolved === 'detector'
          ? [DETECTOR_REQUIRED_FUNCTIONS, DETECTOR_OPTIONAL_FUNCTIONS]
          : [REQUIRED_FUNCTIONS, OPTIONAL_FUNCTIONS];
    return {
      ...this.notebooks.scaffold(resolved),
      requiredFunctions: required,
      optionalFunctions: optional,
    };
  }

  @Get('notebooks/templates')
  @ApiOperation({
    summary: 'Worked notebooks an author can start from or borrow cells out of',
  })
  @ApiResponse({ status: 200, type: [NotebookTemplateDto] })
  @ApiQuery({
    name: 'scope',
    required: false,
    enum: ['connector', 'augmentation', 'detector'],
  })
  templates(@Query('scope') scope?: TemplateScope): NotebookTemplateDto[] {
    return this.notebooks.templates(this.resolveTemplateScope(scope));
  }

  @Get('sources/:sourceId/notebook')
  @ApiOperation({ summary: "Read a source's notebook" })
  @ApiResponse({ status: 200, type: NotebookDto })
  @ApiQuery({
    name: 'scope',
    required: false,
    enum: ['connector', 'augmentation'],
  })
  get(
    @Param('sourceId') sourceId: string,
    @Query('scope') scope?: NotebookScope,
  ) {
    return this.notebooks.get(sourceId, this.resolveScope(scope));
  }

  @Put('sources/:sourceId/notebook')
  @ApiOperation({
    summary: 'Save a notebook',
    description:
      'Rejected with 409 when someone else saved since baseRevision, so two editors cannot silently overwrite each other.',
  })
  @ApiResponse({ status: 200, type: UpdateNotebookResponseDto })
  @ApiResponse({ status: 409, description: 'The notebook has moved on' })
  @ApiQuery({
    name: 'scope',
    required: false,
    enum: ['connector', 'augmentation'],
  })
  update(
    @Param('sourceId') sourceId: string,
    @Body() dto: UpdateNotebookDto,
    @Query('scope') scope?: NotebookScope,
  ) {
    return this.notebooks.update(sourceId, dto, this.resolveScope(scope));
  }

  @Get('sources/:sourceId/notebook/export')
  @ApiOperation({
    summary: 'The notebook as an ordinary Python module',
    description:
      'Uses the `# %%` convention, so the result runs under plain `python workflow.py` with no notebook runtime.',
  })
  @ApiQuery({
    name: 'scope',
    required: false,
    enum: ['connector', 'augmentation'],
  })
  async exportPython(
    @Param('sourceId') sourceId: string,
    @Res() reply: FastifyReply,
    @Query('scope') scope?: NotebookScope,
  ): Promise<void> {
    const source = await this.notebooks.exportPython(
      sourceId,
      this.resolveScope(scope),
    );
    void reply
      .header('Content-Type', 'text/x-python; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="workflow.py"')
      .send(source);
  }

  private resolveTemplateScope(scope?: string): TemplateScope {
    return scope === 'detector' ? 'detector' : this.resolveScope(scope);
  }

  private resolveScope(scope?: string): NotebookScope {
    if (scope === undefined || scope === 'connector') return 'connector';
    if (scope === 'augmentation') return 'augmentation';
    throw new BadRequestException(
      `Unknown notebook scope '${scope}'. Expected 'connector' or 'augmentation'.`,
    );
  }

  @BlockWhenPaused()
  @Post('sources/:sourceId/notebook/executions')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Start a notebook execution',
    description:
      'Returns immediately; poll GET /notebook/executions/:id for the result.',
  })
  @ApiResponse({ status: 202, type: NotebookExecutionDto })
  async createExecution(
    @Param('sourceId') sourceId: string,
    @Body() dto: CreateNotebookExecutionDto,
  ) {
    const execution = await this.executions.create(sourceId, dto);
    return this.executions.toDto(execution);
  }

  @Get('sources/:sourceId/notebook/executions')
  @ApiOperation({ summary: 'Recent executions for a source' })
  @ApiResponse({ status: 200, type: [NotebookExecutionDto] })
  async listExecutions(
    @Param('sourceId') sourceId: string,
    @Query('limit') limit?: string,
  ) {
    const executions = await this.notebooks.listExecutions(
      sourceId,
      limit ? Number(limit) : undefined,
    );
    return executions.map((execution) => this.executions.toDto(execution));
  }

  @BlockWhenPaused()
  @Post('custom-detectors/:detectorId/notebook/executions')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: "Run a code detector's notebook",
    description:
      'Code detectors (pipeline type CODE_DETECTOR) only. "cell"/"all" replay the cells with the detector\'s variables, secrets and files; "preview_detect" runs setup()/detect() on a real asset of sourceId (or a small sample) and reports the findings without recording anything. Returns immediately; poll GET /notebook/executions/:id.',
  })
  @ApiResponse({ status: 202, type: NotebookExecutionDto })
  async createDetectorExecution(
    @Param('detectorId') detectorId: string,
    @Body() dto: CreateDetectorNotebookExecutionDto,
  ) {
    const execution = await this.executions.createForDetector(detectorId, dto);
    return this.executions.toDto(execution);
  }

  @Get('custom-detectors/:detectorId/notebook/executions')
  @ApiOperation({ summary: "Recent executions of a code detector's notebook" })
  @ApiResponse({ status: 200, type: [NotebookExecutionDto] })
  async listDetectorExecutions(
    @Param('detectorId') detectorId: string,
    @Query('limit') limit?: string,
  ) {
    const executions = await this.executions.listForDetector(
      detectorId,
      limit ? Number(limit) : undefined,
    );
    return executions.map((execution) => this.executions.toDto(execution));
  }

  @Get('notebook/executions/:executionId')
  @ApiOperation({ summary: 'Poll one execution' })
  @ApiResponse({ status: 200, type: NotebookExecutionDto })
  async getExecution(@Param('executionId') executionId: string) {
    return this.executions.toDto(
      await this.notebooks.getExecution(executionId),
    );
  }

  @Post('notebook/executions/:executionId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stop a running execution',
    description:
      'Ends the process or deletes the Job. A cell that ignores ctx.should_abort is stopped this way and no other.',
  })
  cancel(@Param('executionId') executionId: string) {
    return this.executions.cancel(executionId);
  }
}
