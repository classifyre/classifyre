import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CaseLeadsService } from '../case-leads.service';
import { BlockWhenPaused } from '../namespace/block-when-paused.decorator';
import { ActorName } from '../actor-name.decorator';
import {
  CaseLeadDto,
  GenerateCaseLeadsResponseDto,
  ListCaseLeadsQueryDto,
  ProposeCaseLeadDto,
  ReviewCaseLeadDto,
  ReviewCaseLeadsDto,
  ReviewCaseLeadsResponseDto,
} from '../dto/case-lead.dto';

@ApiTags('cases')
@Controller('cases/:caseId/leads')
export class CaseLeadsController {
  constructor(private readonly leads: CaseLeadsService) {}

  @Get()
  @ApiOperation({ summary: 'List leads (exploration candidates) for a case' })
  @ApiOkResponse({ type: [CaseLeadDto] })
  list(@Param('caseId') caseId: string, @Query() query: ListCaseLeadsQueryDto) {
    return this.leads.list(caseId, query.status);
  }

  @Post()
  @ApiOperation({ summary: 'Propose a finding as a lead for this case' })
  propose(
    @Param('caseId') caseId: string,
    @Body() dto: ProposeCaseLeadDto,
    @ActorName() actor: string | undefined,
  ) {
    return this.leads.propose(caseId, {
      findingId: dto.findingId,
      rationale: dto.rationale,
      origin: 'MANUAL',
      proposedBy: dto.proposedBy ?? actor ?? 'user',
    });
  }

  @BlockWhenPaused()
  @Post('generate')
  @ApiOperation({
    summary:
      'Refresh leads now (similar content, watch answers, look-alike documents). The case also refreshes them by itself when its evidence or watches change',
  })
  @ApiOkResponse({ type: GenerateCaseLeadsResponseDto })
  generate(
    @Param('caseId') caseId: string,
    @ActorName() actor: string | undefined,
  ) {
    return this.leads.generate(caseId, actor ?? 'user');
  }

  @Post('review')
  @ApiOperation({
    summary: 'Accept or dismiss several leads with one decision',
  })
  @ApiOkResponse({ type: ReviewCaseLeadsResponseDto })
  reviewMany(
    @Param('caseId') caseId: string,
    @Body() dto: ReviewCaseLeadsDto,
    @ActorName() actor: string | undefined,
  ) {
    // No global ValidationPipe: the body is normalised here, not trusted.
    const ids = Array.isArray(dto?.leadIds)
      ? dto.leadIds.filter((id): id is string => typeof id === 'string')
      : [];
    return this.leads.reviewMany(
      caseId,
      ids.slice(0, 200),
      dto?.action,
      dto?.reviewedBy ?? actor ?? 'user',
      dto?.reason,
    );
  }

  @Post(':leadId/review')
  @ApiOperation({ summary: 'Accept a lead into evidence, or dismiss it' })
  review(
    @Param('caseId') caseId: string,
    @Param('leadId') leadId: string,
    @Body() dto: ReviewCaseLeadDto,
    @ActorName() actor: string | undefined,
  ) {
    return this.leads.review(
      caseId,
      leadId,
      dto.action,
      dto.reviewedBy ?? actor ?? 'user',
      dto.reason,
    );
  }
}
