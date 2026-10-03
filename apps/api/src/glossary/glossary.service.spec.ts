import { glossaryEvents } from './glossary-events';
import { GlossaryService, lexicalRank } from './glossary.service';
import {
  generateKey,
  glossaryNorm,
  keyBase,
  keyFromTermUrn,
  matchKeysFor,
  suggestLabelKind,
} from './glossary-norm';

describe('GlossaryService', () => {
  const prisma = {
    glossaryTerm: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    glossaryScheme: { findUnique: jest.fn() },
    glossaryRelation: { findMany: jest.fn() },
    glossaryReference: { createMany: jest.fn() },
    glossaryActivity: { create: jest.fn() },
    customDetector: { findMany: jest.fn() },
    case: { findUnique: jest.fn() },
    inquiry: { findUnique: jest.fn() },
    source: { findUnique: jest.fn() },
    finding: { findUnique: jest.fn() },
    agentMemory: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };
  const queue = { enqueue: jest.fn() };
  const embeddings = { configuredSpace: jest.fn() };
  const queryEmbedding = { embed: jest.fn() };

  const service = new GlossaryService(
    prisma as never,
    queue as never,
    embeddings as never,
    queryEmbedding as never,
  );

  const baseTerm = {
    id: 'term-1',
    key: 'little-st-james',
    previousKeys: [] as string[],
    term: 'Little St. James',
    kind: 'ENTITY',
    status: 'APPROVED',
    aliases: ['LSJ'],
    codes: [] as string[],
    hiddenAliases: [] as string[],
    matchKeys: ['little st. james', 'lsj'],
    proposedAliases: [] as string[],
    entityType: 'LOCATION',
    definition: null,
    notes: null,
    steward: null,
    schemeId: null,
    scheme: null,
    replacedById: null,
    replacedBy: null,
    deprecatedAt: null,
    sourceIri: null,
    packKey: null,
    origin: 'OPERATOR',
    approvedAt: new Date(),
    approvedBy: 'operator',
    embedContentHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const term = (
    id: string,
    name: string,
    extra: Record<string, unknown> = {},
  ) => ({
    ...baseTerm,
    id,
    key: keyBase(name),
    term: name,
    kind: 'CONCEPT',
    aliases: [] as string[],
    entityType: 'TERM',
    ...extra,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.agentMemory.findUnique.mockResolvedValue(null);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.glossaryTerm.findFirst.mockResolvedValue(null);
    prisma.glossaryTerm.findUnique.mockResolvedValue(null);
    prisma.glossaryRelation.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    prisma.glossaryTerm.create.mockImplementation(({ data }) =>
      Promise.resolve({ ...baseTerm, ...data, id: 'new-id' }),
    );
    prisma.glossaryTerm.update.mockImplementation(({ data }) =>
      Promise.resolve({ ...baseTerm, ...data }),
    );
    queryEmbedding.embed.mockRejectedValue(new Error('disabled'));
  });

  describe('upsert', () => {
    it('operator upsert creates an APPROVED term with a generated key and enqueues its embedding', async () => {
      const result = await service.upsert({
        term: 'Little St. James',
        aliases: ['LSJ'],
        kind: 'ENTITY',
        origin: 'OPERATOR',
        author: 'analyst-1',
      });

      expect(result.status).toBe('APPROVED');
      expect(result.merged).toBe(false);
      expect(prisma.glossaryTerm.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            key: 'little-st-james',
            kind: 'ENTITY',
            status: 'APPROVED',
            origin: 'OPERATOR',
            approvedBy: 'analyst-1',
            matchKeys: ['little st. james', 'lsj'],
          }),
        }),
      );
      expect(queue.enqueue).toHaveBeenCalledWith([
        expect.objectContaining({ text: expect.stringContaining('LSJ') }),
      ]);
    });

    it('agent upsert of a new term stays DRAFT', async () => {
      const result = await service.upsert({
        term: 'Shell company X',
        kind: 'CONCEPT',
        origin: 'AGENT',
        author: 'CASE',
      });

      expect(result.status).toBe('DRAFT');
      expect(prisma.glossaryTerm.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            origin: 'AGENT',
            status: 'DRAFT',
            approvedAt: null,
          }),
        }),
      );
    });

    // Rule SL-8: an APPROVED term's labels drive lookup bindings, so an agent
    // alias must wait for an operator even on a term the agent proposed itself.
    it('keeps an agent alias pending on its own term once that term is APPROVED', async () => {
      prisma.glossaryTerm.findFirst.mockResolvedValue(
        term('t-1', 'Force majeure', { origin: 'AGENT', status: 'APPROVED' }),
      );

      const result = await service.upsert({
        term: 'Force majeure',
        kind: 'CONCEPT',
        aliases: ['höhere Gewalt'],
        origin: 'AGENT',
        author: 'CASE',
      });

      expect(result.merged).toBe(true);
      expect(prisma.glossaryTerm.update).toHaveBeenCalledWith({
        where: { id: 't-1' },
        data: { proposedAliases: ['höhere Gewalt'] },
      });
    });

    it('lets an agent refine its own term while it is still a DRAFT', async () => {
      prisma.glossaryTerm.findFirst.mockResolvedValue(
        term('t-1', 'Force majeure', {
          origin: 'AGENT',
          status: 'DRAFT',
          approvedAt: null,
          approvedBy: null,
        }),
      );

      const result = await service.upsert({
        term: 'Force majeure',
        kind: 'CONCEPT',
        aliases: ['höhere Gewalt'],
        origin: 'AGENT',
        author: 'CASE',
      });

      expect(result.merged).toBe(false);
      expect(result.aliases).toEqual(['höhere Gewalt']);
      expect(result.status).toBe('DRAFT');
    });

    // An edit that takes a term out of APPROVED must unlink it exactly as the
    // lifecycle endpoint does (rule SL-5), so it has to say so.
    it('reports a status change made through an edit as that change', async () => {
      const events: Array<{ change: string; linkingChanged?: boolean }> = [];
      const off = glossaryEvents.on('glossary.term_changed', (event) => {
        events.push(event);
      });
      prisma.glossaryTerm.findUnique.mockResolvedValue(
        term('t-1', 'Bank account', { status: 'APPROVED' }),
      );

      await service.upsert({
        id: 't-1',
        term: 'Bank account',
        kind: 'CONCEPT',
        status: 'DRAFT',
        origin: 'OPERATOR',
      });
      off();

      expect(events).toEqual([
        expect.objectContaining({ change: 'unapproved', linkingChanged: true }),
      ]);
    });

    it('agents never set keys', async () => {
      await expect(
        service.upsert({
          term: 'Project Aurora',
          key: 'aurora',
          origin: 'AGENT',
        }),
      ).rejects.toThrow(/never set keys/);
    });

    it('records repeatable case provenance as a PROVENANCE reference', async () => {
      prisma.case.findUnique.mockResolvedValue({ id: 'case-1' });
      prisma.glossaryReference.createMany.mockResolvedValue({ count: 1 });

      await service.upsert({
        term: 'Project Aurora',
        origin: 'AGENT',
        author: 'CASE',
        refType: 'case',
        refId: 'case-1',
      });

      expect(prisma.glossaryReference.createMany).toHaveBeenCalledWith({
        data: [
          {
            glossaryTermId: 'new-id',
            entityType: 'case',
            entityId: 'case-1',
            role: 'PROVENANCE',
            createdBy: 'CASE',
          },
        ],
        skipDuplicates: true,
      });
    });

    it('keeps agent aliases and codes for an operator term in proposedAliases (rule SL-8)', async () => {
      prisma.glossaryTerm.findFirst.mockResolvedValue({ ...baseTerm });

      const result = await service.upsert({
        term: 'little st. james',
        kind: 'ENTITY',
        aliases: ['the island'],
        notes: 'agent rewrite attempt',
        origin: 'AGENT',
      });

      expect(result.merged).toBe(true);
      expect(prisma.glossaryTerm.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { proposedAliases: ['the island'] } }),
      );
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('operator edits replace labels, rename, and keep the old key resolving', async () => {
      prisma.glossaryTerm.findUnique.mockResolvedValue({
        ...baseTerm,
        proposedAliases: ['The Island'],
      });

      await service.upsert({
        id: baseTerm.id,
        term: 'Little Saint James',
        key: 'little-saint-james',
        aliases: ['The Island'],
        codes: ['LSJ-1'],
        origin: 'OPERATOR',
      });

      expect(prisma.glossaryTerm.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: baseTerm.id },
          data: expect.objectContaining({
            term: 'Little Saint James',
            key: 'little-saint-james',
            previousKeys: ['little-st-james'],
            aliases: ['The Island'],
            codes: ['LSJ-1'],
            proposedAliases: [],
          }),
        }),
      );
    });

    it('refuses a key that is another term’s current or previous key', async () => {
      prisma.glossaryTerm.findUnique.mockResolvedValue({ ...baseTerm });
      prisma.glossaryTerm.findFirst.mockResolvedValue({ id: 'other' });

      await expect(
        service.upsert({
          id: baseTerm.id,
          term: baseTerm.term,
          key: 'taken',
          origin: 'OPERATOR',
        }),
      ).rejects.toThrow(/current or previous key/);
    });

    it('refuses a kind change that would break relations (R1)', async () => {
      prisma.glossaryTerm.findUnique.mockResolvedValue({ ...baseTerm });
      prisma.glossaryRelation.findMany.mockResolvedValue([
        {
          id: 'r1',
          fromTermId: baseTerm.id,
          toTermId: 'company',
          type: 'INSTANCE_OF',
          label: '',
          from: { key: baseTerm.key, term: baseTerm.term },
          to: { key: 'company', term: 'Company' },
        },
      ]);

      await expect(
        service.upsert({
          id: baseTerm.id,
          term: baseTerm.term,
          kind: 'CONCEPT',
          origin: 'OPERATOR',
        }),
      ).rejects.toThrow(/would break 1 relation/);
    });

    it('records an operator deletion and rejects later agent proposals', async () => {
      prisma.glossaryTerm.findUnique.mockResolvedValue({ ...baseTerm });

      await service.remove(baseTerm.id);

      expect(prisma.agentMemory.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ origin: 'OPERATOR' }),
        }),
      );
      prisma.glossaryTerm.findUnique.mockResolvedValue(null);
      prisma.agentMemory.findUnique.mockResolvedValue({ id: 'tombstone' });
      await expect(
        service.upsert({ term: baseTerm.term, origin: 'AGENT' }),
      ).rejects.toThrow('was deleted by an operator');
    });
  });

  describe('status lifecycle (R6)', () => {
    it('deprecates with a successor of the same kind and refuses one of another kind', async () => {
      prisma.glossaryTerm.findUnique.mockImplementation(({ where }) =>
        Promise.resolve(
          where.id === 'old'
            ? term('old', 'Old', { status: 'APPROVED' })
            : where.id === 'new'
              ? term('new', 'New', { status: 'APPROVED' })
              : where.id === 'entity'
                ? { ...baseTerm, id: 'entity' }
                : null,
        ),
      );
      await service.deprecate('old', 'new');
      expect(prisma.glossaryTerm.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'DEPRECATED',
            replacedById: 'new',
          }),
        }),
      );
      await expect(service.deprecate('old', 'entity')).rejects.toThrow(
        /same kind/,
      );
    });

    it('refuses DRAFT → DEPRECATED', async () => {
      prisma.glossaryTerm.findUnique.mockResolvedValue(
        term('d', 'Draft', { status: 'DRAFT' }),
      );
      await expect(service.deprecate('d')).rejects.toThrow(
        /cannot become DEPRECATED/,
      );
    });
  });

  describe('bulk update', () => {
    it('unapproves the selected ids and retypes them in one pass', async () => {
      prisma.glossaryTerm.findMany.mockResolvedValue([
        { id: baseTerm.id, key: baseTerm.key, kind: 'ENTITY' },
      ]);
      prisma.glossaryTerm.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.bulkUpdate({
        ids: [baseTerm.id],
        status: 'DRAFT',
        entityType: 'PERSON',
      });

      expect(prisma.glossaryTerm.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [baseTerm.id] } },
        data: {
          entityType: 'PERSON',
          status: 'DRAFT',
          approvedAt: null,
          approvedBy: null,
        },
      });
      expect(result).toEqual({ updatedCount: 1, ids: [baseTerm.id] });
    });

    it('rejects a call with no change and a call with both selections', async () => {
      await expect(service.bulkUpdate({ ids: [baseTerm.id] })).rejects.toThrow(
        /status change/,
      );
      await expect(
        service.bulkUpdate({
          ids: [baseTerm.id],
          filters: {},
          status: 'APPROVED',
        }),
      ).rejects.toThrow(/ids or filters/);
      expect(prisma.glossaryTerm.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('lookup (R7)', () => {
    // 'GES' is the Austrian register's own legal-form code for a GmbH, and it
    // is also a prefix of Geschäftsführer and Gesellschafter. Alphabetical
    // ordering over a substring match put both of those ahead of the term whose
    // code is literally the query.
    it('ranks an exact code above prefix matches', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: 'gmbh' }])
        .mockResolvedValueOnce([]);
      prisma.glossaryTerm.findMany.mockResolvedValue([
        term('gf', 'Geschäftsführer'),
        term('gs', 'Gesellschafter'),
        term('gmbh', 'GmbH', {
          codes: ['GES'],
          aliases: ['Gesellschaft mit beschränkter Haftung'],
        }),
      ]);

      const hits = await service.lookup('GES', 5);

      expect(hits[0].term).toBe('GmbH');
      expect(hits[0].matchedOn).toBe('code');
      expect(hits.slice(1).map((h) => h.matchedOn)).toEqual(['term', 'term']);
    });

    it('resolves a hidden alias exactly, never by substring', () => {
      const einzel = term('e', 'Einzelvertretung', { hiddenAliases: ['E'] });
      expect(lexicalRank('E', einzel)).toEqual({
        order: 2,
        matchedOn: 'hiddenAlias',
      });
      expect(lexicalRank('Ei', { ...einzel, term: 'Vertretung' })).toBeNull();
    });

    it('ranks a case-sensitive code above a case-insensitive alias hit', () => {
      const a = term('a', 'Aktiengesellschaft', { codes: ['AG'] });
      const b = term('b', 'Aufsichtsgremium', { aliases: ['ag'] });
      expect(lexicalRank('AG', a)!.order).toBeLessThan(
        lexicalRank('AG', b)!.order,
      );
    });

    // GENESIS field report P10: codes and statute names live in aliases, and a
    // query for part of one found nothing without embeddings.
    it('finds a term through part of a label, ranked by tier then length', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'pks' }]);
      prisma.glossaryTerm.findMany.mockResolvedValue([
        term('pks', 'Ausländerrechtliche Verstöße', {
          aliases: ['PKS 725000'],
        }),
        term('code', 'Schlüssel 725000'),
      ]);

      const hits = await service.lookup('725000', 5);

      expect(hits.map((h) => [h.term, h.matchedOn])).toEqual([
        ['Schlüssel 725000', 'term'],
        ['Ausländerrechtliche Verstöße', 'alias'],
      ]);
    });

    it('ranks an exact term above an exact alias on another term', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: 'other' }, { id: 'self' }])
        .mockResolvedValueOnce([]);
      prisma.glossaryTerm.findMany.mockResolvedValue([
        term('other', 'Aufsichtsrat', { aliases: ['AR'] }),
        term('self', 'AR'),
      ]);

      const hits = await service.lookup('AR', 5);

      expect(hits[0].term).toBe('AR');
      expect(hits[0].matchedOn).toBe('term');
    });

    // `E` is a hidden alias of one term and a letter in hundreds of names.
    // The exact hit is read on its own, so a full page of substring matches
    // cannot push it out.
    it('keeps an exact hit when the substring page is full', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: 'einzel' }])
        .mockResolvedValueOnce([]);
      prisma.glossaryTerm.findMany
        .mockResolvedValueOnce([
          term('einzel', 'Zeichnungsbefugnis allein', { hiddenAliases: ['E'] }),
        ])
        .mockResolvedValueOnce(
          Array.from({ length: 25 }, (_, i) => term(`t${i}`, `Entry ${i}`)),
        );

      const hits = await service.lookup('E', 5);

      expect(hits[0].id).toBe('einzel');
      expect(hits[0].matchedOn).toBe('hiddenAlias');
      expect(prisma.glossaryTerm.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { AND: [{ id: { in: ['einzel'] } }] },
        }),
      );
    });

    it('returns an exact hit on a DEPRECATED term, marked, with its successor', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: 'old' }])
        .mockResolvedValueOnce([]);
      prisma.glossaryTerm.findMany.mockResolvedValue([
        term('old', 'Old name', {
          status: 'DEPRECATED',
          replacedBy: { id: 'new', key: 'new-name', term: 'New name' },
        }),
        term('older', 'Old name archive', { status: 'DEPRECATED' }),
      ]);

      const hits = await service.lookup('Old name', 5);

      expect(hits).toHaveLength(1);
      expect(hits[0].deprecated).toBe(true);
      expect(hits[0].replacedBy).toEqual({
        id: 'new',
        key: 'new-name',
        term: 'New name',
      });
    });
  });
});

