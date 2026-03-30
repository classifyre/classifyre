import {
  IsString,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Severity } from '@prisma/client';
import { NotificationType } from '../types/notification.types';

export class CreateNotificationDto {
  @ApiProperty({ enum: NotificationType })
  @IsEnum(NotificationType)
  type: NotificationType;

  @ApiPropertyOptional({
    description: 'Event key for this notification (e.g. scan.completed)',
  })
  @IsOptional()
  @IsString()
  event?: string;

  @ApiPropertyOptional({ enum: Severity, default: Severity.INFO })
  @IsOptional()
  @IsEnum(Severity)
  severity?: Severity = Severity.INFO;

  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty()
  @IsString()
  message: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actionUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  runnerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  findingId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  triggeredBy?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isImportant?: boolean = false;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
