import { ApiProperty } from '@nestjs/swagger';
import { Severity } from '@prisma/client';

export class SearchAssetsChartsTotalsDto {
  @ApiProperty()
  totalAssets: number;

  @ApiProperty()
  newAssets: number;

  @ApiProperty()
  updatedAssets: number;

  @ApiProperty()
  unchangedAssets: number;
}

export class SearchAssetsChartsTopAssetDto {
  @ApiProperty()
  assetId: string;

  @ApiProperty()
  assetName: string;

  @ApiProperty()
  findingsCount: number;

  @ApiProperty({
    description: 'Severity score used for visualization color mapping (1..5)',
  })
  severityScore: number;

  @ApiProperty({ enum: Severity })
  highestSeverity: Severity;

  @ApiProperty({ required: false, nullable: true })
  sourceId?: string | null;
}

export class SearchAssetsChartsTopSourceDto {
  @ApiProperty()
  sourceId: string;

  @ApiProperty()
  sourceName: string;

  @ApiProperty()
  assetCount: number;
}

export class SearchAssetsChartsResponseDto {
  @ApiProperty({ type: SearchAssetsChartsTotalsDto })
  totals: SearchAssetsChartsTotalsDto;

  @ApiProperty({ type: [SearchAssetsChartsTopAssetDto] })
  topAssetsByFindings: SearchAssetsChartsTopAssetDto[];

  @ApiProperty({ type: [SearchAssetsChartsTopSourceDto] })
  topSourcesByAssetVolume: SearchAssetsChartsTopSourceDto[];
}
