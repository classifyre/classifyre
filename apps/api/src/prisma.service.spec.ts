import { PrismaService } from './prisma.service';
import {
  CLS_DATABASE_LANE,
  CLS_SCHEMA,
  type DatabaseLane,
} from './namespace/namespace.constants';

describe('PrismaService workload lane routing', () => {
  it.each<DatabaseLane>(['interactive', 'background'])(
    'resolves the %s namespace client',
    (lane) => {
      const delegate = {};
      const client = { source: delegate };
      const manager = { get: jest.fn(() => client) };
      const cls = {
        get: jest.fn((key: string) => {
          if (key === CLS_SCHEMA) return 'ns_acme';
          if (key === CLS_DATABASE_LANE) return lane;
          return undefined;
        }),
      };
      const prisma = new PrismaService(cls as never, manager as never);

      expect(prisma.source).toBe(delegate);
      expect(manager.get).toHaveBeenCalledWith('ns_acme', lane);
    },
  );

  it('defaults unclassified namespace work to the interactive lane', () => {
    const manager = { get: jest.fn(() => ({ source: {} })) };
    const cls = {
      get: jest.fn((key: string) =>
        key === CLS_SCHEMA ? 'ns_acme' : undefined,
      ),
    };
    const prisma = new PrismaService(cls as never, manager as never);

    void prisma.source;

    expect(manager.get).toHaveBeenCalledWith('ns_acme', 'interactive');
  });
});
