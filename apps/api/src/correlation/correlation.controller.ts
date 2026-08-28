import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CorrelationService } from './correlation.service';
import { DuplicatesFinderAgentService } from './duplicates-finder-agent.service';
import {
  AddExclusionDto,
  CaseActionRequestDto,
  CaseActionResponseDto,
  CorrelationConfigResponseDto,
  CorrelationGraphResponseDto,
  RecomputeCorrelationResponseDto,
  UpdateCorrelationConfigDto,
  ValueOccurrencesResponseDto,
} from '../dto/correlation.dto';

@ApiTags('correlation')
@Controller()
export class CorrelationController {
  constructor(
    private readonly correlation: CorrelationService,
    private readonly duplicatesFinder: DuplicatesFinderAgentService,
  ) {}

  @Get('correlation/graph')
  @ApiOperation({
    summary:
      'Correlation ("evidence fingerprints") graph for ONE asset or ONE source',
    description:
      'Always scoped. The unscoped whole-corpus graph was removed along with the canvas it fed: it assembled every cluster in the namespace on every request, which is what made the fingerprints page slow. Corpus-wide duplicate work is served by /correlation/review/* instead, from pre-aggregated rollups.',
  })
  @ApiQuery({
    name: 'assetId',
    required: false,
    description: "Scope to one asset's identity cluster",
  })
  @ApiQuery({
    name: 'sourceId',
    required: false,
    description: 'Scope to clusters touching this source (external flagged)',
  })
  @ApiResponse({ status: 200, type: CorrelationGraphResponseDto })
  async graph(
    @Query('assetId') assetId?: string,
    @Query('sourceId') sourceId?: string,
  ): Promise<CorrelationGraphResponseDto> {
    if (assetId) return this.correlation.buildGraph({ assetId });
    if (sourceId) return this.correlation.buildGraph({ sourceId });
    throw new BadRequestException(
      'assetId or sourceId is required — there is no unscoped correlation graph.',
    );
  }

  @Get('correlation/links-graph')
  @ApiOperation({
    summary: "A source's assets connected by their links (hash references)",
  })
  @ApiQuery({ name: 'sourceId', required: true })
  @ApiResponse({ status: 200, type: CorrelationGraphResponseDto })
  async linksGraph(
    @Query('sourceId') sourceId: string,
  ): Promise<CorrelationGraphResponseDto> {
    return this.correlation.buildLinksGraph(sourceId);
  }

  @Get('correlation/config')
  @ApiOperation({
    summary:
      'Correlation tuning: per-label weights (dynamic) + match thresholds',
  })
  @ApiResponse({ status: 200, type: CorrelationConfigResponseDto })
  async getConfig(): Promise<CorrelationConfigResponseDto> {
    return this.correlation.getConfig();
  }

  @Put('correlation/config')
  @ApiOperation({
    summary: 'Update correlation tuning and schedule a full recompute (logged)',
  })
  @ApiResponse({ status: 200, type: CorrelationConfigResponseDto })
  async updateConfig(
    @Body() dto: UpdateCorrelationConfigDto,
  ): Promise<CorrelationConfigResponseDto> {
    const config = await this.correlation.saveConfig(dto);
    return config;
  }

  @Post('correlation/exclusions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Add an exclusion rule (ignore noisy values) and recompute',
  })
  @ApiResponse({ status: 200, type: CorrelationConfigResponseDto })
  async addExclusion(
    @Body() dto: AddExclusionDto,
  ): Promise<CorrelationConfigResponseDto> {
    const config = await this.correlation.addExclusion({
      mode: dto.mode,
      label: dto.label ?? null,
      value: dto.value ?? null,
    });
    return config;
  }

  @Delete('correlation/exclusions/:id')
  @ApiOperation({ summary: 'Remove an exclusion rule and recompute' })
  @ApiResponse({ status: 200, type: CorrelationConfigResponseDto })
  async removeExclusion(
    @Param('id') id: string,
  ): Promise<CorrelationConfigResponseDto> {
    const config = await this.correlation.removeExclusion(id);
    return config;
  }

  @Post('correlation/case-action')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Create a case (or add to one) from assets selected in the fingerprints graph',
  })
  @ApiResponse({ status: 200, type: CaseActionResponseDto })
  async caseAction(
    @Body() dto: CaseActionRequestDto,
  ): Promise<CaseActionResponseDto> {
    return this.duplicatesFinder.runCaseAction({
      assetIds: dto.assetIds ?? [],
      caseId: dto.caseId ?? null,
      title: dto.title ?? null,
      description: dto.description ?? null,
      severity: dto.severity ?? null,
      attachFindings: dto.attachFindings ?? false,
    });
  }

  @Post('assets/:id/recompute-correlation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recompute correlation for a single asset (on demand)',
  })
  @ApiResponse({ status: 200, type: RecomputeCorrelationResponseDto })
  async recompute(
    @Param('id') id: string,
  ): Promise<RecomputeCorrelationResponseDto> {
    const s = await this.correlation.recomputeForAsset(id);
    return {
      assetsProcessed: s.assetsProcessed,
      valuesIndexed: s.valuesIndexed,
      relatedPairs: s.relatedPairs,
      duplicatePairs: s.duplicatePairs,
      clustersTouched: s.clustersTouched,
    };
  }

  @Get('findings/occurrences')
  @ApiOperation({
    summary: 'Where else a normalized finding value appears (reverse index)',
  })
  @ApiQuery({ name: 'label', required: false })
  @ApiQuery({ name: 'value', required: false })
  @ApiQuery({ name: 'valueHash', required: false })
  @ApiResponse({ status: 200, type: ValueOccurrencesResponseDto })
  async occurrences(
    @Query('label') label?: string,
    @Query('value') value?: string,
    @Query('valueHash') valueHash?: string,
  ): Promise<ValueOccurrencesResponseDto> {
    return this.correlation.getValueOccurrences({ label, value, valueHash });
  }
}
