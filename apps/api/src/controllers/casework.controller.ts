import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CaseworkSummaryService } from '../casework-summary.service';
import { CaseworkSummaryDto } from '../dto/casework-summary.dto';
import { ReadOnlyEndpoint } from '../db/read-only-endpoint.decorator';

@ApiTags('cases')
@Controller('casework')
export class CaseworkController {
  constructor(private readonly casework: CaseworkSummaryService) {}

  @Get('summary')
  @ReadOnlyEndpoint()
  @ApiOperation({
    summary: 'Counts and recent activity across cases, inquiries and leads',
    description:
      'What is being investigated right now, for the workspace dashboard. ' +
      'Grouped counts plus the five most recent cases and the five inquiries ' +
      'with the most unseen matches — no scan over findings.',
  })
  @ApiResponse({ status: 200, type: CaseworkSummaryDto })
  summary(): Promise<CaseworkSummaryDto> {
    return this.casework.getSummary();
  }
}
