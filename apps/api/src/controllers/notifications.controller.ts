import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Patch,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
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
import { Requires } from '../identity/access.decorators';
import { ActorRef } from '../identity/actor-ref.decorator';
import { ActorContextService } from '../identity/actor-context.service';
import type { IdentityService } from '../identity/identity.service';
import { IDENTITY } from '../identity/identity.tokens';
import { TenancyService } from '../identity/tenancy.service';
import {
  NotificationAudienceDto,
  UpdateNotificationAudienceDto,
} from '../dto/notification-audience.dto';
import { NotificationType } from '../types/notification.types';

/**
 * The notifications sent to the caller's groups, and their own read,
 * importance and dismissal (docs/prd/IAM-access-management.md §6.4). Those
 * are personal, so they need only `notification.view`; which groups get each
 * kind is the workspace's, and needs `access.manage`.
 */
@ApiTags('Notifications')
@Requires('notification.view')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly actors: ActorContextService,
    private readonly tenancy: TenancyService,
    @Inject(IDENTITY) private readonly identity: IdentityService,
  ) {}

  @Get('audiences')
  @ApiOperation({
    summary: 'Which groups get each kind of notification',
    description:
      "An empty list means the workspace's owning group. A notification keeps the groups it was sent to.",
  })
  @ApiResponse({ status: 200, type: [NotificationAudienceDto] })
  async audiences(): Promise<NotificationAudienceDto[]> {
    return this.notificationsService.audiences();
  }

  @Put('audiences/:type')
  @Requires('access.manage')
  @ApiOperation({
    summary: 'Choose which groups get a kind of notification',
    description:
      'Groups of your tenant; an empty list sends it to the owning group again. Applies to notifications made from now on.',
  })
  @ApiParam({ name: 'type', enum: NotificationType })
  @ApiBody({ type: UpdateNotificationAudienceDto })
  @ApiResponse({ status: 200, type: NotificationAudienceDto })
  async setAudience(
    @Req() request: FastifyRequest,
    @Param('type') type: string,
    @Body() body: UpdateNotificationAudienceDto,
    @ActorRef() actor: string | undefined,
  ): Promise<NotificationAudienceDto> {
    if (!(Object.values(NotificationType) as string[]).includes(type)) {
      throw new BadRequestException(`Unknown notification type '${type}'.`);
    }
    const groupIds = Array.isArray(body?.groupIds) ? body.groupIds : [];
    if (groupIds.some((id) => typeof id !== 'string') || groupIds.length > 50) {
      throw new BadRequestException('Pick up to 50 groups.');
    }
    const principal = await this.identity.authenticate(request.raw);
    const unknown = await this.identity.unknownGroupId(principal, groupIds);
    if (unknown) {
      throw new BadRequestException(`No group '${unknown}' in your tenant.`);
    }
    const saved = await this.notificationsService.setAudience(
      type as NotificationType,
      groupIds,
      actor,
    );
    // Audience changes are tenant-visible: which groups get SCAN/FINDING/…
    // in this workspace is access policy, so it lands in the same trail as
    // grants. The workspace trail records the PUT through the interceptor.
    const workspaceId = this.actors.workspaceId();
    await this.tenancy.recordTenantEvent(
      principal.tenant.id,
      principal.actor.ref,
      groupIds.length === 0
        ? 'notification.audience.reset'
        : 'notification.audience.set',
      {
        type,
        groupIds,
        ...(workspaceId ? { namespaceId: workspaceId } : {}),
      },
    );
    return saved;
  }

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
    summary: 'Mark all your notifications as read',
    description:
      'Marks every unread notification you get as read, for you. Optional filters can narrow the update.',
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
  @ApiOperation({
    summary: 'Dismiss a notification',
    description: 'Hides it for you only; everyone else in its groups keeps it.',
  })
  @ApiParam({
    name: 'id',
    description: 'Notification ID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'Notification dismissed for you',
    schema: {
      type: 'object',
      properties: {
        deleted: { type: 'boolean', example: true },
      },
    },
  })
  async deleteNotification(@Param('id') id: string) {
    return this.notificationsService.dismiss(id);
  }
}
