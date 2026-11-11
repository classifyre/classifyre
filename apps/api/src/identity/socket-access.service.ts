import { Inject, Injectable } from '@nestjs/common';
import type { Socket } from 'socket.io';
import type { Capability } from './capabilities';
import type { ClsPerson } from './iam-access-policy';
import type { IdentityService, Principal } from './identity.service';
import { IDENTITY } from './identity.tokens';

/**
 * Sign-in for WebSocket connections (docs/prd §10 item 8): the same session
 * cookie or token as HTTP, sent with the handshake (`auth.token` for clients
 * that cannot send cookies), and the same capability check for the workspace
 * the socket joins.
 */
@Injectable()
export class SocketAccessService {
  constructor(@Inject(IDENTITY) private readonly identity: IdentityService) {}

  async canJoin(
    client: Socket,
    namespaceId: string,
    capability: Capability,
  ): Promise<boolean> {
    const token: unknown = client.handshake.auth?.['token'];
    const request = {
      headers: {
        ...(client.handshake.headers as Record<string, unknown>),
        ...(typeof token === 'string' && token
          ? { authorization: `Bearer ${token}` }
          : {}),
      },
      classifyrePrincipal: client.data['classifyrePrincipal'] as
        | Principal
        | undefined,
    };
    try {
      const principal = await this.identity.authenticate(request);
      client.data['classifyrePrincipal'] = principal;
      const capabilities = await this.identity.capabilitiesIn(
        principal,
        namespaceId,
      );
      return Boolean(
        capabilities?.has('workspace.view') && capabilities.has(capability),
      );
    } catch {
      return false;
    }
  }

  /**
   * The signed-in person behind a socket that {@link canJoin} let in, with
   * their groups and the groups above them; null for visitors.
   */
  async person(client: Socket): Promise<ClsPerson | null> {
    const principal = client.data['classifyrePrincipal'] as
      | Principal
      | undefined;
    if (!principal || principal.visitor) return null;
    if (!principal.actor.id?.startsWith('user:')) return null;
    return {
      actorRef: principal.actor.id,
      groupIds: await this.identity.groupLineage(principal),
    };
  }
}
