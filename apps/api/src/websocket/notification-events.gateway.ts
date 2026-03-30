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

  handleConnection(client: Socket) {
    this.logger.log(
      `WebSocket client connected: ${client.id} from ${client.handshake.address}`,
    );
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`WebSocket client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe:notifications')
  handleSubscribeNotifications(client: Socket) {
    void client.join('notifications');
    this.logger.log(`Client ${client.id} subscribed to notifications`);
    return { success: true, message: 'Subscribed to notifications' };
  }

  @SubscribeMessage('unsubscribe:notifications')
  handleUnsubscribeNotifications(client: Socket) {
    void client.leave('notifications');
    this.logger.log(`Client ${client.id} unsubscribed from notifications`);
    return { success: true, message: 'Unsubscribed from notifications' };
  }

  emitNotificationCreated(notification: NotificationResponseDto) {
    this.server.to('notifications').emit('notification:created', notification);
  }

  emitNotificationUpdated(notification: NotificationResponseDto) {
    this.server.to('notifications').emit('notification:updated', notification);
  }

  emitNotificationDeleted(notificationId: string) {
    this.server.to('notifications').emit('notification:deleted', {
      id: notificationId,
    });
  }

  emitNotificationsChanged(payload?: { updated?: number }) {
    this.server
      .to('notifications')
      .emit('notifications:changed', payload ?? {});
  }
}
