import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const REVIEW_VERDICTS = [
  'CONFIRMED',
  'REJECTED',
  'UNSURE',
  'SPLIT',
] as const;
export type ReviewVerdictName = (typeof REVIEW_VERDICTS)[number];

export const LINEAGE_STATES = ['PATH', 'NO_PATH', 'UNKNOWN'] as const;

// ── Level 1: portfolio ──────────────────────────────────────────────────────

export class ReviewPatternDto {
  @ApiProperty() patternKey!: string;
  @ApiProperty({
    description:
      'SHARED_LABELS | PHONETIC | IDENTICAL_CONTENT | NEAR_DUPLICATE_TEXT',
  })
  family!: string;
  @ApiProperty({ type: [String] }) labels!: string[];
  @ApiProperty() pairCount!: number;
  @ApiProperty({
    description:
      'Uncapped size. Differs from pairCount only for near-duplicate text groups, whose asset-pair projection is capped.',
  })
  truePairCount!: number;
  @ApiProperty() clusterCount!: number;
  @ApiProperty() assetCount!: number;
  @ApiProperty() avgWeighted!: number;
  @ApiProperty() maxWeighted!: number;
  @ApiProperty({
    type: [Number],
    description:
      'Twenty bins over [0,1]. The client sums slices of these to recompute every count on the page when a cutoff moves, so dragging costs no request.',
  })
  scoreBuckets!: number[];
  @ApiProperty({ type: [Number] }) decidedBuckets!: number[];
  @ApiProperty({ type: [Number] }) clusterBuckets!: number[];
  @ApiProperty() lineagePathPairs!: number;
  @ApiProperty() lineageNoPathPairs!: number;
  @ApiProperty() lineageUnknownPairs!: number;
  @ApiProperty({ description: 'clique | star | chain | bridge | pair | mixed' })
  topologyShape!: string;
  @ApiProperty({ description: 'THRESHOLD | EXCLUSION | MERGE | JUDGEMENT' })
  ruleKind!: string;
}

export class ReviewSourceNodeDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({
    description:
      "Connector type, so the UI can show the system's own icon rather than an anonymous circle.",
  })
  type!: string;
  @ApiProperty() pairCount!: number;
  @ApiProperty({
    description: 'Pairs whose two assets are both inside this source.',
  })
  internalPairs!: number;
}

export class ReviewSourceEdgeDto {
  @ApiProperty() sourceAId!: string;
  @ApiProperty() sourceBId!: string;
  @ApiProperty() pairCount!: number;
  @ApiProperty() assetCount!: number;
}

export class ReviewSourceGraphDto {
  @ApiProperty({ type: [ReviewSourceNodeDto] }) nodes!: ReviewSourceNodeDto[];
  @ApiProperty({ type: [ReviewSourceEdgeDto] }) edges!: ReviewSourceEdgeDto[];
  @ApiProperty({
    description:
      'Share of pairs on the single heaviest source pairing. High means the duplicates have one findable cause; even spread points at the matcher instead.',
  })
  topShare!: number;
}

export class ReviewPortfolioResponseDto {
  @ApiProperty({ type: [ReviewPatternDto] }) patterns!: ReviewPatternDto[];
  @ApiProperty({ type: ReviewSourceGraphDto }) sources!: ReviewSourceGraphDto;
  @ApiProperty() totalPairs!: number;
  @ApiProperty() decidedPairs!: number;
  @ApiProperty({
    description:
      'Of the decided pairs, how many an agent decided. Kept apart so the headline stays a count of human work — an agent clearing the safe band must not make the queue look worked through.',
  })
  decidedByAgent!: number;
  @ApiProperty({
    description:
      'Distinct assets appearing in at least one scored pair. The duplicate rate is this over totalAssets — a cluster count says nothing without a denominator.',
  })
  assetsAffected!: number;
  @ApiProperty() totalAssets!: number;
  @ApiProperty({ description: 'Current relatedMin from the tuning config' })
  relatedMin!: number;
  @ApiProperty({ description: 'Current duplicateMin from the tuning config' })
  duplicateMin!: number;
  @ApiPropertyOptional({ nullable: true, type: String })
  computedAt!: string | null;
  @ApiProperty({
    description:
      'True when a dominant lineage component made the derivation test unusable, so lineage states read UNKNOWN rather than claiming a path.',
  })
  lineageHairball!: boolean;
}

// ── Level 2: clusters within a pattern ──────────────────────────────────────

