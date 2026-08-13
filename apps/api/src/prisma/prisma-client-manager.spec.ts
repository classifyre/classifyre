const mockAdapterConfigs: Array<Record<string, unknown>> = [];
const mockDisconnects: jest.Mock[] = [];

jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation((config: Record<string, unknown>) => {
    mockAdapterConfigs.push(config);
    return { config };
  }),
}));

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => {
    const disconnect = jest.fn().mockResolvedValue(undefined);
    mockDisconnects.push(disconnect);
    return { $disconnect: disconnect };
  }),
}));

import { PrismaClientManager } from './prisma-client-manager';

describe('PrismaClientManager workload lanes', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.DATABASE_URL =
      'postgresql://test:test@localhost:5432/classifyre?schema=public';
    process.env.SERVICE_ROLE = 'all';
    process.env.PRISMA_POOL_MAX = '10';
    process.env.PRISMA_INTERACTIVE_POOL_MAX = '4';
    mockAdapterConfigs.length = 0;
    mockDisconnects.length = 0;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('splits one namespace connection budget between distinct pools', async () => {
    const manager = new PrismaClientManager();

    const interactive = manager.get('ns_acme', 'interactive');
    const background = manager.get('ns_acme', 'background');

    expect(interactive).not.toBe(background);
    expect(mockAdapterConfigs.map((config) => config.max)).toEqual([4, 6]);
    expect(manager.residentSchemas()).toEqual(['ns_acme']);

    await manager.drop('ns_acme');
    expect(mockDisconnects).toHaveLength(2);
    expect(
      mockDisconnects.every((disconnect) => disconnect.mock.calls.length === 1),
    ).toBe(true);
  });

  it('leaves the interactive lane the whole pre-split budget by default', () => {
    // The desktop app sets neither variable, so these defaults are what it
    // runs. The background lane must be funded on top of the interactive
    // budget: carving it out would leave the UI near the 3 connections that
    // made overview pages fail with P2028.
    delete process.env.PRISMA_POOL_MAX;
    delete process.env.PRISMA_INTERACTIVE_POOL_MAX;
    const manager = new PrismaClientManager();

    manager.get('ns_acme', 'interactive');
    manager.get('ns_acme', 'background');

    expect(mockAdapterConfigs.map((config) => config.max)).toEqual([10, 6]);
  });

  it('keeps the full pool budget for a background-only worker process', () => {
    process.env.SERVICE_ROLE = 'worker';
    const manager = new PrismaClientManager();

    manager.get('ns_acme', 'background');

    expect(mockAdapterConfigs[0]?.max).toBe(10);
  });
});
