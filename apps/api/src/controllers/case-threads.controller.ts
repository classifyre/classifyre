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
import { CaseActivityType } from '@prisma/client';
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
import { ActorName } from '../actor-name.decorator';
import {
  ThreadRemovalPreviewDto,
  ThreadRemovalResultDto,
} from '../dto/case-hypothesis-rules.dto';
import { CaseTimelineResponseDto } from '../dto/case-activity.dto';
import { activityTypes } from '../activity-page';

// ─── Timeline ─────────────────────────────────────────────────────────────────

@ApiTags('cases')
@Controller()
export class CaseTimelineController {
  constructor(private readonly activity: CaseActivityService) {}

  @Get('cases/:caseId/timeline')
  @ApiOperation({
    summary: 'Paginated unified case activity feed (newest first)',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'The id of the last entry of the previous page',
  })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({
    name: 'types',
    required: false,
    description:
      'Only these activity types (comma-separated), e.g. FINDINGS_ESCALATED,FINDINGS_AUTO_REMOVED',
  })
  @ApiQuery({
    name: 'inquiryId',
    required: false,
    description: 'Only entries about this linked watch (inquiry)',
  })
  @ApiQuery({
    name: 'until',
    required: false,
    description:
      'An entry id the page must reach: the page runs from the newest entry down to and including it (at most 1000 entries)',
  })
  @ApiResponse({ status: 200, type: CaseTimelineResponseDto })
  async getTimeline(
    @Param('caseId') caseId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('types') types?: string,
    @Query('inquiryId') inquiryId?: string,
    @Query('until') until?: string,
  ): Promise<CaseTimelineResponseDto> {
    return this.activity.getTimeline(
      caseId,
      cursor || undefined,
      limit ? Number(limit) : 50,
      {
        types: activityTypes(types, CaseActivityType),
        inquiryId: inquiryId || undefined,
        until: until || undefined,
      },
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

  @Get('threads/:id/removal-preview')
  @ApiOperation({
    summary:
      'What deleting a hypothesis together with its evidence would take out of the case (writes nothing)',
  })
  @ApiResponse({ status: 200, type: ThreadRemovalPreviewDto })
  async removalPreview(
    @Param('id') id: string,
  ): Promise<ThreadRemovalPreviewDto> {
    return this.threads.previewRemoval(id);
  }

  @Delete('threads/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Delete a thread. With evidence=remove, the findings and assets linked to a hypothesis leave the case with it, except what another hypothesis is linked to and what carries a note. Default: they stay in the case and on the board.',
  })
  @ApiQuery({ name: 'evidence', required: false, enum: ['keep', 'remove'] })
  @ApiResponse({ status: 200, type: ThreadRemovalResultDto })
  async remove(
    @Param('id') id: string,
    @Query('evidence') evidence: string | undefined,
    @ActorName() actor: string | undefined,
  ): Promise<ThreadRemovalResultDto> {
    return this.threads.remove(
      id,
      { evidence: evidence === 'remove' ? 'remove' : 'keep' },
      actor,
    );
  }

  @Post('threads/:id/entries')
  @ApiOperation({
    summary: 'Add a note, statement revision, or status entry to a thread',
    // A client that addresses hypotheses by title renamed five of them by
    // posting dated revisions as STATEMENT (GENESIS field report P14).
    description:
      'A STATEMENT entry revises the claim itself: the thread title becomes the first 200 characters of its body. Use NOTE for commentary, evidence or dated review remarks that must leave the title unchanged.',
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