export class ReviewClusterRowDto {
  @ApiProperty() clusterId!: string;
  @ApiProperty() patternKey!: string;
  @ApiProperty() pairCount!: number;
  @ApiProperty() undecidedPairs!: number;
  @ApiProperty() memberCount!: number;
  @ApiProperty() sourceCount!: number;
  @ApiProperty() maxWeighted!: number;
  @ApiProperty() avgWeighted!: number;
  @ApiProperty({ description: 'clique | star | chain | bridge | pair' })
  shape!: string;
  @ApiProperty({ description: 'PATH | NO_PATH | UNKNOWN' })
  lineageState!: string;
  @ApiProperty({
    type: [String],
    description: 'Full label set, not the truncated pattern key',
  })
  labels!: string[];
  @ApiProperty({ type: [String] }) sampleAssetIds!: string[];
}

export class ReviewClustersResponseDto {
  @ApiProperty({ type: [ReviewClusterRowDto] }) rows!: ReviewClusterRowDto[];
  @ApiPropertyOptional({ nullable: true, type: String })
  nextCursor!: string | null;
  @ApiProperty() total!: number;
}

export class ReviewSamplePairDto {
  @ApiProperty() aId!: string;
  @ApiProperty() bId!: string;
  // Names, not just ids: a table of truncated uuids tells a reviewer nothing
  // about what they are being asked to look at.
  @ApiProperty() aName!: string;
  @ApiProperty() bName!: string;
  @ApiProperty() weighted!: number;
  @ApiProperty() lineageState!: string;
  @ApiProperty({ type: [String] }) labels!: string[];
  @ApiProperty({
    type: [String],
    description:
      'The values the two assets actually share, capped. Lets a reviewer tell a distinctive match from shared boilerplate without opening the pair.',
  })
  sharedValues!: string[];
  @ApiPropertyOptional({ nullable: true, type: String })
  clusterId!: string | null;
}

export class ReviewSampleResponseDto {
  @ApiProperty({ type: [ReviewSamplePairDto] }) pairs!: ReviewSamplePairDto[];
  @ApiProperty({ description: 'Undecided pairs matching the same filters' })
  undecidedTotal!: number;
}

// ── Level 3: one pair ───────────────────────────────────────────────────────

export class ReviewPairAssetDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() assetType!: string;
  @ApiProperty() sourceId!: string;
  @ApiProperty() sourceName!: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  externalUrl!: string | null;
  @ApiProperty({
    description:
      'Count of derivation edges touching this asset. Zero means we have no lineage here — which is not the same as knowing there is no path.',
  })
  lineageDegree!: number;
}

export class ReviewSharedValueDto {
  @ApiProperty() value!: string;
  @ApiProperty({
    description:
      'Reverse-index key, so the token disclosure can ask where else this value appears without re-deriving the hash in the browser.',
  })
  valueHash!: string;
}

export class ReviewFieldRowDto {
  @ApiProperty() label!: string;
  @ApiProperty({ type: [String] }) aValues!: string[];
  @ApiProperty({ type: [String] }) bValues!: string[];
  @ApiProperty({ type: [ReviewSharedValueDto] })
  sharedValues!: ReviewSharedValueDto[];
  @ApiProperty() differs!: boolean;
}

export class ReviewWaterfallRowDto {
  @ApiProperty() label!: string;
  @ApiProperty({
    description:
      'Weight this label could have contributed if it matched perfectly. Positive bar.',
  })
  potential!: number;
  @ApiProperty({
    description:
      'Weight it actually contributed, from the scorer. potential + penalty.',
  })
  actual!: number;
  @ApiProperty({
    description:
      'actual - potential. Never positive: this is the evidence against, and it is inside the sum rather than hidden in a blend.',
  })
  penalty!: number;
  @ApiProperty() sharedCount!: number;
  @ApiProperty() aCount!: number;
  @ApiProperty() bCount!: number;
  @ApiProperty({ description: 'Raw label weight, for the tooltip' })
  weight!: number;
}

export class ReviewWaterfallDto {
  @ApiProperty({ type: [ReviewWaterfallRowDto] })
  rows!: ReviewWaterfallRowDto[];
  @ApiProperty({ description: 'Sum of the bars — equals the displayed score' })
  total!: number;
  @ApiProperty({
    description:
      'Sum of every potential bar. Always 1 for an exact-pass pair: the score is the fraction of available weight that matched.',
  })
  perfect!: number;
  @ApiProperty({
    description:
      'The score as stored. Should equal total; a mismatch means the scorer and this decomposition disagree.',
  })
  storedScore!: number;
  @ApiProperty({
    description:
      'True when the pair came from the phonetic pass, whose contributions are fuzzy match sums rather than whole-value counts.',
  })
  phonetic!: boolean;
}

