import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CaseActivityType } from '@prisma/client';

export class CaseActivityDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  caseId!: string;

  @ApiProperty({ enum: CaseActivityType })
  activityType!: CaseActivityType;

  @ApiPropertyOptional()
  actor?: string | null;

  @ApiProperty()
  payload!: Record<string, unknown>;

  @ApiProperty()
  createdAt!: Date;
}

export class CaseTimelineResponseDto {
  @ApiProperty({ type: [CaseActivityDto] })
  items!: CaseActivityDto[];

  @ApiPropertyOptional({ nullable: true })
  nextCursor!: string | null;
}
