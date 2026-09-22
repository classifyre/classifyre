import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InquiryActivityType } from '@prisma/client';

export class InquiryActivityDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  inquiryId!: string;

  @ApiProperty({ enum: InquiryActivityType })
  activityType!: InquiryActivityType;

  @ApiPropertyOptional()
  actor?: string | null;

  @ApiProperty()
  payload!: Record<string, unknown>;

  @ApiProperty()
  createdAt!: Date;
}

export class InquiryTimelineResponseDto {
  @ApiProperty({ type: [InquiryActivityDto] })
  items!: InquiryActivityDto[];

  @ApiPropertyOptional({ nullable: true })
  nextCursor!: string | null;
}
