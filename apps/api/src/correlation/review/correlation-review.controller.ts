import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CorrelationReviewService } from './correlation-review.service';
import {
  PatternActionDto,
  PatternApplyResponseDto,
  PatternPreviewResponseDto,
  RecordVerdictDto,
  RecordVerdictResponseDto,
  ReviewClustersResponseDto,
  ReviewPairResponseDto,
  ReviewPortfolioResponseDto,
  DecisionsToCaseDto,
  DecisionsToCaseResponseDto,
  DecisionsToInquiryDto,
  DecisionsToInquiryResponseDto,
  RebuildIndexResponseDto,
  RejectCauseDto,
  ReopenDecisionsDto,
  ReopenDecisionsResponseDto,
  ReviewDecisionsResponseDto,
  ReviewSampleResponseDto,
  SplitPairResponseDto,
  UndoBatchDto,
  UndoBatchResponseDto,
  UndoLogResponseDto,
} from '../../dto/correlation-review.dto';

/**
 * The fingerprints review queue: patterns, then clusters, then one pair.
 *
 * Every read here is a seek into a pre-aggregated table. The endpoint this
 * replaced assembled the whole correlation graph per request, which is why the
 * page it fed was unusable on a real corpus.
 */
@ApiTags('correlation-review')
@Controller('correlation/review')
export class CorrelationReviewController {
  constructor(private readonly review: CorrelationReviewService) {}

  @Get('portfolio')
  @ApiOperation({
    summary:
      'Level 1: work remaining, the pattern queue, and the source meta-graph',
    description:
      'Includes a 20-bin score histogram per pattern so the client can recompute every count on the page as a cutoff moves, without another request.',
  })
  @ApiQuery({
    name: 'sourceIds',
    required: false,
    description:
      'Narrow to pairs touching any of these sources (comma separated). Either side counts — restricting to both would hide the cross-system pairs.',
  })
  @ApiResponse({ status: 200, type: ReviewPortfolioResponseDto })
  async portfolio(
    @Query('sourceIds') sourceIds?: string,
  ): Promise<ReviewPortfolioResponseDto> {
    return this.review.portfolio({ sourceIds });
  }

