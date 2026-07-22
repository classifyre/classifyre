import { RunnerEventsGateway } from './runner-events.gateway';
import { NotificationEventsGateway } from './notification-events.gateway';
import { CLS_SCHEMA } from '../namespace/namespace.constants';

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

  beforeEach(() => jest.clearAllMocks());

  it('joins runner clients only to schema-qualified rooms', async () => {
    const gateway = new RunnerEventsGateway(cls as any, registry as any);
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
    const gateway = new NotificationEventsGateway(cls as any, registry as any);
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
    const gateway = new NotificationEventsGateway(cls as any, registry as any);
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    gateway.server = { to } as any;

    gateway.emitNotificationDeleted('notification-1');

    expect(to).toHaveBeenCalledWith('ns_acme:notifications');
    expect(emit).toHaveBeenCalledWith('notification:deleted', {
      id: 'notification-1',
    });
  });
});
