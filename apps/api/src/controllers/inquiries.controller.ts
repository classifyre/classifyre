import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { InquiriesService } from '../inquiries.service';
import {
  CreateInquiryDto,
  MatchOptionsResponseDto,
  PreviewInquiryDto,
  PreviewResponseDto,
  QueryInquiriesDto,
  QueryInquiryMatchesDto,
  InquiryListResponseDto,
  InquiryMatchListResponseDto,
  InquiryResponseDto,
  UpdateInquiryDto,
} from '../dto/inquiry.dto';

class RematchResponseDto {
  @ApiProperty({ description: 'Findings newly recorded as matches' })
  landed!: number;
}

@ApiTags('inquiries')
@Controller('inquiries')
export class InquiriesController {
  constructor(private readonly inquiries: InquiriesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an inquiry (a saved query) and seed its matches',
  })
  @ApiResponse({ status: 201, type: InquiryResponseDto })
  create(@Body() dto: CreateInquiryDto): Promise<InquiryResponseDto> {
    return this.inquiries.create(dto);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Preview findings a matcher config currently selects (no save)',
  })
  @ApiResponse({ status: 200, type: PreviewResponseDto })
  preview(@Body() dto: PreviewInquiryDto): Promise<PreviewResponseDto> {
    return this.inquiries.preview(dto);
  }

  @Get('match-options')
  @ApiOperation({
    summary:
      'Sources, custom detectors and distinct finding types for the matcher form',
  })
  @ApiQuery({ name: 'sourceIds', required: false, isArray: true, type: String })
  @ApiResponse({ status: 200, type: MatchOptionsResponseDto })
  matchOptions(
    @Query('sourceIds') sourceIds?: string | string[],
  ): Promise<MatchOptionsResponseDto> {
    const ids = Array.isArray(sourceIds)
      ? sourceIds
      : sourceIds
        ? [sourceIds]
        : undefined;
    return this.inquiries.matchOptions(ids);
  }

  @Get()
  @ApiOperation({ summary: 'List inquiries (with match counts)' })
  @ApiResponse({ status: 200, type: InquiryListResponseDto })
  list(@Query() query: QueryInquiriesDto): Promise<InquiryListResponseDto> {
    return this.inquiries.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an inquiry' })
  @ApiResponse({ status: 200, type: InquiryResponseDto })
  async findOne(@Param('id') id: string): Promise<InquiryResponseDto> {
    const found = await this.inquiries.findOne(id);
    if (!found) throw new NotFoundException(`Inquiry ${id} not found`);
    return found;
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update an inquiry (matchers change → matches recomputed)',
  })
  @ApiResponse({ status: 200, type: InquiryResponseDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInquiryDto,
  ): Promise<InquiryResponseDto> {
    return this.inquiries.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an inquiry' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.inquiries.remove(id);
  }

  @Get(':id/matches')
  @ApiOperation({
    summary: 'List the findings currently matching this inquiry (paginated)',
  })
  @ApiResponse({ status: 200, type: InquiryMatchListResponseDto })
  listMatches(
    @Param('id') id: string,
    @Query() query: QueryInquiryMatchesDto,
  ): Promise<InquiryMatchListResponseDto> {
    return this.inquiries.listMatches(id, query);
  }

  @Post(':id/seen')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Mark the current matches as seen (clears the "new" badge)',
  })
  async markSeen(@Param('id') id: string): Promise<void> {
    await this.inquiries.markSeen(id);
  }

  @Post(':id/rematch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recompute matches against all current findings' })
  @ApiResponse({ status: 200, type: RematchResponseDto })
  rematch(@Param('id') id: string): Promise<RematchResponseDto> {
    return this.inquiries.rematch(id);
  }
}
