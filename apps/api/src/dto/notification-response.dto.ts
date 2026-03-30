import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Severity } from '@prisma/client';
import { NotificationType } from '../types/notification.types';

export class NotificationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: NotificationType })
  type: NotificationType;

  @ApiPropertyOptional()
  event?: string | null;

  @ApiProperty({ enum: Severity })
  severity: Severity;

  @ApiProperty()
  title: string;

  @ApiProperty()
  message: string;

  @ApiPropertyOptional()
  actionUrl?: string | null;

  @ApiPropertyOptional()
  sourceId?: string | null;

  @ApiPropertyOptional()
  sourceName?: string | null;

  @ApiPropertyOptional()
  runnerId?: string | null;

  @ApiPropertyOptional()
  findingId?: string | null;

  @ApiPropertyOptional()
  triggeredBy?: string | null;

  @ApiProperty()
  read: boolean;

  @ApiPropertyOptional()
  readAt?: Date | null;

  @ApiProperty()
  important: boolean;

  @ApiPropertyOptional({ type: Object })
  metadata?: Record<string, any> | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
