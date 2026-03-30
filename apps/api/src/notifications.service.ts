import {
  Injectable,
  NotFoundException,
  Optional,
  Inject,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { MarkAllReadDto } from './dto/mark-all-read.dto';
import { NotificationResponseDto } from './dto/notification-response.dto';
import {
  Prisma,
  NotificationType as PrismaNotificationType,
} from '@prisma/client';
import { NotificationType } from './types/notification.types';
import { NotificationEventsGateway } from './websocket/notification-events.gateway';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(NotificationEventsGateway)
    private readonly notificationEventsGateway?: NotificationEventsGateway,
  ) {}

  private toPrismaType(type: NotificationType): PrismaNotificationType {
    return type as unknown as PrismaNotificationType;
  }

  private toResponse(notification: any): NotificationResponseDto {
    return {
      id: notification.id,
      type: notification.type,
      event: notification.event,
      severity: notification.severity,
      title: notification.title,
      message: notification.message,
      actionUrl: notification.actionUrl,
      sourceId: notification.sourceId,
      sourceName: notification.source?.name ?? null,
      runnerId: notification.runnerId,
      findingId: notification.findingId,
      triggeredBy: notification.triggeredBy,
      read: notification.isRead,
      readAt: notification.readAt,
      important: notification.isImportant,
      metadata: notification.metadata,
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt,
    };
  }

  async create(
    createDto: CreateNotificationDto,
  ): Promise<NotificationResponseDto> {
    const notification = await this.prisma.notification.create({
      data: {
        type: this.toPrismaType(createDto.type),
        event: createDto.event,
        severity: createDto.severity,
        title: createDto.title,
        message: createDto.message,
        actionUrl: createDto.actionUrl,
        sourceId: createDto.sourceId,
        runnerId: createDto.runnerId,
        findingId: createDto.findingId,
        triggeredBy: createDto.triggeredBy,
        isImportant: createDto.isImportant ?? false,

        metadata: createDto.metadata as Prisma.JsonObject | undefined,
      },
      include: {
        source: { select: { id: true, name: true } },
      },
    });

    const response = this.toResponse(notification);
    this.notificationEventsGateway?.emitNotificationCreated(response);
    return response;
  }

  async findAll(query: QueryNotificationsDto) {
    const where: Prisma.NotificationWhereInput = {};

    if (query.type) where.type = this.toPrismaType(query.type);
    if (query.event) where.event = query.event;
    if (query.severity) where.severity = query.severity;
    if (query.sourceId) where.sourceId = query.sourceId;
    if (query.runnerId) where.runnerId = query.runnerId;
    if (query.findingId) where.findingId = query.findingId;
    if (query.unreadOnly) where.isRead = false;
    if (query.importantOnly) where.isImportant = true;

    const skip =
      typeof query.skip === 'string'
        ? parseInt(query.skip, 10)
        : (query.skip ?? 0);
    const take =
      typeof query.take === 'string'
        ? parseInt(query.take, 10)
        : (query.take ?? 50);

    const [notifications, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        include: {
          source: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: {
          ...where,
          isRead: false,
        },
      }),
    ]);

    return {
      notifications: notifications.map((notification) =>
        this.toResponse(notification),
      ),
      total,
      unreadCount,
      skip,
      take,
    };
  }

  async markAllRead(filters: MarkAllReadDto) {
    const where: Prisma.NotificationWhereInput = { isRead: false };

    if (filters.type) where.type = this.toPrismaType(filters.type);
    if (filters.event) where.event = filters.event;
    if (filters.severity) where.severity = filters.severity;
    if (filters.sourceId) where.sourceId = filters.sourceId;
    if (filters.runnerId) where.runnerId = filters.runnerId;
    if (filters.findingId) where.findingId = filters.findingId;
    if (filters.importantOnly) where.isImportant = true;

    const result = await this.prisma.notification.updateMany({
      where,
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    if (result.count > 0) {
      this.notificationEventsGateway?.emitNotificationsChanged({
        updated: result.count,
      });
    }

    return { updated: result.count };
  }

  async markRead(id: string): Promise<NotificationResponseDto> {
    const existing = await this.prisma.notification.findUnique({
      where: { id },
      include: { source: { select: { id: true, name: true } } },
    });
    if (!existing) {
      throw new NotFoundException(`Notification with ID ${id} not found`);
    }

    const notification = await this.prisma.notification.update({
      where: { id },
      data: {
        isRead: true,
        readAt: new Date(),
      },
      include: { source: { select: { id: true, name: true } } },
    });

    const response = this.toResponse(notification);
    this.notificationEventsGateway?.emitNotificationUpdated(response);
    return response;
  }

  async setImportant(
    id: string,
    important: boolean,
  ): Promise<NotificationResponseDto> {
    const existing = await this.prisma.notification.findUnique({
      where: { id },
      include: { source: { select: { id: true, name: true } } },
    });
    if (!existing) {
      throw new NotFoundException(`Notification with ID ${id} not found`);
    }

    const notification = await this.prisma.notification.update({
      where: { id },
      data: {
        isImportant: important,
      },
      include: { source: { select: { id: true, name: true } } },
    });

    const response = this.toResponse(notification);
    this.notificationEventsGateway?.emitNotificationUpdated(response);
    return response;
  }

  async delete(id: string) {
    const existing = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Notification with ID ${id} not found`);
    }

    await this.prisma.notification.delete({ where: { id } });
    this.notificationEventsGateway?.emitNotificationDeleted(id);
    return { deleted: true };
  }
}
