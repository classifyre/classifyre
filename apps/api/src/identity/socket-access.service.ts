import { Inject, Injectable } from '@nestjs/common';
import type { Socket } from 'socket.io';
import type { Capability } from './capabilities';
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
}
