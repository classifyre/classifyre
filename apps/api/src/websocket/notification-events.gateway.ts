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
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(
      `WebSocket client connected: ${client.id} from ${client.handshake.address}`,
    );
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`WebSocket client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe:notifications')
  async handleSubscribeNotifications(client: Socket) {
    const schema = await this.resolveClientSchema(client);
    if (!schema) return { success: false, message: 'Unknown namespace' };
    await client.join(this.room(schema));
    this.logger.log(`Client ${client.id} subscribed to notifications`);
    return { success: true, message: 'Subscribed to notifications' };
  }

  @SubscribeMessage('unsubscribe:notifications')
  async handleUnsubscribeNotifications(client: Socket) {
    const schema = await this.resolveClientSchema(client);
    if (!schema) return { success: false, message: 'Unknown namespace' };
    await client.leave(this.room(schema));
    this.logger.log(`Client ${client.id} unsubscribed from notifications`);
    return { success: true, message: 'Unsubscribed from notifications' };
  }

  emitNotificationCreated(notification: NotificationResponseDto) {
    this.server
      .to(this.room(this.currentSchema()))
      .emit('notification:created', notification);
  }

  emitNotificationUpdated(notification: NotificationResponseDto) {
    this.server
      .to(this.room(this.currentSchema()))
      .emit('notification:updated', notification);
  }

  emitNotificationDeleted(notificationId: string) {
    this.server
      .to(this.room(this.currentSchema()))
      .emit('notification:deleted', {
        id: notificationId,
      });
  }

  emitNotificationsChanged(payload?: { updated?: number }) {
    this.server
      .to(this.room(this.currentSchema()))
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

  private async resolveClientSchema(client: Socket): Promise<string | null> {
    const cached = client.data['classifyreSchema'];
    if (typeof cached === 'string') return cached;
    const slug = client.handshake.auth?.['namespaceSlug'];
    if (typeof slug !== 'string') return null;
    const namespace = await this.namespaces.resolve(slug);
    if (!namespace) return null;
    client.data['classifyreSchema'] = namespace.schemaName;
    return namespace.schemaName;
  }
}