export class ReviewEgoNodeDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() sourceId!: string;
  @ApiProperty() isSeed!: boolean;
}

export class ReviewEgoEdgeDto {
  @ApiProperty() aId!: string;
  @ApiProperty() bId!: string;
  @ApiProperty() weighted!: number;
  @ApiProperty({
    description:
      'The weakest edge whose removal disconnects the cluster — the one worth cutting.',
  })
  isWeakest!: boolean;
}

export class ReviewEgoGraphDto {
  @ApiProperty({ type: [ReviewEgoNodeDto] }) nodes!: ReviewEgoNodeDto[];
  @ApiProperty({ type: [ReviewEgoEdgeDto] }) edges!: ReviewEgoEdgeDto[];
  @ApiProperty({ description: 'Members omitted to keep the picture readable' })
  truncated!: number;
}

export class ReviewLineageEvidenceDto {
  @ApiProperty({ description: 'PATH | NO_PATH | UNKNOWN' })
  state!: string;
  @ApiProperty({
    description:
      'ANCESTOR_DESCENDANT | SIBLING | CONNECTED_OTHER | DISCONNECTED | UNKNOWN',
  })
  relation!: string;
  @ApiProperty({ type: [String] }) sharedRoots!: string[];
  @ApiProperty({ description: 'Derivation edges touching asset A' })
  aDegree!: number;
  @ApiProperty() bDegree!: number;
  @ApiProperty({
    description:
      'Whether this pair should be escalated: similar, both sides have lineage, and no path between them — convergent duplication rather than a derived copy.',
  })
  escalate!: boolean;
}

export class ReviewPairResponseDto {
  @ApiProperty({ type: ReviewPairAssetDto }) a!: ReviewPairAssetDto;
  @ApiProperty({ type: ReviewPairAssetDto }) b!: ReviewPairAssetDto;
  @ApiProperty() patternKey!: string;
  @ApiProperty() weighted!: number;
  @ApiProperty({ type: [String] }) labels!: string[];
  @ApiPropertyOptional({ nullable: true, type: String })
  clusterId!: string | null;
  @ApiProperty({ type: [ReviewFieldRowDto] }) fields!: ReviewFieldRowDto[];
  @ApiProperty({ type: ReviewWaterfallDto }) waterfall!: ReviewWaterfallDto;
  @ApiProperty({ type: ReviewEgoGraphDto }) ego!: ReviewEgoGraphDto;
  @ApiProperty({ type: ReviewLineageEvidenceDto })
  lineage!: ReviewLineageEvidenceDto;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Existing verdict, if this pair was already decided',
  })
  verdict!: string | null;
  @ApiProperty({
    description:
      'True when the pair has been re-scored materially since it was decided, so the standing judgement was made about a different number.',
  })
  verdictStale!: boolean;
}

// ── Mutations ───────────────────────────────────────────────────────────────

export class ReviewPairRefDto {
  @ApiProperty() @IsString() aId!: string;
  @ApiProperty() @IsString() bId!: string;
}

