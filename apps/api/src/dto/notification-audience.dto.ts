import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';
import { NotificationType } from '../types/notification.types';

export class NotificationAudienceDto {
  @ApiProperty({ enum: NotificationType })
  type: NotificationType;

  @ApiProperty({
    type: [String],
    description:
      "Group ids that get this kind; empty means the workspace's owning group.",
  })
  groupIds: string[];

  @ApiPropertyOptional({ nullable: true, type: String })
  updatedBy: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  updatedAt: Date | null;
}

export class UpdateNotificationAudienceDto {
  @ApiProperty({
    type: [String],
    description:
      "Group ids of your tenant; empty sends it to the workspace's owning group.",
  })
  @IsArray()
  @IsString({ each: true })
  groupIds: string[];
}
