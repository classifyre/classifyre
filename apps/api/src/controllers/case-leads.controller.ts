import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CaseLeadsService } from '../case-leads.service';
import {
  CaseLeadDto,
  GenerateCaseLeadsResponseDto,
  ListCaseLeadsQueryDto,
  ProposeCaseLeadDto,
  ReviewCaseLeadDto,
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
  propose(@Param('caseId') caseId: string, @Body() dto: ProposeCaseLeadDto) {
    return this.leads.propose(caseId, {
      findingId: dto.findingId,
      rationale: dto.rationale,
      origin: 'MANUAL',
      proposedBy: dto.proposedBy ?? 'user',
    });
  }

  @Post('generate')
  @ApiOperation({
    summary:
      'Generate leads from case evidence (semantic neighbours + linked-inquiry matches)',
  })
  @ApiOkResponse({ type: GenerateCaseLeadsResponseDto })
  generate(@Param('caseId') caseId: string) {
    return this.leads.generate(caseId);
  }

  @Post(':leadId/review')
  @ApiOperation({ summary: 'Accept a lead into evidence, or dismiss it' })
  review(
    @Param('caseId') caseId: string,
    @Param('leadId') leadId: string,
    @Body() dto: ReviewCaseLeadDto,
  ) {
    return this.leads.review(
      caseId,
      leadId,
      dto.action,
      dto.reviewedBy ?? 'user',
      dto.reason,
    );
  }
}
