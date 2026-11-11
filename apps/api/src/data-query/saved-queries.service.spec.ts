import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SavedQueriesService } from './saved-queries.service';

function harness(actorRef: string | undefined = 'user:anna') {
  const rows = new Map<string, TestRow>();
  let seq = 0;
  const prisma = {
    savedQuery: {
      findMany: jest.fn(() =>
        Promise.resolve(
          [...rows.values()]
            .filter((r) => r.actorRef === (actorRef ?? null))
            .sort((a, b) => +b.updatedAt - +a.updatedAt),
        ),
      ),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.get(where.id) ?? null),
      ),
      create: jest.fn(({ data }: { data: TestInput }) => {
        seq += 1;
        const row: TestRow = {
          id: `q${seq}`,
          ...data,
          createdAt: new Date('2026-11-10T10:00:00Z'),
          updatedAt: new Date('2026-11-10T10:00:00Z'),
        };
        rows.set(row.id, row);
        return Promise.resolve(row);
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Partial<TestInput> }) => {
          const row = rows.get(where.id)!;
          const next = { ...row, ...data, updatedAt: new Date() };
          rows.set(where.id, next);
          return Promise.resolve(next);
        },
      ),
      delete: jest.fn(({ where }: { where: { id: string } }) => {
        rows.delete(where.id);
        return Promise.resolve({ id: where.id });
      }),
    },
  };
  const actors = { current: () => ({ ref: actorRef }) };
  return {
    rows,
    prisma,
    service: new SavedQueriesService(
      prisma as never,
      actors as never,
    ),
  };
}

interface TestInput {
  name: string;
  sql: string;
  actorRef: string | null;
}

interface TestRow extends TestInput {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

describe('SavedQueriesService', () => {
  it('creates, lists, renames and deletes its own queries', async () => {
    const h = harness();
    const created = await h.service.create('Orders', 'SELECT 1');
    expect(created.name).toBe('Orders');

    expect((await h.service.list()).map((q) => q.id)).toEqual([created.id]);
    expect((await h.service.get(created.id)).sql).toBe('SELECT 1');

    const renamed = await h.service.update(created.id, 'Orders v2', undefined);
    expect(renamed.name).toBe('Orders v2');

    await h.service.remove(created.id);
    await expect(h.service.get(created.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('needs a name and SQL', async () => {
    const h = harness();
    await expect(h.service.create('  ', 'SELECT 1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(h.service.create('Q', '  ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('never shows another actor’s queries', async () => {
    const anna = harness('user:anna');
    const created = await anna.service.create('Private', 'SELECT 1');
    const bob = harness('user:bob');
    // Bob's store is empty: a foreign id answers 404, whatever he tries.
    await expect(bob.service.get(created.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      bob.service.update(created.id, 'Stolen', undefined),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(bob.service.remove(created.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
