import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustomDetectorTrainingStatus } from '@prisma/client';

export class CustomDetectorTrainingRunDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  customDetectorId: string;

  @ApiPropertyOptional()
  sourceId?: string | null;

  @ApiProperty({ enum: CustomDetectorTrainingStatus })
  status: CustomDetectorTrainingStatus;

  @ApiPropertyOptional()
  strategy?: string | null;

  @ApiProperty()
  startedAt: Date;

  @ApiPropertyOptional()
  completedAt?: Date | null;

  @ApiPropertyOptional()
  durationMs?: number | null;

  @ApiPropertyOptional()
  trainedExamples?: number | null;

  @ApiPropertyOptional()
  positiveExamples?: number | null;

  @ApiPropertyOptional()
  negativeExamples?: number | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  metrics?: Record<string, unknown> | null;

  @ApiPropertyOptional()
  modelArtifactPath?: string | null;

  @ApiPropertyOptional()
  configHash?: string | null;

  @ApiPropertyOptional()
  errorMessage?: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
