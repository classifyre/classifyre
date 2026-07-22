import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { RunnerDto, RunnerLogEntryDto } from '../cli-runner/dto';
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

  @SubscribeMessage('subscribe:runners')
  async handleSubscribeRunners(client: Socket) {
    const schema = await this.resolveClientSchema(client);
    if (!schema) return { success: false, message: 'Unknown namespace' };
    this.logger.log(`Client ${client.id} subscribed to all runner updates`);
    await client.join(this.room(schema, 'runners'));
    return { success: true, message: 'Subscribed to runners' };
  }

  @SubscribeMessage('subscribe:runner')
  async handleSubscribeRunner(client: Socket, runnerId: string) {
    const schema = await this.resolveClientSchema(client);
    if (!schema) return { success: false, message: 'Unknown namespace' };
    this.logger.log(`Client ${client.id} subscribed to runner ${runnerId}`);
    await client.join(this.room(schema, `runner:${runnerId}`));
    return { success: true, message: `Subscribed to runner ${runnerId}` };
  }

  @SubscribeMessage('unsubscribe:runner')
  async handleUnsubscribeRunner(client: Socket, runnerId: string) {
    const schema = await this.resolveClientSchema(client);
    if (!schema) return;
    this.logger.log(`Client ${client.id} unsubscribed from runner ${runnerId}`);
    await client.leave(this.room(schema, `runner:${runnerId}`));
  }

  // Emit runner status update to all clients subscribed to runners
  emitRunnerUpdate(runner: RunnerDto) {
    const schema = this.currentSchema();
    this.logger.debug(
      `Emitting runner:update for ${runner.id} to rooms: runners, runner:${runner.id}`,
    );
    this.server.to(this.room(schema, 'runners')).emit('runner:update', runner);
    this.server
      .to(this.room(schema, `runner:${runner.id}`))
      .emit('runner:update', runner);
  }

  // Emit runner status update to clients subscribed to a specific source
  emitSourceRunnerUpdate(sourceId: string, runner: RunnerDto) {
    const schema = this.currentSchema();
    this.server
      .to(this.room(schema, `source:${sourceId}`))
      .emit('runner:update', runner);
    this.emitRunnerUpdate(runner);
  }

  // Emit batched log entries for a specific runner
  emitRunnerLogs(runnerId: string, entries: RunnerLogEntryDto[]) {
    if (!entries.length) return;
    const schema = this.currentSchema();
    this.server
      .to(this.room(schema, `runner:${runnerId}`))
      .emit('runner:log', { runnerId, entries });
  }

  // Emit runner created event
  emitRunnerCreated(runner: RunnerDto) {
    const schema = this.currentSchema();
    this.server.to(this.room(schema, 'runners')).emit('runner:created', runner);
    if (runner.sourceId) {
      this.server
        .to(this.room(schema, `source:${runner.sourceId}`))
        .emit('runner:created', runner);
    }
  }

  stopForSchema(schema: string): void {
    this.server?.in(this.room(schema, 'runners')).disconnectSockets(true);
  }

  private currentSchema(): string {
    const schema = this.cls.get<string>(CLS_SCHEMA);
    if (!schema) {
      throw new Error('Cannot emit runner events outside a namespace context');
    }
    return schema;
  }

  private room(schema: string, suffix: string): string {
    return `${schema}:${suffix}`;
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
