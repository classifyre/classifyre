import {
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
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import {
  NotebookService,
  OPTIONAL_FUNCTIONS,
  REQUIRED_FUNCTIONS,
} from './notebook.service';
import { NotebookExecutionService } from './notebook-execution.service';
import {
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
  scaffold(): NotebookScaffoldDto {
    return {
      ...this.notebooks.scaffold(),
      requiredFunctions: REQUIRED_FUNCTIONS,
      optionalFunctions: OPTIONAL_FUNCTIONS,
    };
  }

  @Get('notebooks/templates')
  @ApiOperation({
    summary: 'Worked notebooks an author can start from or borrow cells out of',
  })
  @ApiResponse({ status: 200, type: [NotebookTemplateDto] })
  templates(): NotebookTemplateDto[] {
    return this.notebooks.templates();
  }

  @Get('sources/:sourceId/notebook')
  @ApiOperation({ summary: "Read a CUSTOM source's notebook" })
  @ApiResponse({ status: 200, type: NotebookDto })
  get(@Param('sourceId') sourceId: string) {
    return this.notebooks.get(sourceId);
  }

  @Put('sources/:sourceId/notebook')
  @ApiOperation({
    summary: 'Save a notebook',
    description:
      'Rejected with 409 when someone else saved since baseRevision, so two editors cannot silently overwrite each other.',
  })
  @ApiResponse({ status: 200, type: UpdateNotebookResponseDto })
  @ApiResponse({ status: 409, description: 'The notebook has moved on' })
  update(@Param('sourceId') sourceId: string, @Body() dto: UpdateNotebookDto) {
    return this.notebooks.update(sourceId, dto);
  }

  @Get('sources/:sourceId/notebook/export')
  @ApiOperation({
    summary: 'The notebook as an ordinary Python module',
    description:
      'Uses the `# %%` convention, so the result runs under plain `python workflow.py` with no notebook runtime.',
  })
  async exportPython(
    @Param('sourceId') sourceId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const source = await this.notebooks.exportPython(sourceId);
    void reply
      .header('Content-Type', 'text/x-python; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="workflow.py"')
      .send(source);
  }

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
