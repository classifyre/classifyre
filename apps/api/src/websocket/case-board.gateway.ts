import {
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ClsService } from 'nestjs-cls';
import { CLS_SCHEMA } from '../namespace/namespace.constants';
import { NamespaceRegistryService } from '../registry/namespace-registry.service';
import { parseActorName } from '../actor-name.decorator';
import type {
  BoardChangedEvent,
  CaseBoardEvents,
} from '../case-board/case-board.events';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Case board change feed (docs/architecture/CASE_BOARD_PRD.md §7.5).
 *
 * One room per case, scoped to the namespace schema like every other gateway
 * (the namespace comes from `handshake.auth.namespaceSlug`). After an ops
 * batch the API emits `changed`; other open boards refetch and merge. The
 * gateway also keeps presence-lite — the display names subscribed to a room.
 *
 * Emits only reach sockets held by *this* process. The worker never writes
 * boards, and a second API replica would need the socket.io Postgres adapter;
 * clients also refetch on focus and every minute, so nothing is lost for long.
 */
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
  namespace: '/case-board',
  transports: ['websocket', 'polling'],
  allowEIO3: true,
})
export class CaseBoardGateway implements OnGatewayDisconnect, CaseBoardEvents {
  @WebSocketServer()
  server: Server;

  /** room → socket id → display name */
  private readonly presence = new Map<string, Map<string, string>>();

  constructor(
    private readonly cls: ClsService,
    private readonly namespaces: NamespaceRegistryService,
  ) {}

  @SubscribeMessage('subscribe')
  async subscribe(
    client: Socket,
    body: { caseId?: unknown; actor?: unknown },
  ): Promise<{ success: boolean; message?: string }> {
    const schema = await this.resolveClientSchema(client);
    if (!schema) return { success: false, message: 'Unknown namespace' };
    const caseId = typeof body?.caseId === 'string' ? body.caseId : '';
    if (!UUID.test(caseId)) return { success: false, message: 'Invalid case' };
    const room = this.room(schema, caseId);
    // One board per socket: leaving the previous room keeps presence honest.
    for (const [other, members] of this.presence) {
      if (other !== room && members.delete(client.id)) {
        await client.leave(other);
        this.broadcastPresence(other);
      }
    }
    await client.join(room);
    const members = this.presence.get(room) ?? new Map<string, string>();
    members.set(client.id, parseActorName(body?.actor) ?? '');
    this.presence.set(room, members);
    this.broadcastPresence(room);
    return { success: true };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(client: Socket): Promise<{ success: boolean }> {
    for (const [room, members] of this.presence) {
      if (members.delete(client.id)) {
        await client.leave(room);
        this.broadcastPresence(room);
      }
    }
    return { success: true };
  }

  handleDisconnect(client: Socket): void {
    for (const [room, members] of this.presence) {
      if (members.delete(client.id)) this.broadcastPresence(room);
    }
  }

  emitChanged(caseId: string, event: BoardChangedEvent): void {
    const schema = this.cls.get<string>(CLS_SCHEMA);
    if (!schema || !this.server) return;
    this.server.to(this.room(schema, caseId)).emit('changed', event);
  }

  private broadcastPresence(room: string): void {
    const members = this.presence.get(room);
    if (!members || members.size === 0) {
      this.presence.delete(room);
      return;
    }
    const people = [...members.entries()].map(([socketId, name]) => ({
      socketId,
      name,
    }));
    this.server?.to(room).emit('presence', people);
  }

  private room(schema: string, caseId: string): string {
    return `${schema}:case-board:${caseId}`;
  }

  private async resolveClientSchema(client: Socket): Promise<string | null> {
    const cached: unknown = client.data['classifyreSchema'];
    if (typeof cached === 'string') return cached;
    const slug: unknown = client.handshake.auth?.['namespaceSlug'];
    if (typeof slug !== 'string') return null;
    const namespace = await this.namespaces.resolve(slug);
    if (!namespace) return null;
    client.data['classifyreSchema'] = namespace.schemaName;
    return namespace.schemaName;
  }
}
