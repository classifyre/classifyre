import { ApiProperty } from '@nestjs/swagger';
import { AssetType, EdgeClass } from '@prisma/client';

export class ConstellationSeverityMixDto {
  @ApiProperty()
  critical: number;

  @ApiProperty()
  high: number;

  @ApiProperty()
  medium: number;

  @ApiProperty()
  low: number;

  @ApiProperty()
  info: number;
}

/**
 * Edge counts per class.
 *
 * Lowercase field names deliberately: the stored enum is FLOW/CONTAINMENT/…,
 * but the OpenAPI generator lower-cases only the first letter of a property, so
 * `FLOW` reaches the client as `fLOW`. The mapping lives in one place instead.
 */
export class ConstellationClassCountsDto {
  @ApiProperty({ description: 'Lineage. The class that says data moved.' })
  flow: number;

  @ApiProperty({ description: 'Structural containment — archive members, attachments.' })
  containment: number;

  @ApiProperty({ description: 'The same thing seen twice.' })
  identity: number;

  @ApiProperty({ description: 'Meaning and navigation. Propagates nothing.' })
  reference: number;

  @ApiProperty({ description: 'Who touched it.' })
  usage: number;
}

export class ConstellationSourceDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: AssetType })
  type: AssetType;

  @ApiProperty({ description: 'Every asset of this source.' })
  assetCount: number;

  @ApiProperty({
    description:
      'Assets touched by at least one edge. The bubble is sized by this.',
  })
  connectedAssetCount: number;

  @ApiProperty({
    description:
      'Assets with no edge of any class. Never drawn — shown as a count under the bubble, which is what keeps this response independent of corpus size.',
  })
  isolatedAssetCount: number;

  @ApiProperty({ description: 'Edges with both endpoints inside this source.' })
  internalEdgeCount: number;

  @ApiProperty()
  findingCount: number;

  @ApiProperty({ type: ConstellationSeverityMixDto })
  severityCounts: ConstellationSeverityMixDto;
}

export class ConstellationLinkDto {
  @ApiProperty()
  sourceAId: string;

  @ApiProperty()
  sourceBId: string;

  @ApiProperty({ description: 'Edges across this pairing, all classes.' })
  total: number;

  @ApiProperty({ type: ConstellationClassCountsDto })
  byClass: ConstellationClassCountsDto;

  @ApiProperty({ description: 'Distinct assets participating, on either side.' })
  assetCount: number;

  @ApiProperty({
    description:
      'Duplicate pairs the review index found across this pairing. Zero when the duplicate index has never been built — absence of evidence, not evidence of absence.',
  })
  duplicatePairCount: number;
}

export class ConstellationBoundaryEdgeDto {
  @ApiProperty({
    required: false,
    nullable: true,
    description: 'The source on the far side, or null when the far end is external.',
  })
  peerSourceId?: string | null;

  @ApiProperty({ enum: EdgeClass })
  relationClass: EdgeClass;

  @ApiProperty()
  edgeCount: number;
}

export class ConstellationBoundaryAssetDto {
  @ApiProperty()
  assetId: string;

  @ApiProperty()
  assetName: string;

  @ApiProperty()
  assetType: string;

  @ApiProperty()
  sourceId: string;

  @ApiProperty({ type: [ConstellationBoundaryEdgeDto] })
  edges: ConstellationBoundaryEdgeDto[];
}

export class ConstellationBundleDto {
  @ApiProperty({ description: 'Stable id, derived from the source pairing.' })
  id: string;

  @ApiProperty()
  sourceAId: string;

  @ApiProperty({ required: false, nullable: true })
  sourceBId?: string | null;

  @ApiProperty({ description: 'Boundary assets folded into this bundle.' })
  assetCount: number;

  @ApiProperty({ description: 'Edges those assets carry across the pairing.' })
  edgeCount: number;
}

export class ConstellationTotalsDto {
  @ApiProperty()
  sources: number;

  @ApiProperty()
  assets: number;

  @ApiProperty()
  connectedAssets: number;

  @ApiProperty()
  isolatedAssets: number;

  @ApiProperty()
  crossSourceLinks: number;
}

export class ConstellationStatsDto {
  @ApiProperty({ required: false, nullable: true })
  refreshedAt?: Date | null;

  @ApiProperty()
  isBuilt: boolean;

  @ApiProperty({
    enum: ['rollup', 'live'],
    description:
      'rollup: served from the pre-aggregated map. live: the map has not been built for this workspace yet, so only the source list is populated and a rebuild has been queued.',
  })
  source: 'rollup' | 'live';
}

/**
 * How a workspace's sources connect.
 *
 * There is no limit parameter and no `truncated` flag, because nothing here is
 * ever cut off. The response is small structurally: one row per source, one per
 * source pairing, and one per asset that actually reaches across a source
 * boundary. A workspace with two million assets across twelve sources returns
 * twelve bubbles and a few dozen links — the corpus size never enters the
 * payload, because assets connected to nothing are a count, not a row.
 *
 * When one pairing carries an unusual number of boundary assets they are folded
 * into a `bundle` rather than dropped, and expanding it fetches the members.
 * Aggregation, never truncation.
 */
export class ConstellationResponseDto {
  @ApiProperty({ type: [ConstellationSourceDto] })
  sources: ConstellationSourceDto[];

  @ApiProperty({ type: [ConstellationLinkDto] })
  links: ConstellationLinkDto[];

  @ApiProperty({ type: [ConstellationBoundaryAssetDto] })
  boundaryAssets: ConstellationBoundaryAssetDto[];

  @ApiProperty({ type: [ConstellationBundleDto] })
  bundles: ConstellationBundleDto[];

  @ApiProperty({ type: ConstellationTotalsDto })
  totals: ConstellationTotalsDto;

  @ApiProperty({ type: ConstellationStatsDto })
  stats: ConstellationStatsDto;
}
