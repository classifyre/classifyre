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
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ActorName } from '../actor-name.decorator';
import { AllowInDemoMode } from '../demo-mode.decorator';
import { ReadOnlyEndpoint } from '../db/read-only-endpoint.decorator';
import { PrismaService } from '../prisma.service';
import { CaseCleanupService } from '../cases/case-cleanup.service';
import { CaseFindingFiltersService } from '../cases/case-finding-filters.service';
import { CaseEscalationService } from '../cases/case-escalation.service';
import {
  AddCaseFindingFiltersDto,
  CaseCleanupPreviewDto,
  CaseCleanupRulesDto,
  CaseFindingFilterDto,
  CaseFindingFilterOptionsDto,
  CaseFindingFiltersChangeResponseDto,
  CaseFindingFiltersPreviewDto,
  ClearCaseEscalationsDto,
  ClearCaseEscalationsResponseDto,
  PreviewCaseFindingFiltersDto,
  UpdateCaseFindingFilterDto,
} from '../dto/case-cleanup.dto';

/** No global ValidationPipe: a form or MCP "true" arrives as text. */
function flag(value: unknown): boolean {
  return value === true || value === 'true';
}

/**
 * What a case takes out by itself: the clean-up switches' preview (the
 * switches themselves are saved with PATCH /cases/:id) and the finding
 * filters, case-wide or per watch.
 */
@ApiTags('cases')
@Controller('cases/:id')
export class CaseCleanupController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cleanup: CaseCleanupService,
    private readonly filters: CaseFindingFiltersService,
    private readonly escalation: CaseEscalationService,
  ) {}

  @AllowInDemoMode()
  @ReadOnlyEndpoint()
  @Post('cleanup/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'What the given clean-up switches would take out of the case right now (writes nothing)',
  })
  @ApiResponse({ status: 200, type: CaseCleanupPreviewDto })
  async previewCleanup(
    @Param('id') id: string,
    @Body() dto: CaseCleanupRulesDto,
  ): Promise<CaseCleanupPreviewDto> {
    const found = await this.prisma.case.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`Case with ID ${id} not found`);
    return this.cleanup.previewRules(id, {
      removeGoneFindings: flag(dto?.removeGoneFindings),
      removeResolvedFindings: flag(dto?.removeResolvedFindings),
      removeGoneAssets: flag(dto?.removeGoneAssets),
    });
  }

  @Get('finding-filters')
  @ApiOperation({
    summary: "The case's finding filters, case-wide and per watch",
  })
  @ApiResponse({ status: 200, type: [CaseFindingFilterDto] })
  listFilters(@Param('id') id: string): Promise<CaseFindingFilterDto[]> {
    return this.filters.list(id);
  }

  @Get('finding-filters/options')
  @ApiOperation({
    summary:
      'Finding types a filter can pick from: what the case holds and what its watches (or one watch) answer',
  })
  @ApiQuery({ name: 'inquiryId', required: false })
  @ApiResponse({ status: 200, type: CaseFindingFilterOptionsDto })
  filterOptions(
    @Param('id') id: string,
    @Query('inquiryId') inquiryId?: string,
  ): Promise<CaseFindingFilterOptionsDto> {
    return this.filters.options(id, inquiryId || null);
  }

  @AllowInDemoMode()
  @ReadOnlyEndpoint()
  @Post('finding-filters/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'How many findings in the case unsaved filter rules would take out now (writes nothing)',
  })
  @ApiResponse({ status: 200, type: CaseFindingFiltersPreviewDto })
  previewFilters(
    @Param('id') id: string,
    @Body() dto: PreviewCaseFindingFiltersDto,
  ): Promise<CaseFindingFiltersPreviewDto> {
    return this.filters.preview(id, dto);
  }

  @Post('finding-filters')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Add finding filters (case-wide or for one watch); matching findings leave the case now and are not pulled again',
  })
  @ApiResponse({ status: 200, type: CaseFindingFiltersChangeResponseDto })
  addFilters(
    @Param('id') id: string,
    @Body() dto: AddCaseFindingFiltersDto,
    @ActorName() actor: string | undefined,
  ): Promise<CaseFindingFiltersChangeResponseDto> {
    return this.filters.add(id, dto, actor);
  }

  @Patch('finding-filters/:filterId')
  @ApiOperation({
    summary:
      "Change a filter's pattern or description; a new pattern takes out what it now matches",
  })
  @ApiResponse({ status: 200, type: CaseFindingFiltersChangeResponseDto })
  updateFilter(
    @Param('id') id: string,
    @Param('filterId') filterId: string,
    @Body() dto: UpdateCaseFindingFilterDto,
    @ActorName() actor: string | undefined,
  ): Promise<CaseFindingFiltersChangeResponseDto> {
    return this.filters.update(id, filterId, dto, actor);
  }

  @Delete('finding-filters/:filterId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Remove a filter. Findings it took out stay out; the watch just stops skipping them',
  })
  @ApiResponse({ status: 200, type: [CaseFindingFilterDto] })
  removeFilter(
    @Param('id') id: string,
    @Param('filterId') filterId: string,
    @ActorName() actor: string | undefined,
  ): Promise<CaseFindingFilterDto[]> {
    return this.filters.remove(id, filterId, actor);
  }

  @Post('escalations/clear')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Take the escalation mark off findings of the case (all of them when findingIds is omitted); the findings stay',
  })
  @ApiResponse({ status: 200, type: ClearCaseEscalationsResponseDto })
  async clearEscalations(
    @Param('id') id: string,
    @Body() dto: ClearCaseEscalationsDto,
    @ActorName() actor: string | undefined,
  ): Promise<ClearCaseEscalationsResponseDto> {
    const found = await this.prisma.case.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`Case with ID ${id} not found`);
    const findingIds = Array.isArray(dto?.findingIds)
      ? dto.findingIds.filter((v): v is string => typeof v === 'string')
      : undefined;
    return this.escalation.clear(id, findingIds, actor);
  }
}