  @Post('rebuild')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rebuild the review rollups from existing correlation data',
    description:
      'Derived from edges, clusters and correlation values that are already stored — this does not re-scan or re-fingerprint anything. Use it when a namespace was scanned before the review queue existed and its queue reads empty.',
  })
  @ApiResponse({ status: 200, type: RebuildIndexResponseDto })
  async rebuild(): Promise<RebuildIndexResponseDto> {
    return this.review.rebuild();
  }

  @Get('patterns/:patternKey/clusters')
  @ApiOperation({ summary: 'Level 2: clusters inside one pattern' })
  @ApiQuery({ name: 'min', required: false })
  @ApiQuery({ name: 'max', required: false })
  @ApiQuery({ name: 'lineage', required: false, enum: ['PATH', 'NO_PATH', 'UNKNOWN'] })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'sourceIds', required: false })
  @ApiResponse({ status: 200, type: ReviewClustersResponseDto })
  async clusters(
    @Param('patternKey') patternKey: string,
    @Query('min') min?: string,
    @Query('max') max?: string,
    @Query('lineage') lineage?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('sourceIds') sourceIds?: string,
  ): Promise<ReviewClustersResponseDto> {
    return this.review.clusters(patternKey, {
      min,
      max,
      lineage,
      cursor,
      limit,
      sourceIds,
    });
  }

  @Get('patterns/:patternKey/sample')
  @ApiOperation({
    summary: 'The next undecided pairs in a pattern, strongest first',
  })
  @ApiQuery({ name: 'n', required: false })
  @ApiQuery({ name: 'min', required: false })
  @ApiQuery({ name: 'max', required: false })
  @ApiQuery({ name: 'lineage', required: false })
  @ApiQuery({ name: 'sourceIds', required: false })
  @ApiResponse({ status: 200, type: ReviewSampleResponseDto })
  async sample(
    @Param('patternKey') patternKey: string,
    @Query('n') n?: string,
    @Query('min') min?: string,
    @Query('max') max?: string,
    @Query('lineage') lineage?: string,
    @Query('sourceIds') sourceIds?: string,
  ): Promise<ReviewSampleResponseDto> {
    return this.review.sample(patternKey, { n, min, max, lineage, sourceIds });
  }

  @Get('pairs/:aId/:bId')
  @ApiOperation({
    summary:
      'Level 3: one pair — comparison, match-weight decomposition, local graph, lineage evidence',
  })
  @ApiResponse({ status: 200, type: ReviewPairResponseDto })
  async pair(
    @Param('aId') aId: string,
    @Param('bId') bId: string,
  ): Promise<ReviewPairResponseDto> {
    return this.review.pair(aId, bId);
  }

  @Get('decisions')
  @ApiOperation({
    summary: 'What has been decided, and what became of it',
    description:
      'The other half of the queue. A decision that cannot be found again is a keystroke, not a judgement — this lists what was decided, whether a person or an agent decided it, and whether it was ever taken into a case or an inquiry. Filter to the ones that went nowhere with unactionedOnly.',
  })
  @ApiQuery({ name: 'verdict', required: false })
  @ApiQuery({ name: 'patternKey', required: false })
  @ApiQuery({ name: 'unactionedOnly', required: false })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, type: ReviewDecisionsResponseDto })
  async decisions(
    @Query('verdict') verdict?: string,
    @Query('patternKey') patternKey?: string,
    @Query('unactionedOnly') unactionedOnly?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<ReviewDecisionsResponseDto> {
    return this.review.decisions({
      verdict,
      patternKey,
      unactionedOnly,
      cursor,
      limit,
    });
  }

  @Post('decisions/reopen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Put decided pairs back in the queue',
    description:
      'Removes the verdict, and re-clusters the neighbourhood when the verdict was one that had been suppressing it.',
  })
  @ApiResponse({ status: 200, type: ReopenDecisionsResponseDto })
  async reopen(
    @Body() dto: ReopenDecisionsDto,
  ): Promise<ReopenDecisionsResponseDto> {
    return this.review.reopen(dto);
  }

  @Post('decisions/case')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Take decided pairs into a case as evidence',
  })
  @ApiResponse({ status: 200, type: DecisionsToCaseResponseDto })
  async decisionsToCase(
    @Body() dto: DecisionsToCaseDto,
  ): Promise<DecisionsToCaseResponseDto> {
    return this.review.decisionsToCase(dto);
  }

  @Post('decisions/inquiry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Open an inquiry that keeps watching for what these pairs had in common',
  })
  @ApiResponse({ status: 200, type: DecisionsToInquiryResponseDto })
  async decisionsToInquiry(
    @Body() dto: DecisionsToInquiryDto,
  ): Promise<DecisionsToInquiryResponseDto> {
    return this.review.decisionsToInquiry(dto);
  }

  @Get('pairs/:aId/:bId/cause')
  @ApiOperation({
    summary: 'What drove this match, framed as something to fix',
    description:
      'Rejecting a pair without addressing the cause means the next scan produces it again. This names the label carrying the score and how many other pairs the same combination produced.',
  })
  @ApiResponse({ status: 200, type: RejectCauseDto })
  async cause(
    @Param('aId') aId: string,
    @Param('bId') bId: string,
  ): Promise<RejectCauseDto> {
    return this.review.rejectCause(aId, bId);
  }

  @Post('verdicts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a decision on one or more pairs' })
  @ApiResponse({ status: 200, type: RecordVerdictResponseDto })
  async recordVerdicts(
    @Body() dto: RecordVerdictDto,
  ): Promise<RecordVerdictResponseDto> {
    return this.review.recordVerdicts(dto);
  }

  @Post('verdicts/undo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revert one batch of decisions' })
  @ApiResponse({ status: 200, type: UndoBatchResponseDto })
  async undo(@Body() dto: UndoBatchDto): Promise<UndoBatchResponseDto> {
    return this.review.undo(dto?.batchId);
  }

  @Get('undo-log')
  @ApiOperation({ summary: 'Recent bulk actions, newest first' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, type: UndoLogResponseDto })
  async undoLog(@Query('limit') limit?: string): Promise<UndoLogResponseDto> {
    return this.review.undoLog(Number(limit) || 20);
  }

  @Post('patterns/:patternKey/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'What a bulk action would do. Read-only — nothing is applied.',
  })
  @ApiResponse({ status: 200, type: PatternPreviewResponseDto })
  async preview(
    @Param('patternKey') patternKey: string,
    @Body() dto: PatternActionDto,
  ): Promise<PatternPreviewResponseDto> {
    return this.review.previewPattern(patternKey, dto);
  }

  @Post('patterns/:patternKey/apply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Decide a whole pattern at once, reversibly via the undo log',
  })
  @ApiResponse({ status: 200, type: PatternApplyResponseDto })
  async apply(
    @Param('patternKey') patternKey: string,
    @Body() dto: PatternActionDto,
  ): Promise<PatternApplyResponseDto> {
    return this.review.applyPattern(patternKey, dto);
  }

  @Post('pairs/:aId/:bId/split')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cut the link between two assets. The verdict keeps later scans from rejoining them.',
  })
  @ApiResponse({ status: 200, type: SplitPairResponseDto })
  async split(
    @Param('aId') aId: string,
    @Param('bId') bId: string,
  ): Promise<SplitPairResponseDto> {
    return this.review.splitPair(aId, bId);
  }
}
