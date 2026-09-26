import { BadRequestException } from '@nestjs/common';
import { prefixTsQuery, QuickSearchService } from './quick-search.service';

type Tx = {
  $executeRaw: jest.Mock;
  $queryRaw: jest.Mock;
  asset: { findMany: jest.Mock };
  finding: { findMany: jest.Mock; groupBy: jest.Mock };
  source: { findMany: jest.Mock };
};

function makeService(tx: Partial<Tx>, transaction?: jest.Mock) {
  const fullTx: Tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    $queryRaw: jest.fn().mockResolvedValue([]),
    asset: { findMany: jest.fn().mockResolvedValue([]) },
    finding: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    source: { findMany: jest.fn().mockResolvedValue([]) },
    ...tx,
  };
  const prisma = {
    $transaction:
      transaction ?? jest.fn((run: (t: Tx) => Promise<unknown>) => run(fullTx)),
  };
  return {
    service: new QuickSearchService(prisma as never),
    tx: fullTx,
    prisma,
  };
}

describe('prefixTsQuery', () => {
  it('turns words into prefix terms joined by AND', () => {
    expect(prefixTsQuery('fn 8q')).toBe('fn:* & 8q:*');
  });

  it('strips everything that could be tsquery syntax', () => {
    expect(prefixTsQuery("a & b | !c <-> d:* 'e'")).toBe(
      'a:* & b:* & c:* & d:* & e:*',
    );
    expect(prefixTsQuery('(( ))')).toBeNull();
  });

  it('splits words where the full-text parser does', () => {
    expect(prefixTsQuery('firmenbuch-test-2')).toBe(
      'firmenbuch:* & test:* & 2:*',
    );
  });

  it('keeps letters beyond ASCII', () => {
    expect(prefixTsQuery('Jahresabschluss Österreich')).toBe(
      'Jahresabschluss:* & Österreich:*',
    );
  });
});

