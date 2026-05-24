import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SourceResponseDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id: string;

  @ApiProperty({ example: 'Production WordPress' })
  name: string;

  @ApiProperty({ example: 'WORDPRESS' })
  type: string;

  @ApiProperty()
  config: Record<string, unknown>;

  @ApiProperty({ nullable: true, example: null })
  currentRunnerId: string | null;

  @ApiProperty({ example: 'PENDING' })
  runnerStatus: string;

  @ApiPropertyOptional({ nullable: true, example: 'COMPLETED' })
  lastRunStatus: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-01-31T10:00:00.000Z' })
  lastRunAt: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    example: null,
    description:
      'Human-readable error message from the most recent failed run. Cleared on success.',
  })
  lastErrorMessage: string | null;

  @ApiProperty({ example: 0 })
  consecutiveFailures: number;

  @ApiProperty({ example: '2026-01-31T10:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-01-31T10:00:00.000Z' })
  updatedAt: Date;

  @ApiProperty({ example: false })
  scheduleEnabled: boolean;

  @ApiProperty({ nullable: true, example: '30 1 * * *' })
  scheduleCron: string | null;

  @ApiProperty({ nullable: true, example: 'UTC' })
  scheduleTimezone: string | null;

  @ApiProperty({ nullable: true, example: null })
  scheduleNextAt: Date | null;
}