describe('glossary keys and labels (C8, R2, R8)', () => {
  it('transliterates and slugs a key', () => {
    expect(keyBase('Überschuldung')).toBe('ueberschuldung');
    expect(keyBase('Ausländerrechtliche Verstöße')).toBe(
      'auslaenderrechtliche-verstoesse',
    );
    expect(keyBase('Café São Paulo')).toBe('cafe-sao-paulo');
    expect(keyBase('  ---  ')).toBe('term');
  });

  it('appends -2, -3 on collision', async () => {
    const taken = new Set(['gmbh', 'gmbh-2']);
    await expect(
      generateKey('GmbH', (k) => Promise.resolve(taken.has(k))),
    ).resolves.toBe('gmbh-3');
  });

  it('normalises like the SQL glossary_norm', () => {
    expect(glossaryNorm('  ＧＥＳ  Haftung ')).toBe('ges haftung');
    expect(
      matchKeysFor({
        term: 'GmbH',
        aliases: ['gmbh'],
        codes: ['GES'],
        hiddenAliases: ['E'],
      }),
    ).toEqual(['gmbh', 'ges', 'e']);
  });

  it('suggests codes and hidden aliases, never moves them', () => {
    expect(suggestLabelKind('E')).toBe('hiddenAlias');
    expect(suggestLabelKind('GES')).toBe('code');
    expect(suggestLabelKind('PKS 725000')).toBe('code');
    expect(suggestLabelKind('HGB_224_3_A')).toBe('code');
    expect(suggestLabelKind('equity ratio')).toBeNull();
  });

  it('reads term URNs', () => {
    expect(keyFromTermUrn('term://glossary/gmbh')).toBe('gmbh');
    expect(keyFromTermUrn('TERM://Glossary/GmbH')).toBe('gmbh');
    expect(keyFromTermUrn('s3://bucket/x')).toBeNull();
  });
});
