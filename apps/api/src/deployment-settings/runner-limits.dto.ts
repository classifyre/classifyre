import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { MAX_RUNNER_LIMIT } from './deployment-settings.service';

export class RunnerLimitDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Saved in Settings, or null when the limit follows the deployment.',
  })
  override: number | null;

  @ApiProperty({
    description:
      'What the Helm chart or all-in-one image sets (or the built-in default).',
  })
  deploymentDefault: number;

  @ApiProperty({ description: 'What is in force right now.' })
  effective: number;
}

export class RunnerLimitsDto {
  @ApiProperty({ type: RunnerLimitDto })
  maxRunnersPerSource: RunnerLimitDto;

  @ApiProperty({ type: RunnerLimitDto })
  maxConcurrentRunners: RunnerLimitDto;

  @ApiProperty({ type: RunnerLimitDto })
  autoScheduleMaxConcurrent: RunnerLimitDto;
}

export class UpdateRunnerLimitsDto {
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0 })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_RUNNER_LIMIT)
  maxRunnersPerSource?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0 })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_RUNNER_LIMIT)
  maxConcurrentRunners?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0 })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_RUNNER_LIMIT)
  autoScheduleMaxConcurrent?: number | null;
}
