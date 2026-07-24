const waiters: Array<() => void> = [];
let held = false;

const fakeClient = () => ({
  query: jest.fn(async (sql: string) => {
    if (sql.includes('pg_advisory_lock(')) {
      if (held) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      held = true;
    } else if (sql.includes('pg_advisory_unlock(')) {
      held = false;
      waiters.shift()?.();
    }
    return { rows: [] };
  }),
  release: jest.fn(),
});

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    connect: jest.fn(() => fakeClient()),
    end: jest.fn(() => undefined),
  })),
}));

import { withDatabaseMigrationLock } from './database-migrations';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('database migration lock', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.DATABASE_URL =
      'postgresql://test:test@localhost:5432/classifyre';
    held = false;
    waiters.length = 0;
  });

  afterAll(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('serializes migration owners from concurrent replicas', async () => {
    const firstMayFinish = deferred();
    const firstStarted = deferred();
    const order: string[] = [];

    const first = withDatabaseMigrationLock(async () => {
      order.push('first:start');
      firstStarted.resolve();
      await firstMayFinish.promise;
      order.push('first:end');
    });
    await firstStarted.promise;

    const second = withDatabaseMigrationLock(() => {
      order.push('second:start');
      order.push('second:end');
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(['first:start']);
    firstMayFinish.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ]);
  });
});
