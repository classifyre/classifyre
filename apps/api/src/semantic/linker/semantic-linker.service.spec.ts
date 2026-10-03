import { SemanticLinkerService } from './semantic-linker.service';

/**
 * The drain's bookkeeping. The linking itself is covered against Postgres by
 * semantic.integration.spec.ts; what is pinned here needs no database.
 */
describe('SemanticLinkerService.drain', () => {
  const prisma = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    semanticLinkJob: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    glossaryTerm: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const bindings = { invalidate: jest.fn(), active: jest.fn() };
  let linker: SemanticLinkerService;
  let coverage: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    linker = new SemanticLinkerService(prisma as never, bindings as never);
    coverage = jest.spyOn(linker, 'recordCoverage').mockResolvedValue();
    prisma.semanticLinkJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.semanticLinkJob.update.mockResolvedValue({});
  });

  const claim = (jobs: Array<{ id: string; kind: string }>) =>
    prisma.$queryRaw.mockResolvedValueOnce(jobs);
  const incremental = (id: string) => ({
    id,
    kind: 'INCREMENTAL',
    trigger: { assetIds: [`asset-${id}`] },
    cursor: null,
  });

  // The API approves a binding; the worker links. The worker's cache never
  // hears that event, so a job must not link with what it loaded a minute ago.
  it('reads bindings afresh for the jobs it claims', async () => {
    claim([{ id: 'a', kind: 'INCREMENTAL' }]);
    prisma.semanticLinkJob.findUnique.mockResolvedValue(incremental('a'));
    const relink = jest.spyOn(linker, 'relinkAssets').mockResolvedValue({
      assets: 1,
      added: 0,
      gone: 0,
      perTerm: new Map(),
    });

    await linker.drain();

    expect(bindings.invalidate).toHaveBeenCalled();
    expect(bindings.invalidate.mock.invocationCallOrder[0]).toBeLessThan(
      relink.mock.invocationCallOrder[0],
    );
  });

  it('records coverage once for a drain of several jobs', async () => {
    claim([
      { id: 'a', kind: 'INCREMENTAL' },
      { id: 'b', kind: 'INCREMENTAL' },
    ]);
    prisma.semanticLinkJob.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(incremental(where.id)),
    );
    const relink = jest.spyOn(linker, 'relinkAssets').mockResolvedValue({
      assets: 1,
      added: 0,
      gone: 0,
      perTerm: new Map(),
    });

    await linker.drain();

    expect(relink).toHaveBeenCalledTimes(2);
    expect(coverage).toHaveBeenCalledTimes(1);
  });

  // Every claimed job is RUNNING. One that throws must not strand the rest
  // there until the stale-claim timeout.
  it('runs the remaining jobs after one fails', async () => {
    claim([
      { id: 'a', kind: 'INCREMENTAL' },
      { id: 'b', kind: 'INCREMENTAL' },
    ]);
    prisma.semanticLinkJob.findUnique
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce(incremental('b'));
    const relink = jest.spyOn(linker, 'relinkAssets').mockResolvedValue({
      assets: 1,
      added: 0,
      gone: 0,
      perTerm: new Map(),
    });

    await expect(linker.drain()).resolves.toBeUndefined();

    expect(relink).toHaveBeenCalledTimes(1);
    expect(relink).toHaveBeenCalledWith(['asset-b']);
  });

  it('does nothing when no job is queued', async () => {
    claim([]);
    await linker.drain();
    expect(bindings.invalidate).not.toHaveBeenCalled();
    expect(coverage).not.toHaveBeenCalled();
  });
});
