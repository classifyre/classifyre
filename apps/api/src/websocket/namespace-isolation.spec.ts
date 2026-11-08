import { RunnerEventsGateway } from './runner-events.gateway';
import { NotificationEventsGateway } from './notification-events.gateway';
import { CaseBoardGateway } from './case-board.gateway';
import { CLS_SCHEMA } from '../namespace/namespace.constants';
import { SocketAccessService } from '../identity/socket-access.service';

describe('WebSocket namespace isolation', () => {
  const registry = {
    resolve: jest.fn((slug: string) =>
      Promise.resolve(
        slug === 'acme'
          ? { namespaceId: 'id-acme', slug, schemaName: 'ns_acme' }
          : null,
      ),
    ),
  };
  const cls = {
    get: jest.fn((key: string) => (key === CLS_SCHEMA ? 'ns_acme' : undefined)),
  };

  // Sign-in off: every socket may join.
  const open = new SocketAccessService(null);

  beforeEach(() => jest.clearAllMocks());

  it('refuses a socket that sign-in does not let into the workspace', async () => {
    const refusing = {
      canJoin: jest.fn(() => Promise.resolve(false)),
    } as unknown as SocketAccessService;
    const gateway = new NotificationEventsGateway(
      cls as any,
      registry as any,
      refusing,
    );
    const client = {
      id: 'socket-0',
      data: {},
      handshake: { auth: { namespaceSlug: 'acme' } },
      join: jest.fn(),
    };

    await expect(
      gateway.handleSubscribeNotifications(client as any),
    ).resolves.toEqual({ success: false, message: 'Unknown namespace' });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- a jest.fn
    expect(refusing.canJoin).toHaveBeenCalledWith(
      client,
      'id-acme',
      'workspace.view',
    );
    expect(client.join).not.toHaveBeenCalled();
  });

  it('joins runner clients only to schema-qualified rooms', async () => {
    const gateway = new RunnerEventsGateway(cls as any, registry as any, open);
    const client = {
      id: 'socket-1',
      data: {},
      handshake: { auth: { namespaceSlug: 'acme' } },
      join: jest.fn(),
    };

    await gateway.handleSubscribeRunners(client as any);
    await gateway.handleSubscribeRunner(client as any, 'runner-1');

    expect(client.join).toHaveBeenNthCalledWith(1, 'ns_acme:runners');
    expect(client.join).toHaveBeenNthCalledWith(2, 'ns_acme:runner:runner-1');
  });

  it('rejects notification subscriptions for unknown namespaces', async () => {
    const gateway = new NotificationEventsGateway(
      cls as any,
      registry as any,
      open,
    );
    const client = {
      id: 'socket-2',
      data: {},
      handshake: { auth: { namespaceSlug: 'unknown' } },
      join: jest.fn(),
    };

    await expect(
      gateway.handleSubscribeNotifications(client as any),
    ).resolves.toEqual({ success: false, message: 'Unknown namespace' });
    expect(client.join).not.toHaveBeenCalled();
  });

  it('emits notifications only to the current schema room', () => {
    const gateway = new NotificationEventsGateway(
      cls as any,
      registry as any,
      open,
    );
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    gateway.server = { to } as any;

    gateway.emitNotificationDeleted('notification-1');

    expect(to).toHaveBeenCalledWith('ns_acme:notifications');
    expect(emit).toHaveBeenCalledWith('notification:deleted', {
      id: 'notification-1',
    });
  });

  describe('case board', () => {
    const caseId = '2b0ef7b6-6c4f-4a53-9d0e-4f0c9a1e2d3c';
    const client = (id: string, slug = 'acme') => ({
      id,
      data: {},
      handshake: { auth: { namespaceSlug: slug } },
      join: jest.fn(),
      leave: jest.fn(),
    });

    it('joins schema-qualified case rooms and broadcasts presence there', async () => {
      const gateway = new CaseBoardGateway(cls as any, registry as any, open);
      const emit = jest.fn();
      const to = jest.fn(() => ({ emit }));
      gateway.server = { to } as any;
      const socket = client('socket-3');

      await expect(
        gateway.subscribe(socket as any, { caseId, actor: 'Maria%20K.' }),
      ).resolves.toEqual({ success: true });

      expect(socket.join).toHaveBeenCalledWith(`ns_acme:case-board:${caseId}`);
      expect(to).toHaveBeenCalledWith(`ns_acme:case-board:${caseId}`);
      expect(emit).toHaveBeenCalledWith('presence', [
        { socketId: 'socket-3', name: 'Maria K.' },
      ]);
    });

    it('refuses unknown namespaces and malformed case ids', async () => {
      const gateway = new CaseBoardGateway(cls as any, registry as any, open);
      gateway.server = { to: jest.fn(() => ({ emit: jest.fn() })) } as any;
      const stranger = client('socket-4', 'unknown');
      await expect(
        gateway.subscribe(stranger as any, { caseId }),
      ).resolves.toEqual({ success: false, message: 'Unknown namespace' });
      const sloppy = client('socket-5');
      await expect(
        gateway.subscribe(sloppy as any, { caseId: '../../etc' }),
      ).resolves.toEqual({ success: false, message: 'Invalid case' });
      expect(stranger.join).not.toHaveBeenCalled();
      expect(sloppy.join).not.toHaveBeenCalled();
    });

    it('emits board changes only to the current schema room', () => {
      const gateway = new CaseBoardGateway(cls as any, registry as any, open);
      const emit = jest.fn();
      const to = jest.fn(() => ({ emit }));
      gateway.server = { to } as any;
      const event = {
        caseId,
        version: 3,
        actor: 'MK',
        clientId: 'tab-1',
        summary: 'moved an item',
      };

      gateway.emitChanged(caseId, event);

      expect(to).toHaveBeenCalledWith(`ns_acme:case-board:${caseId}`);
      expect(emit).toHaveBeenCalledWith('changed', event);
    });
  });
});
