import type { FastifyRequest } from 'fastify';
import type { Capability } from '../identity/capabilities';
import type { IdentityService, Principal } from '../identity/identity.service';
import type { TenancyService } from '../identity/tenancy.service';
import type { NamespaceRegistryService } from './namespace-registry.service';
import type { Namespace } from './namespace.types';
import { NamespacesController } from './namespaces.controller';

const ws = (id: string) => ({ id, slug: id, name: id }) as unknown as Namespace;
const request = { raw: {} } as unknown as FastifyRequest;

describe('NamespacesController.list', () => {
  const registry = {
    list: jest.fn(() =>
      Promise.resolve([ws('ledger'), ws('payments'), ws('hidden')]),
    ),
  } as unknown as NamespaceRegistryService;

  it('lists only visible workspaces, each with what the caller may do there', async () => {
    const identity = {
      authenticate: jest.fn(() => Promise.resolve({} as Principal)),
      visibleWorkspaces: jest.fn(() =>
        Promise.resolve(
          new Map<string, Set<Capability>>([
            [
              'ledger',
              new Set<Capability>(['workspace.view', 'workspace.delete']),
            ],
            ['payments', new Set<Capability>(['workspace.view'])],
          ]),
        ),
      ),
    } as unknown as IdentityService;
    const controller = new NamespacesController(
      registry,
      {} as TenancyService,
      identity,
    );

    const listed = await controller.list(request);

    expect(listed.map((ns) => ns.id)).toEqual(['ledger', 'payments']);
    expect(listed[0].capabilities).toEqual([
      'workspace.delete',
      'workspace.view',
    ]);
    expect(listed[1].capabilities).toEqual(['workspace.view']);
  });
});
