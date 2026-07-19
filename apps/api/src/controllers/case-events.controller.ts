import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CaseEventsService } from '../case-events.service';
import {
  CaseEventDto,
  CreateCaseEventDto,
  UpdateCaseEventDto,
} from '../dto/case-event.dto';

@ApiTags('cases')
@Controller('cases/:caseId/events')
export class CaseEventsController {
  constructor(private readonly events: CaseEventsService) {}

  @Get()
  @ApiOperation({
    summary: 'List the case chronology (real-world events, ordered by date)',
  })
  @ApiOkResponse({ type: [CaseEventDto] })
  list(@Param('caseId') caseId: string) {
    return this.events.list(caseId);
  }

  @Post()
  @ApiOperation({ summary: 'Add a dated event to the case chronology' })
  @ApiOkResponse({ type: CaseEventDto })
  create(@Param('caseId') caseId: string, @Body() dto: CreateCaseEventDto) {
    return this.events.create(
      caseId,
      {
        occurredAt: dto.occurredAt,
        precision: dto.precision,
        title: dto.title,
        description: dto.description,
        confidence: dto.confidence,
        findingIds: dto.findingIds,
        evidenceIds: dto.evidenceIds,
      },
      dto.createdBy ?? 'user',
      'OPERATOR',
    );
  }

  @Patch(':eventId')
  @ApiOperation({
    summary: 'Update (and implicitly verify) a chronology event',
  })
  @ApiOkResponse({ type: CaseEventDto })
  update(
    @Param('caseId') caseId: string,
    @Param('eventId') eventId: string,
    @Body() dto: UpdateCaseEventDto,
  ) {
    return this.events.update(caseId, eventId, dto, dto.updatedBy ?? 'user');
  }

  @Delete(':eventId')
  @ApiOperation({ summary: 'Remove a chronology event' })
  remove(@Param('caseId') caseId: string, @Param('eventId') eventId: string) {
    return this.events.remove(caseId, eventId);
  }
}
