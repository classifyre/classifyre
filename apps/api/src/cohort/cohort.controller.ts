import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ReadOnlyEndpoint } from '../db/read-only-endpoint.decorator';
import { CohortWeightsService } from './cohort-weights.service';
import { CohortWeightsPreviewDto } from './cohort-weights.dto';

@ReadOnlyEndpoint()
@ApiTags('Sources')
@Controller('sources')
export class CohortController {
  constructor(private readonly cohortWeights: CohortWeightsService) {}

  @Get(':id/cohort-weights')
  @ApiOperation({
    summary: "Preview the band split of a source's cohorts for its next run",
    description:
      'For each ctx.cohort() the source walks: the weights its next run would use, ' +
      'why (no_history, cold_start, measured or fixed), the per-band rates they ' +
      'came from, and the yield of recent runs.',
  })
  @ApiParam({ name: 'id', description: 'Source UUID' })
  @ApiResponse({ status: 200, type: [CohortWeightsPreviewDto] })
  preview(@Param('id') id: string): Promise<CohortWeightsPreviewDto[]> {
    return this.cohortWeights.preview(id);
  }
}
