import {
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
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CaseThreadsService } from '../case-threads.service';
import { CaseActivityService } from '../case-activity.service';
import {
  AddThreadEntryDto,
  CreateThreadDto,
  LinkThreadSupportDto,
  ThreadEntriesResponseDto,
  ThreadResponseDto,
  UpdateThreadDto,
} from '../dto/case-thread.dto';
import { CaseTimelineResponseDto } from '../dto/case-activity.dto';

// ─── Timeline ─────────────────────────────────────────────────────────────────

@ApiTags('cases')
@Controller()
export class CaseTimelineController {
  constructor(private readonly activity: CaseActivityService) {}

  @Get('cases/:caseId/timeline')
  @ApiOperation({
    summary: 'Paginated unified case activity feed (newest first)',
  })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, type: CaseTimelineResponseDto })
  async getTimeline(
    @Param('caseId') caseId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<CaseTimelineResponseDto> {
    return this.activity.getTimeline(
      caseId,
      cursor,
      limit ? Number(limit) : 50,
    );
  }
}

// ─── Threads ──────────────────────────────────────────────────────────────────

@ApiTags('threads')
@Controller()
export class CaseThreadsController {
  constructor(private readonly threads: CaseThreadsService) {}

  @Get('cases/:caseId/threads')
  @ApiOperation({
    summary: 'List threads (hypothesis + discussion) for a case',
  })
  @ApiResponse({ status: 200, type: [ThreadResponseDto] })
  async list(@Param('caseId') caseId: string): Promise<ThreadResponseDto[]> {
    return this.threads.list(caseId);
  }

  @Post('cases/:caseId/threads')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a thread (hypothesis or discussion)' })
  @ApiResponse({ status: 201, type: ThreadResponseDto })
  async create(
    @Param('caseId') caseId: string,
    @Body() dto: CreateThreadDto,
  ): Promise<ThreadResponseDto> {
    return this.threads.create(caseId, dto);
  }

  @Patch('threads/:id')
  @ApiOperation({
    summary: 'Update thread title / status / confidence / color',
  })
  @ApiResponse({ status: 200, type: ThreadResponseDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateThreadDto,
  ): Promise<ThreadResponseDto> {
    return this.threads.update(id, dto);
  }

  @Delete('threads/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a thread' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.threads.remove(id);
  }

  @Post('threads/:id/entries')
  @ApiOperation({
    summary: 'Add a note, statement revision, or status entry to a thread',
  })
  @ApiResponse({ status: 200, type: ThreadResponseDto })
  async addEntry(
    @Param('id') id: string,
    @Body() dto: AddThreadEntryDto,
  ): Promise<ThreadResponseDto> {
    return this.threads.addEntry(id, dto);
  }

  @Get('threads/:id/entries')
  @ApiOperation({ summary: 'Paginated thread entry history' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, type: ThreadEntriesResponseDto })
  async getEntries(
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<ThreadEntriesResponseDto> {
    return this.threads.getEntries(id, cursor, limit ? Number(limit) : 50);
  }

  @Post('threads/:id/support')
  @ApiOperation({ summary: 'Link evidence or finding to a thread' })
  @ApiResponse({ status: 200, type: ThreadResponseDto })
  async linkSupport(
    @Param('id') id: string,
    @Body() dto: LinkThreadSupportDto,
  ): Promise<ThreadResponseDto> {
    return this.threads.linkSupport(id, dto);
  }

  @Delete('threads/:id/support/:linkId')
  @ApiOperation({ summary: 'Unlink evidence or finding from a thread' })
  @ApiResponse({ status: 200, type: ThreadResponseDto })
  async unlinkSupport(
    @Param('id') id: string,
    @Param('linkId') linkId: string,
  ): Promise<ThreadResponseDto> {
    return this.threads.unlinkSupport(id, linkId);
  }
}
