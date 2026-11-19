/**
 * `deployForSchema` used to spawn `prisma migrate deploy` for every workspace
 * schema on every boot, ~5-10s each even when nothing was pending. With dozens
 * of workspaces and three processes taking the migration lock in turn, a dev
 * cluster needed more than the 10 minute startup budget. A schema whose
 * `_prisma_migrations` already lists every migration is skipped now.
 */
import fs from 'node:fs';
import path from 'node:path';

const clientQuery = jest.fn();
const clientConnect = jest.fn();
const clientEnd = jest.fn();
const spawnMock = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn(),
  Client: jest.fn().mockImplementation(() => ({
    connect: clientConnect,
    query: clientQuery,
    end: clientEnd,
  })),
}));

jest.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { deployForSchema } from './database-migrations';

const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');
const localMigrations = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

interface AppliedRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

const applied = (name: string): AppliedRow => ({
  migration_name: name,
  finished_at: new Date('2026-11-01T00:00:00Z'),
  rolled_back_at: null,
});

function prismaExitsWith(code: number) {
  spawnMock.mockImplementation(() => {
    const handlers: Record<string, (value?: unknown) => void> = {};
    const stream = { on: jest.fn() };
    queueMicrotask(() => handlers.exit?.(code));
    return {
      stdout: stream,
      stderr: stream,
      on: (event: string, handler: (value?: unknown) => void) => {
        handlers[event] = handler;
      },
    };
  });
}

describe('deployForSchema skips schemas that are already current', () => {
  const url = 'postgresql://tenant:secret@localhost:5432/classifyre_t_abc';

  beforeEach(() => {
    jest.clearAllMocks();
    clientConnect.mockResolvedValue(undefined);
    clientEnd.mockResolvedValue(undefined);
    prismaExitsWith(0);
  });

  it('does not spawn prisma when every local migration is already applied', async () => {
    clientQuery.mockResolvedValue({ rows: localMigrations.map(applied) });

    await deployForSchema('ns_current', url);

    expect(spawnMock).not.toHaveBeenCalled();
    expect(clientQuery).toHaveBeenCalledTimes(1);
    expect(String(clientQuery.mock.calls[0][0])).toContain(
      '"ns_current"._prisma_migrations',
    );
  });

  it('spawns prisma when the newest local migration is not applied yet', async () => {
    clientQuery.mockResolvedValue({
      rows: localMigrations.slice(0, -1).map(applied),
    });

    await deployForSchema('ns_behind', url);

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('spawns prisma when an applied migration is unfinished, so a failed one still surfaces', async () => {
    const rows = localMigrations.map(applied);
    rows[3] = { ...rows[3], finished_at: null };
    clientQuery.mockResolvedValue({ rows });

    await deployForSchema('ns_failed', url);

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('spawns prisma when an applied migration was rolled back', async () => {
    const rows = localMigrations.map(applied);
    rows[3] = { ...rows[3], rolled_back_at: new Date('2026-11-02T00:00:00Z') };
    clientQuery.mockResolvedValue({ rows });

    await deployForSchema('ns_rolled_back', url);

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('spawns prisma when the schema has no _prisma_migrations table yet', async () => {
    clientQuery.mockRejectedValue(
      Object.assign(new Error('relation does not exist'), { code: '42P01' }),
    );

    await deployForSchema('ns_new', url);

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('spawns prisma when the check cannot connect, rather than failing the boot', async () => {
    clientConnect.mockRejectedValue(new Error('connection refused'));

    await deployForSchema('ns_unreachable', url);

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('closes the connection it opened for the check', async () => {
    clientQuery.mockResolvedValue({ rows: localMigrations.map(applied) });

    await deployForSchema('ns_current', url);

    expect(clientEnd).toHaveBeenCalledTimes(1);
  });

  it('escapes the schema name it quotes into the check query', async () => {
    clientQuery.mockResolvedValue({ rows: localMigrations.map(applied) });

    await deployForSchema('ns_"; drop table x; --', url);

    expect(String(clientQuery.mock.calls[0][0])).toContain(
      '"ns_""; drop table x; --"._prisma_migrations',
    );
  });
});