export class RecordVerdictDto {
  @ApiProperty({ type: [ReviewPairRefDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReviewPairRefDto)
  pairs!: ReviewPairRefDto[];

  @ApiProperty({ enum: REVIEW_VERDICTS })
  @IsIn(REVIEW_VERDICTS)
  verdict!: ReviewVerdictName;

  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class RecordVerdictResponseDto {
  @ApiProperty() batchId!: string;
  @ApiProperty() applied!: number;
  @ApiProperty({
    description: 'Pairs skipped because they are not in the index',
  })
  skipped!: number;
  @ApiProperty() workRemaining!: number;
}

export class UndoBatchDto {
  @ApiProperty() @IsString() batchId!: string;
}

export class UndoBatchResponseDto {
  @ApiProperty() batchId!: string;
  @ApiProperty() reverted!: number;
  @ApiProperty() workRemaining!: number;
}

export class UndoLogEntryDto {
  @ApiProperty() id!: string;
  @ApiProperty() action!: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  patternKey!: string | null;
  @ApiProperty() pairCount!: number;
  @ApiProperty() clusterCount!: number;
  @ApiProperty() assetCount!: number;
  @ApiProperty() summary!: string;
  @ApiProperty() createdAt!: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  undoneAt!: string | null;
  @ApiProperty({
    description:
      'False when the index was rebuilt after this batch, so replaying it may not restore what the reviewer saw. Undo is not unbounded time travel and the UI must say so rather than failing quietly.',
  })
  undoable!: boolean;
}

export class UndoLogResponseDto {
  @ApiProperty({ type: [UndoLogEntryDto] }) entries!: UndoLogEntryDto[];
}

export class PatternActionDto {
  @ApiProperty({ enum: REVIEW_VERDICTS })
  @IsIn(REVIEW_VERDICTS)
  verdict!: ReviewVerdictName;

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  min?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  max?: number;

  @ApiPropertyOptional({ enum: LINEAGE_STATES })
  @IsOptional()
  @IsIn(LINEAGE_STATES)
  lineage?: string;

  @ApiPropertyOptional({
    description:
      'For EXCLUSION patterns: also write a correlation exclusion rule for this label, so the boilerplate stops driving matches at all.',
  })
  @IsOptional()
  @IsString()
  excludeLabel?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Reverse-index keys of the specific values to stop matching on, from the exclusion-candidates endpoint. Hashes rather than raw values so the rule can only ever name something that is actually indexed — a pattern endpoint must not be a way to write arbitrary instance-wide config.',
  })
  @IsOptional()
  @IsArray()
  excludeValueHashes?: string[];
}

// ── What a boilerplate pattern is really made of ────────────────────────────

export class PatternExclusionCandidateDto {
  @ApiProperty() label!: string;
  @ApiProperty({ description: 'The normalized value, as the engine stores it' })
  value!: string;
  @ApiProperty() valueHash!: string;
  @ApiProperty({
    description:
      'Assets holding this value anywhere in the corpus — how far excluding it reaches.',
  })
  assetCount!: number;
}

export class PatternExclusionCandidatesResponseDto {
  @ApiProperty() patternKey!: string;
  @ApiProperty({ description: 'THRESHOLD | EXCLUSION | MERGE | JUDGEMENT' })
  ruleKind!: string;
  @ApiProperty({ type: [PatternExclusionCandidateDto] })
  candidates!: PatternExclusionCandidateDto[];
  @ApiProperty({
    description: 'Distinct values in the group before the list was capped',
  })
  totalCandidates!: number;
  @ApiProperty({
    description:
      'Scored pairs elsewhere in the corpus that hold one of these values on BOTH sides — the matches the template is actually driving. This is the number the exclusion removes, and it is not the same as the pairs in this pattern.',
  })
  pairsDriven!: number;
  @ApiProperty({
    description:
      'True when the near-duplicate group is bigger than one request should read; the candidate list is the strongest part of it rather than all of it.',
  })
  truncated!: boolean;
}

export class PatternPreviewResponseDto {
  @ApiProperty() patternKey!: string;
  @ApiProperty() pairsAffected!: number;
  @ApiProperty() clustersAffected!: number;
  @ApiProperty() assetsAffected!: number;
  @ApiProperty({ type: [String] }) sampleClusterIds!: string[];
  @ApiProperty() ruleKind!: string;
  @ApiProperty() ruleDescription!: string;
  @ApiProperty({
    description: 'Undecided pairs before this action, across the whole corpus',
  })
  workRemainingBefore!: number;
  @ApiProperty() workRemainingAfter!: number;
}

export class PatternApplyResponseDto {
  @ApiProperty() batchId!: string;
  @ApiProperty() applied!: number;
  @ApiProperty() workRemaining!: number;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'First exclusion rule created, when the pattern warranted one. Kept for callers written before an action could create several; prefer exclusionRuleIds.',
  })
  exclusionRuleId!: string | null;

  @ApiProperty({
    type: [String],
    description: 'Every exclusion rule this action created. Empty when none.',
  })
  exclusionRuleIds!: string[];
}

export class SplitPairResponseDto {
  @ApiProperty() batchId!: string;
  @ApiProperty({
    description:
      'Whether the two assets ended up in different clusters. False means the evidence still binds them through another member of the cluster, and the split alone did not separate them.',
  })
  clusterSplit!: boolean;
  @ApiProperty() workRemaining!: number;
}

export class ReviewQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() min?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() max?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() lineage?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class RebuildIndexResponseDto {
  @ApiProperty() pairs!: number;
  @ApiProperty() patterns!: number;
  @ApiProperty() lineageCovered!: number;
  @ApiProperty({
    description:
      'True when a dominant lineage component made the derivation test unusable, so lineage reads UNKNOWN rather than claiming a path.',
  })
  hairballDemoted!: boolean;
  @ApiProperty() durationMs!: number;
}

