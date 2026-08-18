import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InternalOnly } from '../internal-only.decorator';
import { CustomSourceNotebookService } from './custom-source-notebook.service';
import { CustomSourceSessionService } from './custom-source-session.service';
import {
  NotebookDto,
  NotebookRevisionDto,
  NotebookSessionDto,
  SaveNotebookDto,
  SaveNotebookResponseDto,
} from './dto/notebook.dto';

@ApiTags('Custom Sources')
@Controller('sources/:sourceId')
export class CustomSourcesController {
  constructor(
    private readonly notebooks: CustomSourceNotebookService,
    private readonly sessions: CustomSourceSessionService,
  ) {}

  @Get('notebook')
  @ApiOperation({
    summary: "Read a custom source's notebook (the newest revision by default)",
  })
  @ApiQuery({
    name: 'revision',
    required: false,
    description: 'Read a specific revision instead of the newest',
  })
  @ApiResponse({ status: 200, type: NotebookDto })
  getNotebook(
    @Param('sourceId') sourceId: string,
    @Query('revision') revision?: string,
  ): Promise<NotebookDto> {
    const parsed = revision === undefined ? undefined : Number(revision);
    return this.notebooks.get(
      sourceId,
      Number.isFinite(parsed) ? parsed : undefined,
    );
  }

  @Put('notebook')
  // Written by the notebook session running inside a CLI job, not by a browser.
  @InternalOnly()
  @ApiOperation({ summary: 'Save a new notebook revision' })
  @ApiResponse({ status: 200, type: SaveNotebookResponseDto })
  saveNotebook(
    @Param('sourceId') sourceId: string,
    @Body() body: SaveNotebookDto,
  ): Promise<SaveNotebookResponseDto> {
    return this.notebooks.save(sourceId, body?.content, body?.message ?? '');
  }

  @Get('notebook/revisions')
  @ApiOperation({ summary: 'List saved notebook revisions, newest first' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, type: [NotebookRevisionDto] })
  listRevisions(
    @Param('sourceId') sourceId: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = Number(limit);
    return this.notebooks.listRevisions(
      sourceId,
      Number.isFinite(parsed) && parsed > 0 ? parsed : 50,
    );
  }

  @Get('session')
  @ApiOperation({ summary: 'Current notebook editing session, if any' })
  @ApiResponse({ status: 200, type: NotebookSessionDto })
  getSession(@Param('sourceId') sourceId: string) {
    return this.sessions.get(sourceId);
  }

  @Post('session')
  @ApiOperation({
    summary:
      'Start a notebook editing session (returns the running one if any)',
  })
  @ApiResponse({ status: 201, type: NotebookSessionDto })
  startSession(@Param('sourceId') sourceId: string) {
    return this.sessions.start(sourceId);
  }

  @Delete('session')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Stop the notebook editing session' })
  stopSession(@Param('sourceId') sourceId: string): Promise<void> {
    return this.sessions.stop(sourceId);
  }
}
