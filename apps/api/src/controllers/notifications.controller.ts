import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { NotificationsService } from '../notifications.service';
import { QueryNotificationsDto } from '../dto/query-notifications.dto';
import { NotificationListResponseDto } from '../dto/notification-list-response.dto';
import { NotificationResponseDto } from '../dto/notification-response.dto';
import { MarkAllReadDto } from '../dto/mark-all-read.dto';
import { UpdateNotificationImportanceDto } from '../dto/update-notification-importance.dto';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List notifications',
    description: 'Retrieve notifications with optional filters and pagination.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of notifications',
    type: NotificationListResponseDto,
  })
  async listNotifications(@Query() query: QueryNotificationsDto) {
    return this.notificationsService.findAll(query);
  }

  @Patch('mark-all-read')
  @ApiOperation({
    summary: 'Mark all notifications as read',
    description:
      'Marks all unread notifications as read. Optional filters can narrow the update.',
  })
  @ApiBody({
    type: MarkAllReadDto,
    examples: {
      all: {
        summary: 'Mark all unread as read',
        value: {},
      },
      scanOnly: {
        summary: 'Mark all scan notifications as read',
        value: { type: 'SCAN' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Notifications marked as read',
    schema: {
      type: 'object',
      properties: {
        updated: { type: 'number', example: 5 },
      },
    },
  })
  async markAllRead(@Body() body: MarkAllReadDto) {
    return this.notificationsService.markAllRead(body);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiParam({
    name: 'id',
    description: 'Notification ID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'Notification marked as read',
    type: NotificationResponseDto,
  })
  async markRead(@Param('id') id: string) {
    return this.notificationsService.markRead(id);
  }

  @Patch(':id/important')
  @ApiOperation({ summary: 'Set notification importance' })
  @ApiParam({
    name: 'id',
    description: 'Notification ID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiBody({ type: UpdateNotificationImportanceDto })
  @ApiResponse({
    status: 200,
    description: 'Notification importance updated',
    type: NotificationResponseDto,
  })
  async setImportant(
    @Param('id') id: string,
    @Body() body: UpdateNotificationImportanceDto,
  ) {
    return this.notificationsService.setImportant(id, body.important);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a notification' })
  @ApiParam({
    name: 'id',
    description: 'Notification ID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'Notification deleted',
    schema: {
      type: 'object',
      properties: {
        deleted: { type: 'boolean', example: true },
      },
    },
  })
  async deleteNotification(@Param('id') id: string) {
    return this.notificationsService.delete(id);
  }
}