// ── Decisions: what was judged, and what became of it ───────────────────────

export class ReviewDecisionRowDto {
  @ApiProperty() aId!: string;
  @ApiProperty() bId!: string;
  @ApiProperty() aName!: string;
  @ApiProperty() bName!: string;
  @ApiProperty() verdict!: string;
  @ApiProperty() patternKey!: string;
  @ApiProperty({ description: 'Score the reviewer saw when they decided' })
  scoreAtVerdict!: number;
  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description:
      'Score now. Null when the pair is no longer in the index at all.',
  })
  currentScore!: number | null;
  @ApiProperty({
    description:
      'The pair has been re-scored materially since the decision was taken.',
  })
  stale!: boolean;
  @ApiProperty({
    description: "'ai' when an agent decided it, else 'operator'",
  })
  decidedByKind!: string;
  @ApiProperty() decidedAt!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) caseId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  inquiryId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) note!: string | null;
}

export class ReviewDecisionsResponseDto {
  @ApiProperty({ type: [ReviewDecisionRowDto] })
  rows!: ReviewDecisionRowDto[];
  @ApiPropertyOptional({ nullable: true, type: String })
  nextCursor!: string | null;
  @ApiProperty() total!: number;
  @ApiProperty({ description: 'Decided but not yet taken anywhere' })
  unactioned!: number;
  @ApiProperty({ description: 'Counts by verdict across the whole namespace' })
  byVerdict!: Record<string, number>;
  @ApiProperty({ description: 'Decisions an agent took, not a person' })
  byAgent!: number;
}

export class DecisionsQueryDto {
  @ApiPropertyOptional({ enum: REVIEW_VERDICTS })
  @IsOptional()
  @IsIn(REVIEW_VERDICTS)
  verdict?: ReviewVerdictName;

  @ApiPropertyOptional() @IsOptional() @IsString() patternKey?: string;

  @ApiPropertyOptional({
    description: 'true = only decisions that went nowhere yet',
  })
  @IsOptional()
  unactionedOnly?: boolean;
}

export class DecisionsToCaseDto {
  @ApiProperty({ type: [ReviewPairRefDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReviewPairRefDto)
  pairs!: ReviewPairRefDto[];

  @ApiPropertyOptional({
    description: 'Extend this case instead of creating one',
  })
  @IsOptional()
  @IsString()
  caseId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() severity?: string;
  @ApiPropertyOptional({ description: "Attach the assets' findings too" })
  @IsOptional()
  attachFindings?: boolean;
}

export class DecisionsToCaseResponseDto {
  @ApiProperty() caseId!: string;
  @ApiProperty() caseTitle!: string;
  @ApiProperty() created!: boolean;
  @ApiProperty() assetsAdded!: number;
  @ApiProperty() findingsAttached!: number;
  @ApiProperty() pairsLinked!: number;
}

export class DecisionsToInquiryDto {
  @ApiProperty({ type: [ReviewPairRefDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReviewPairRefDto)
  pairs!: ReviewPairRefDto[];

  @ApiPropertyOptional() @IsOptional() @IsString() title?: string;
}

export class DecisionsToInquiryResponseDto {
  @ApiProperty() inquiryId!: string;
  @ApiProperty() title!: string;
  @ApiProperty() matchCount!: number;
  @ApiProperty() pairsLinked!: number;
}

// ── Why a match happened, and how to stop it happening again ───────────────

export class RejectCauseLabelDto {
  @ApiProperty() label!: string;
  @ApiProperty({ description: 'Share of the score this label contributed' })
  share!: number;
  @ApiProperty() weight!: number;
  @ApiProperty({ type: [String], description: 'The values that matched' })
  values!: string[];
}

export class RejectCauseDto {
  @ApiProperty({ type: [RejectCauseLabelDto] })
  drivers!: RejectCauseLabelDto[];
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'The single label responsible for most of the score, when there is one — the thing to lower or exclude.',
  })
  dominantLabel!: string | null;
  @ApiProperty({
    description:
      'How many other pairs in the corpus this same label combination produced. A big number means fixing it clears a lot at once.',
  })
  similarPairs!: number;
}

export class ReopenDecisionsDto {
  @ApiProperty({ type: [ReviewPairRefDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReviewPairRefDto)
  pairs!: ReviewPairRefDto[];
}

export class ReopenDecisionsResponseDto {
  @ApiProperty() reopened!: number;
  @ApiProperty() workRemaining!: number;
}
