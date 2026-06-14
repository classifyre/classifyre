import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PgBossService } from '../scheduler/pg-boss.service';
import { CorrelationService } from './correlation.service';
import { DuplicatesFinderAgentService } from './duplicates-finder-agent.service';
import { CORRELATION_QUEUE } from './correlation.constants';
import { GraphResponseDto } from '../dto/graph.dto';
import {
  CaseActionRequestDto,
  CaseActionResponseDto,
  CorrelationConfigResponseDto,
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
    private readonly pgBoss: PgBossService,
  ) {}

  @Get('correlation/graph')
  @ApiOperation({
    summary:
      'Correlation ("evidence fingerprints") graph: assets linked through the findings they share',
  })
  @ApiQuery({
    name: 'assetId',
    required: false,
    description: "Scope to one asset's identity cluster; omit for all clusters",
  })
  @ApiResponse({ status: 200, type: GraphResponseDto })
  async graph(@Query('assetId') assetId?: string): Promise<GraphResponseDto> {
    return this.correlation.buildGraph(assetId ? { assetId } : undefined);
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
    // Recompute everything in the background; surfaces as a DUPLICATES run.
    try {
      const boss = await this.pgBoss.getBossAsync();
      await boss.send(
        CORRELATION_QUEUE,
        { recomputeAll: true },
        {
          singletonKey: 'correlation:recompute-all',
          expireInSeconds: 6 * 3600,
        },
      );
    } catch {
      // Non-fatal: config is saved; it will apply on the next scan recompute.
    }
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
