import { BadRequestException, NotFoundException } from '@nestjs/common';
import { cleanPositions, ExploreViewsService } from './explore-views.service';

function harness() {
  const row = {
    id: 'v1',
    name: 'Kitchen leak',
    description: null,
    seedIds: ['a', 'gone'],
    view: 'lineage',
    kinds: [],
    depth: 2,
    direction: 'both',
    positions: { a: { x: 10, y: 20 } },
    createdBy: null,
    createdAt: new Date('2026-10-25T08:00:00Z'),
    updatedAt: new Date('2026-10-25T08:00:00Z'),
  };
  const prisma = {
    exploreView: {
      create: jest.fn(({ data }: { data: object }) =>
        Promise.resolve({ ...row, ...data }),
      ),
      update: jest.fn(({ data }: { data: object }) =>
        Promise.resolve({ ...row, ...data }),
      ),
      findUnique: jest.fn(() => Promise.resolve(row)),
      findMany: jest.fn(() => Promise.resolve([row])),
      deleteMany: jest.fn(() => Promise.resolve({ count: 1 })),
    },
    asset: {
      // `gone` was deleted at its source.
      findMany: jest.fn(() =>
        Promise.resolve([
          { id: 'a', name: 'a.txt', source: { name: 'Shared drive' } },
        ]),
      ),
    },
  };
  return {
    service: new ExploreViewsService(prisma as never),
    prisma,
  };
}

describe('ExploreViewsService', () => {
  it('names the starting points that still exist and keeps the rest', async () => {
    const h = harness();

    const [view] = await h.service.list();

    expect(view.seedIds).toEqual(['a', 'gone']);
    expect(view.seeds).toEqual([
      { id: 'a', name: 'a.txt', sourceName: 'Shared drive' },
    ]);
    expect(view.positions).toEqual({ a: { x: 10, y: 20 } });
  });

  it('needs a name and at least one asset', async () => {
    const h = harness();

    await expect(
      h.service.create({ name: '  ', seedIds: ['a'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      h.service.create({ name: 'View', seedIds: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('changes only what it is given', async () => {
    const h = harness();

    await h.service.update('v1', { positions: { a: { x: 1.4, y: 2.6 } } });

    expect(h.prisma.exploreView.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { positions: { a: { x: 1, y: 3 } } },
    });
  });

  it('says so when a view does not exist', async () => {
    const h = harness();
    h.prisma.exploreView.deleteMany.mockResolvedValueOnce({ count: 0 });

    await expect(h.service.remove('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('cleanPositions', () => {
  it('keeps finite coordinates only, rounded', () => {
    expect(
      cleanPositions({
        a: { x: 1.2, y: 3.7 },
        b: { x: 'x', y: 1 },
        c: null,
        d: { x: Infinity, y: 0 },
      }),
    ).toEqual({ a: { x: 1, y: 4 } });
  });
});