describe('QuickSearchService', () => {
  it('rejects a query that is too short or carries unknown keys', async () => {
    const { service } = makeService({});
    await expect(service.search({ q: 'a' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.search({ q: 'abc', page: 2 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('bounds every query with a statement timeout, and never counts', async () => {
    const { service, tx } = makeService({});
    await service.search({ q: 'jahres' });
    expect(tx.$executeRaw).toHaveBeenCalled();
    const assetQuery = tx.asset.findMany.mock.calls[0]![0];
    expect(assetQuery.take).toBe(8);
    expect(assetQuery.orderBy).toBeUndefined();
    expect(assetQuery.where.name).toEqual({
      contains: 'jahres',
      mode: 'insensitive',
    });
  });

  it('puts names that start with the query first and counts open findings per severity', async () => {
    const { service } = makeService({
      asset: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'a1',
            name: 'Konzern Jahresabschluss',
            externalUrl: '',
            assetType: 'page',
            sourceType: 'WEB',
            sourceId: 's1',
          },
          {
            id: 'a2',
            name: 'Jahresabschluss 2024',
            externalUrl: 'https://x',
            assetType: 'page',
            sourceType: 'WEB',
            sourceId: 's1',
          },
        ]),
      },
      finding: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([
          { assetId: 'a2', severity: 'HIGH', _count: { _all: 2 } },
          { assetId: 'a2', severity: 'INFO', _count: { _all: 1 } },
        ]),
      },
      source: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 's1', name: 'Firmenbuch' }]),
      },
    });
    const res = await service.search({ q: 'Jahres', kinds: ['assets'] });
    expect(res.assets.map((a) => a.id)).toEqual(['a2', 'a1']);
    expect(res.assets[0]).toMatchObject({
      sourceName: 'Firmenbuch',
      openFindings: 3,
      severityCounts: { critical: 0, high: 2, medium: 0, low: 0, info: 1 },
      externalUrl: 'https://x',
    });
    expect(res.assets[1].externalUrl).toBeNull();
    expect(res.findings).toEqual([]);
  });

  it('finds findings through the full-text index, then filters and shapes them', async () => {
    const { service, tx } = makeService({
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'f1' }, { id: 'f2' }]),
      finding: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'f1',
            assetId: 'a1',
            findingType: 'regex:FN',
            matchedContent: 'x'.repeat(500),
            severity: 'MEDIUM',
            detectorType: 'REGEX',
            customDetectorName: null,
            status: 'OPEN',
            asset: { name: 'Doc' },
          },
        ]),
      },
    });
    const res = await service.search({
      q: 'fn8q',
      kinds: ['findings'],
      severity: ['MEDIUM'],
    });
    expect(tx.finding.findMany.mock.calls[0]![0].where).toMatchObject({
      id: { in: ['f1', 'f2'] },
      severity: { in: ['MEDIUM'] },
    });
    expect(res.findings[0]).toMatchObject({ id: 'f1', assetName: 'Doc' });
    expect(res.findings[0].matchedContent).toHaveLength(200);
  });

  it('returns what it has, marked truncated, when a kind runs out of time', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      asset: { findMany: jest.fn().mockResolvedValue([]) },
      finding: { findMany: jest.fn(), groupBy: jest.fn() },
      source: { findMany: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    let call = 0;
    const transaction = jest.fn((run: (t: typeof tx) => Promise<unknown>) => {
      call += 1;
      // The findings transaction hits the statement timeout; assets still answer.
      return call === 2
        ? Promise.reject(
            new Error('canceling statement due to statement timeout (57014)'),
          )
        : run(tx);
    });
    const { service } = makeService({}, transaction);
    const res = await service.search({ q: 'jahres' });
    expect(res.truncated).toBe(true);
    expect(res.assets).toEqual([]);
    expect(res.findings).toEqual([]);
  });

  const assetRow = (id: string, name: string) => ({
    id,
    name,
    externalUrl: '',
    assetType: 'page',
    sourceType: 'WEB',
    sourceId: 's1',
  });
  const sqlText = (sql: { strings?: readonly string[] }) =>
    (sql.strings ?? []).join('?');

  it('finds names by their words through the index, and scans for substrings only when that leaves room', async () => {
    const { service, tx } = makeService({
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'a1' }]),
      asset: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([assetRow('a1', 'Jahres GmbH')])
          .mockResolvedValueOnce([assetRow('a1', 'Jahres GmbH')])
          .mockResolvedValueOnce([assetRow('a2', 'Konzernjahresbericht')]),
      },
    });
    const full = await service.search({
      q: 'jahres',
      kinds: ['assets'],
      limit: 1,
    });
    expect(full.assets.map((a) => a.id)).toEqual(['a1']);
    expect(tx.asset.findMany).toHaveBeenCalledTimes(1);
    // A tagged template: the first argument is the template's strings.
    const words = tx.$queryRaw.mock.calls[0]![0] as readonly string[];
    expect(words.join('?')).toContain("to_tsvector('simple', name)");

    const res = await service.search({
      q: 'jahres',
      kinds: ['assets'],
      limit: 2,
    });
    const scan = tx.asset.findMany.mock.calls[2]![0];
    expect(scan.where.id).toEqual({ notIn: ['a1'] });
    expect(scan.take).toBe(1);
    expect(
      tx.$executeRaw.mock.calls.some((c) =>
        sqlText(c[0] as never).includes('1500ms'),
      ),
    ).toBe(true);
    expect(res.assets.map((a) => a.id).sort()).toEqual(['a1', 'a2']);
  });

  it('keeps the word matches, marked truncated, when the substring scan runs out of time', async () => {
    const { service } = makeService({
      $executeRaw: jest.fn((sql: { strings?: readonly string[] }) =>
        sqlText(sql).includes('1500ms')
          ? Promise.reject(
              new Error('canceling statement due to statement timeout'),
            )
          : Promise.resolve(0),
      ),
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'a1' }]),
      asset: {
        findMany: jest.fn().mockResolvedValue([assetRow('a1', 'Jahres GmbH')]),
      },
    });
    const res = await service.search({ q: 'jahres', kinds: ['assets'] });
    expect(res.assets.map((a) => a.id)).toEqual(['a1']);
    expect(res.truncated).toBe(true);
  });

  it('does not scan for substrings of a two-letter query', async () => {
    const { service, tx } = makeService({});
    await service.search({ q: 'fn', kinds: ['assets'] });
    expect(tx.asset.findMany).not.toHaveBeenCalled();
  });

  it('rethrows anything that is not a timeout', async () => {
    const transaction = jest.fn(() =>
      Promise.reject(new Error('connection refused')),
    );
    const { service } = makeService({}, transaction);
    await expect(service.search({ q: 'jahres' })).rejects.toThrow(
      'connection refused',
    );
  });
});
