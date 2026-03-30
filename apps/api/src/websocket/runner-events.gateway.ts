import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { RunnerDto } from '../cli-runner/dto';

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
  namespace: '/runners',
  transports: ['websocket', 'polling'],
  allowEIO3: true, // Allow Engine.IO v3 clients
})
export class RunnerEventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RunnerEventsGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(
      `WebSocket client connected: ${client.id} from ${client.handshake.address}`,
    );
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`WebSocket client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe:runners')
  handleSubscribeRunners(client: Socket) {
    this.logger.log(`Client ${client.id} subscribed to all runner updates`);
    void client.join('runners');
    return { success: true, message: 'Subscribed to runners' };
  }

  @SubscribeMessage('subscribe:runner')
  handleSubscribeRunner(client: Socket, runnerId: string) {
    this.logger.log(`Client ${client.id} subscribed to runner ${runnerId}`);
    void client.join(`runner:${runnerId}`);
    return { success: true, message: `Subscribed to runner ${runnerId}` };
  }

  @SubscribeMessage('unsubscribe:runner')
  handleUnsubscribeRunner(client: Socket, runnerId: string) {
    this.logger.log(`Client ${client.id} unsubscribed from runner ${runnerId}`);
    void client.leave(`runner:${runnerId}`);
  }

  // Emit runner status update to all clients subscribed to runners
  emitRunnerUpdate(runner: RunnerDto) {
    this.logger.debug(
      `Emitting runner:update for ${runner.id} to rooms: runners, runner:${runner.id}`,
    );
    this.server.to('runners').emit('runner:update', runner);
    this.server.to(`runner:${runner.id}`).emit('runner:update', runner);
  }

  // Emit runner status update to clients subscribed to a specific source
  emitSourceRunnerUpdate(sourceId: string, runner: RunnerDto) {
    this.server.to(`source:${sourceId}`).emit('runner:update', runner);
    this.emitRunnerUpdate(runner);
  }

  // Emit runner created event
  emitRunnerCreated(runner: RunnerDto) {
    this.server.to('runners').emit('runner:created', runner);
    if (runner.sourceId) {
      this.server
        .to(`source:${runner.sourceId}`)
        .emit('runner:created', runner);
    }
  }
}
