import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { NotificationResponseDto } from '../dto/notification-response.dto';
import { ClsService } from 'nestjs-cls';
import { CLS_SCHEMA } from '../namespace/namespace.constants';
import { NamespaceRegistryService } from '../registry/namespace-registry.service';
import { SocketAccessService } from '../identity/socket-access.service';

@WebSocketGateway({
  cors: {
    origin: process.env.WEBSOCKET_CORS_ORIGIN?.split(',') || [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
    ],
    credentials: true,
    methods: ['GET', 'POST'],
  },
  namespace: '/notifications',
  transports: ['websocket', 'polling'],
  allowEIO3: true,
})
export class NotificationEventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationEventsGateway.name);

  constructor(
    private readonly cls: ClsService,
    private readonly namespaces: NamespaceRegistryService,
    private readonly socketAccess: SocketAccessService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(
      `WebSocket client connected: ${client.id} from ${client.handshake.address}`,
    );
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`WebSocket client disconnected: ${client.id}`);
  }

  /**
   * A socket joins its workspace's notification rooms: one per group the
   * person is in (with the groups above), where new notifications sent to
   * those groups arrive, and the person's own, where their read, importance
   * and dismissals arrive. Visitors are in no group and are refused.
   */
  @SubscribeMessage('subscribe:notifications')
  async handleSubscribeNotifications(client: Socket) {
    const schema = await this.resolveClientSchema(client);
    if (!schema) return { success: false, message: 'Unknown namespace' };
    const person = await this.socketAccess.person(client);
    if (!person) return { success: false, message: 'Not signed in' };
    await client.join([
      this.room(schema),
      this.personRoom(schema, person.actorRef),
      ...person.groupIds.map((groupId) => this.groupRoom(schema, groupId)),
    ]);
    this.logger.log(`Client ${client.id} subscribed to notifications`);
    return { success: true, message: 'Subscribed to notifications' };
  }

  @SubscribeMessage('unsubscribe:notifications')
  async handleUnsubscribeNotifications(client: Socket) {
    const schema = await this.resolveClientSchema(client);
    if (!schema) return { success: false, message: 'Unknown namespace' };
    for (const room of client.rooms) {
      if (room.startsWith(this.room(schema))) await client.leave(room);
    }
    this.logger.log(`Client ${client.id} unsubscribed from notifications`);
    return { success: true, message: 'Unsubscribed from notifications' };
  }

  /** A new notification, to the groups it was sent to. */
  emitNotificationCreated(
    notification: NotificationResponseDto,
    groupIds: string[],
  ) {
    if (!groupIds.length) return;
    const schema = this.currentSchema();
    this.server
      .to(groupIds.map((groupId) => this.groupRoom(schema, groupId)))
      .emit('notification:created', notification);
  }

  /** One person's read or importance changed, on their own sockets. */
  emitNotificationUpdated(
    actorRef: string,
    notification: NotificationResponseDto,
  ) {
    this.server
      .to(this.personRoom(this.currentSchema(), actorRef))
      .emit('notification:updated', notification);
  }

  /** One person dismissed a notification, on their own sockets. */
  emitNotificationDeleted(actorRef: string, notificationId: string) {
    this.server
      .to(this.personRoom(this.currentSchema(), actorRef))
      .emit('notification:deleted', { id: notificationId });
  }

  emitNotificationsChanged(actorRef: string, payload?: { updated?: number }) {
    this.server
      .to(this.personRoom(this.currentSchema(), actorRef))
      .emit('notifications:changed', payload ?? {});
  }

  stopForSchema(schema: string): void {
    this.server?.in(this.room(schema)).disconnectSockets(true);
  }

  private currentSchema(): string {
    const schema = this.cls.get<string>(CLS_SCHEMA);
    if (!schema) {
      throw new Error(
        'Cannot emit notification events outside a namespace context',
      );
    }
    return schema;
  }

  private room(schema: string): string {
    return `${schema}:notifications`;
  }

  private groupRoom(schema: string, groupId: string): string {
    return `${this.room(schema)}:g:${groupId}`;
  }

  private personRoom(schema: string, actorRef: string): string {
    return `${this.room(schema)}:p:${actorRef}`;
  }

  private async resolveClientSchema(client: Socket): Promise<string | null> {
    const cached = client.data['classifyreSchema'];
    if (typeof cached === 'string') return cached;
    const slug = client.handshake.auth?.['namespaceSlug'];
    if (typeof slug !== 'string') return null;
    const namespace = await this.namespaces.resolve(slug);
    if (!namespace) return null;
    if (
      !(await this.socketAccess.canJoin(
        client,
        namespace.namespaceId,
        'notification.view',
      ))
    ) {
      return null;
    }
    client.data['classifyreSchema'] = namespace.schemaName;
    return namespace.schemaName;
  }
}
