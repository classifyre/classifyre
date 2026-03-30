import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LatestRunnerSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional({ nullable: true })
  startedAt?: Date | null;

  @ApiPropertyOptional({ nullable: true })
  completedAt?: Date | null;

  @ApiPropertyOptional({ nullable: true })
  durationMs?: number | null;

  @ApiProperty()
  assetsCreated: number;

  @ApiProperty()
  assetsUpdated: number;

  @ApiProperty()
  assetsUnchanged: number;

  @ApiProperty()
  assetsDeleted: number;

  @ApiProperty()
  totalFindings: number;

  @ApiPropertyOptional({ nullable: true })
  errorMessage?: string | null;

  @ApiProperty()
  triggeredAt: Date;
}

export class SearchSourceItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  type: string;

  @ApiPropertyOptional({ nullable: true })
  runnerStatus?: string | null;

  @ApiPropertyOptional({ type: LatestRunnerSummaryDto, nullable: true })
  latestRunner?: LatestRunnerSummaryDto | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ example: false })
  scheduleEnabled: boolean;

  @ApiPropertyOptional({ nullable: true, example: '30 1 * * *' })
  scheduleCron?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'UTC' })
  scheduleTimezone?: string | null;

  @ApiPropertyOptional({ nullable: true, example: null })
  scheduleNextAt?: Date | null;
}

export class SearchSourcesTotalsDto {
  @ApiProperty({ description: 'Total number of sources (unfiltered)' })
  total: number;

  @ApiProperty({ description: 'Sources with COMPLETED runner status' })
  healthy: number;

  @ApiProperty({ description: 'Sources with ERROR runner status' })
  errors: number;

  @ApiProperty({ description: 'Sources with RUNNING or PENDING runner status' })
  running: number;
}

export class SearchSourcesResponseDto {
  @ApiProperty({ type: [SearchSourceItemDto] })
  items: SearchSourceItemDto[];

  @ApiProperty({ description: 'Total sources matching the current filter' })
  total: number;

  @ApiProperty()
  skip: number;

  @ApiProperty()
  limit: number;

  @ApiProperty({ type: SearchSourcesTotalsDto })
  totals: SearchSourcesTotalsDto;
}
