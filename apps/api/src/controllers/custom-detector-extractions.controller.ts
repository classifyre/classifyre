import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { CustomDetectorExtractionsService } from '../custom-detector-extractions.service';
import { SearchExtractionsQueryDto } from '../dto/custom-detector-extraction.dto';

@Controller()
export class CustomDetectorExtractionsController {
  constructor(private readonly service: CustomDetectorExtractionsService) {}

  @Get('custom-detectors/:id/extractions')
  async search(
    @Param('id') id: string,
    @Query() query: SearchExtractionsQueryDto,
  ) {
    return this.service.search({ ...query, customDetectorId: id });
  }

  @Get('custom-detectors/:id/extractions/coverage')
  async coverage(@Param('id') id: string) {
    return this.service.getCoverage(id);
  }

  @Get('findings/:findingId/extraction')
  async getByFinding(@Param('findingId') findingId: string) {
    const result = await this.service.getByFinding(findingId);
    if (!result) {
      throw new NotFoundException(
        `No extraction found for finding ${findingId}`,
      );
    }
    return result;
  }
}
