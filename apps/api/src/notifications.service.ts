import {
  BadRequestException,
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
import { ClsService } from 'nestjs-cls';
import { CLS_NAMESPACE_ID, CLS_SLUG } from './namespace/namespace.constants';
import { CLS_PERSON, type ClsPerson } from './identity/iam-access-policy';
import { TenancyService } from './identity/tenancy.service';

type NotificationRow = Prisma.NotificationGetPayload<{
  include: {
    source: { select: { id: true; name: true } };
    states: true;
  };
}>;

export interface NotificationAudienceView {
  type: NotificationType;
  /** Groups that get this kind; empty means the workspace's owning group. */
  groupIds: string[];
  updatedBy: string | null;
  updatedAt: Date | null;
}

const NOTIFICATION_TYPES = Object.values(NotificationType);
/** How long a workspace's owning group is reused before it is read again. */
const OWNER_CACHE_MS = 60_000;

/**
 * Notifications go to groups (docs/prd/IAM-access-management.md §6.4). Each
 * one is sent to the groups chosen for its kind in the workspace, or to the
 * workspace's owning group when none are chosen, and fixes that audience when
 * it is made. A person sees it when they are in one of those groups or a group
 * below one. Read, importance and dismissal are each person's own. Visitors
 * of a public tenant are in no group and get none.
 */
@Injectable()
export class NotificationsService {
  private readonly owners = new Map<
    string,
    { ownerGroupId: string | null; at: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
    private readonly tenancy: TenancyService,
    @Optional()
    @Inject(NotificationEventsGateway)
    private readonly notificationEventsGateway?: NotificationEventsGateway,
  ) {}

  private toPrismaType(type: NotificationType): PrismaNotificationType {
    return type;
  }

  /**
   * Producers store namespace-relative action URLs (`/scans/<id>`). The web app
   * routes every tenant page under `/<slug>/…`, so qualify on the way out —
   * at read time, not write time, because the slug is editable and a stored
   * prefix would go stale on rename.
   */
  private qualifyActionUrl(actionUrl: unknown): string | null {
    if (typeof actionUrl !== 'string' || !actionUrl.startsWith('/')) {
      return (actionUrl as string | null) ?? null;
    }
    const slug = this.cls.get<string>(CLS_SLUG);
    if (!slug) return actionUrl;
    if (actionUrl === `/${slug}` || actionUrl.startsWith(`/${slug}/`)) {
      return actionUrl;
    }
    return `/${slug}${actionUrl}`;
  }

  private toResponse(
    notification: Omit<NotificationRow, 'states'> & {
      states?: NotificationRow['states'];
    },
  ): NotificationResponseDto {
    const state = notification.states?.[0];
    return {
      id: notification.id,
      type: notification.type as NotificationType,
      event: notification.event,
      severity: notification.severity,
      title: notification.title,
      message: notification.message,
      actionUrl: this.qualifyActionUrl(notification.actionUrl),
      sourceId: notification.sourceId,
      sourceName: notification.source?.name ?? null,
      runnerId: notification.runnerId,
      findingId: notification.findingId,
      triggeredBy: notification.triggeredBy,
      read: Boolean(state?.readAt),
      readAt: state?.readAt ?? null,
      important: state?.important ?? notification.isImportant,
      metadata: notification.metadata as Record<string, unknown> | null,
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt,
    };
  }

  /** The person asking; null outside a signed-in request (jobs, callbacks). */
  private person(): ClsPerson | null {
    if (!this.cls.isActive()) return null;
    return this.cls.get<ClsPerson>(CLS_PERSON) ?? null;
  }

  private requirePerson(): ClsPerson {
    const person = this.person();
    if (!person) {
      throw new BadRequestException(
        'Notifications belong to a signed-in person.',
      );
    }
    return person;
  }

  /** The workspace's owning group, briefly cached. */
  private async ownerGroupId(): Promise<string | null> {
    const namespaceId = this.cls.get<string>(CLS_NAMESPACE_ID);
    if (!namespaceId) return null;
    const cached = this.owners.get(namespaceId);
    if (cached && Date.now() - cached.at < OWNER_CACHE_MS) {
      return cached.ownerGroupId;
    }
    const tenancy = await this.tenancy.workspaceTenancy(namespaceId);
    const ownerGroupId = tenancy?.ownerGroupId ?? null;
    this.owners.set(namespaceId, { ownerGroupId, at: Date.now() });
    return ownerGroupId;
  }

  /** What the person may see: sent to one of their groups, not dismissed. */
  private async visibleTo(
    person: ClsPerson,
  ): Promise<Prisma.NotificationWhereInput> {
    const owner = await this.ownerGroupId();
    const audiences: Prisma.NotificationWhereInput[] = [
      { audienceGroupIds: { hasSome: person.groupIds } },
    ];
    if (owner && person.groupIds.includes(owner)) {
      audiences.push({ audienceGroupIds: { isEmpty: true } });
    }
    return {
      OR: audiences,
      states: {
        none: { actorRef: person.actorRef, dismissedAt: { not: null } },
      },
    };
  }

  private filtersOf(
    filters: Partial<MarkAllReadDto & QueryNotificationsDto>,
    person: ClsPerson,
  ): Prisma.NotificationWhereInput[] {
    const and: Prisma.NotificationWhereInput[] = [];
    if (filters.type) and.push({ type: this.toPrismaType(filters.type) });
    if (filters.event) and.push({ event: filters.event });
    if (filters.severity) and.push({ severity: filters.severity });
    if (filters.sourceId) and.push({ sourceId: filters.sourceId });
    if (filters.runnerId) and.push({ runnerId: filters.runnerId });
    if (filters.findingId) and.push({ findingId: filters.findingId });
    if (filters.importantOnly) {
      and.push({
        OR: [
          { states: { some: { actorRef: person.actorRef, important: true } } },
          {
            isImportant: true,
            states: { none: { actorRef: person.actorRef, important: false } },
          },
        ],
      });
    }
    return and;
  }

  private unread(person: ClsPerson): Prisma.NotificationWhereInput {
    return {
      states: { none: { actorRef: person.actorRef, readAt: { not: null } } },
    };
  }

  private includeFor(person: ClsPerson) {
    return {
      source: { select: { id: true, name: true } },
      states: { where: { actorRef: person.actorRef } },
    } as const;
  }

  /** Groups chosen for a kind of notification here; empty: the owning group. */
  private async audienceFor(type: NotificationType): Promise<string[]> {
    const row = await this.prisma.notificationAudience.findUnique({
      where: { type: this.toPrismaType(type) },
    });
    return row?.groupIds ?? [];
  }

  async create(
    createDto: CreateNotificationDto,
  ): Promise<NotificationResponseDto> {
    const audienceGroupIds = await this.audienceFor(createDto.type);
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
        audienceGroupIds,
        metadata: createDto.metadata as Prisma.JsonObject | undefined,
      },
      include: {
        source: { select: { id: true, name: true } },
      },
    });

    const response = this.toResponse(notification);
    const owner = audienceGroupIds.length ? null : await this.ownerGroupId();
    const groups = audienceGroupIds.length
      ? audienceGroupIds
      : owner
        ? [owner]
        : [];
    this.notificationEventsGateway?.emitNotificationCreated(response, groups);
    return response;
  }

  async findAll(query: QueryNotificationsDto) {
    const person = this.requirePerson();
    const visible = await this.visibleTo(person);
    const and = [visible, ...this.filtersOf(query, person)];
    if (query.unreadOnly) and.push(this.unread(person));
    const where: Prisma.NotificationWhereInput = { AND: and };

    const skip =
      typeof query.skip === 'string'
        ? parseInt(query.skip, 10)
        : (query.skip ?? 0);
    const take =
      typeof query.take === 'string'
        ? parseInt(query.take, 10)
        : (query.take ?? 50);

    const [notifications, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        include: this.includeFor(person),
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: { AND: [...and, this.unread(person)] },
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

  /** Writes one person's state on notifications they can see. */
  private async setState(
    person: ClsPerson,
    ids: string[],
    data: Pick<
      Prisma.NotificationStateUncheckedCreateInput,
      'readAt' | 'important' | 'dismissedAt'
    >,
  ): Promise<void> {
    if (!ids.length) return;
    await this.prisma.$transaction([
      this.prisma.notificationState.createMany({
        data: ids.map((notificationId) => ({
          notificationId,
          actorRef: person.actorRef,
          ...data,
        })),
        skipDuplicates: true,
      }),
      this.prisma.notificationState.updateMany({
        where: { actorRef: person.actorRef, notificationId: { in: ids } },
        data,
      }),
    ]);
  }

  private async visibleOne(person: ClsPerson, id: string) {
    const found = await this.prisma.notification.findFirst({
      where: { AND: [{ id }, await this.visibleTo(person)] },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException(`Notification with ID ${id} not found`);
    }
  }

  private async reload(
    person: ClsPerson,
    id: string,
  ): Promise<NotificationResponseDto> {
    const notification = await this.prisma.notification.findUniqueOrThrow({
      where: { id },
      include: this.includeFor(person),
    });
    return this.toResponse(notification);
  }

  async markAllRead(filters: MarkAllReadDto) {
    const person = this.requirePerson();
    const rows = await this.prisma.notification.findMany({
      where: {
        AND: [
          await this.visibleTo(person),
          ...this.filtersOf(filters, person),
          this.unread(person),
        ],
      },
      select: { id: true },
    });
    const ids = rows.map((row) => row.id);
    // Only unread ones were picked, so their state rows have no readAt yet.
    await this.setState(person, ids, { readAt: new Date() });
    if (ids.length > 0) {
      this.notificationEventsGateway?.emitNotificationsChanged(
        person.actorRef,
        { updated: ids.length },
      );
    }
    return { updated: ids.length };
  }

  /** One visible notification → new own state → fresh response. */
  private async transitionOne(
    person: ClsPerson,
    id: string,
    data: Pick<
      Prisma.NotificationStateUncheckedCreateInput,
      'readAt' | 'important' | 'dismissedAt'
    >,
  ): Promise<NotificationResponseDto> {
    await this.visibleOne(person, id);
    await this.setState(person, [id], data);
    return this.reload(person, id);
  }

  async markRead(id: string): Promise<NotificationResponseDto> {
    const person = this.requirePerson();
    const response = await this.transitionOne(person, id, {
      readAt: new Date(),
    });
    this.notificationEventsGateway?.emitNotificationUpdated(
      person.actorRef,
      response,
    );
    return response;
  }

  async setImportant(
    id: string,
    important: boolean,
  ): Promise<NotificationResponseDto> {
    const person = this.requirePerson();
    const response = await this.transitionOne(person, id, { important });
    this.notificationEventsGateway?.emitNotificationUpdated(
      person.actorRef,
      response,
    );
    return response;
  }

  /** Hides it for this person only; everyone else in its groups keeps it. */
  async dismiss(id: string) {
    const person = this.requirePerson();
    await this.visibleOne(person, id);
    await this.setState(person, [id], { dismissedAt: new Date() });
    this.notificationEventsGateway?.emitNotificationDeleted(
      person.actorRef,
      id,
    );
    return { deleted: true };
  }

  async audiences(): Promise<NotificationAudienceView[]> {
    const rows = await this.prisma.notificationAudience.findMany();
    return NOTIFICATION_TYPES.map((type) => {
      const row = rows.find((r) => r.type === this.toPrismaType(type));
      return {
        type,
        groupIds: row?.groupIds ?? [],
        updatedBy: row?.updatedBy ?? null,
        updatedAt: row?.updatedAt ?? null,
      };
    });
  }

  /** Chooses the groups a kind goes to from now on; empty: the owning group. */
  async setAudience(
    type: NotificationType,
    groupIds: string[],
    updatedBy: string | undefined,
  ): Promise<NotificationAudienceView> {
    const unique = [...new Set(groupIds)];
    const row = await this.prisma.notificationAudience.upsert({
      where: { type: this.toPrismaType(type) },
      create: {
        type: this.toPrismaType(type),
        groupIds: unique,
        updatedBy: updatedBy ?? null,
      },
      update: { groupIds: unique, updatedBy: updatedBy ?? null },
    });
    return {
      type,
      groupIds: row.groupIds,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    };
  }
}
