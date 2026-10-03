import { ForbiddenException } from '@nestjs/common';
import { normalizeValue, valueHash } from '../correlation/value-normalizer';
import { EntityValuesService } from './entity-values.service';
import { mentionsCsv, type EntityMention } from './entity-mentions.service';

const NO_CONFIG = { nameLabels: {}, identifierLabels: [] };

function build(prisma: Record<string, unknown> = {}) {
  const switchService = {
    labels: jest.fn().mockResolvedValue(NO_CONFIG),
    rememberIdentifierLabel: jest.fn().mockResolvedValue(undefined),
  };
  const service = new EntityValuesService(
    prisma as never,
    switchService as never,
    { get: () => 'ns_test' } as never,
  );
  return { service, switchService };
}

describe('EntityValuesService', () => {
  describe('desiredAliases (R3)', () => {
    const { service } = build();

    it('normalises the name and aliases under every name label of the type', () => {
      const rows = service.desiredAliases(
        {
          term: 'ACME Holding GmbH',
          aliases: ['Acme'],
          entityType: 'ORGANIZATION',
        },
        ['organization', 'entity_organization', 'person'],
        NO_CONFIG,
      );

      const labels = new Set(rows.map((row) => row.label));
      expect(labels).toEqual(new Set(['organization', 'entity_organization']));
      // The hash is the value index's own, so the join needs no second
      // normalisation anywhere.
      const expected = valueHash(
        'organization',
        normalizeValue('organization', 'ACME Holding GmbH')!,
      );
      expect(rows.map((row) => row.valueHash)).toContain(expected);
    });

    it('never links a name shorter than four characters', () => {
      // "AG" as an alias would make every Aktiengesellschaft a mention.
      const rows = service.desiredAliases(
        {
          term: 'Austrian Group',
          aliases: ['AG', 'A G'],
          entityType: 'ORGANIZATION',
        },
        ['organization'],
        NO_CONFIG,
      );

      expect(rows.map((row) => row.normalizedValue)).toEqual([
        'austrian group',
      ]);
    });

    it('carries the blocking keys candidates are found by', () => {
      const [row] = service.desiredAliases(
        { term: 'John Smith', aliases: [], entityType: 'PERSON' },
        ['person'],
        NO_CONFIG,
      );

      expect(row.phoneticHash).toEqual(expect.any(String));
      expect(row.foldKey).toBe('johnsmith');
    });
  });

  // An identifier names exactly one thing. The second entity to claim one
  // gets a review, never a silent double link (R6).
  describe('confirmValue', () => {
    const term = {
      id: 'b',
      kind: 'ENTITY',
      term: 'Beta GmbH',
      key: 'beta',
      status: 'APPROVED',
    };
    const prismaWith = (holder: unknown) => {
      const upsert = jest.fn(({ create }: { create: object }) =>
        Promise.resolve({
          id: 'v1',
          createdAt: new Date(),
          agentVerdict: null,
          agentNote: null,
          createdBy: null,
          ...create,
        }),
      );
      return {
        upsert,
        prisma: {
          glossaryTerm: { findUnique: jest.fn().mockResolvedValue(term) },
          entityValue: {
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(holder),
            count: jest.fn().mockResolvedValue(0),
            upsert,
          },
          glossaryActivity: { create: jest.fn().mockResolvedValue({}) },
        },
      };
    };

    it('confirms an identifier nobody holds', async () => {
      const { prisma, upsert } = prismaWith(null);
      const { service, switchService } = build(prisma);

      const out = await service.confirmValue(
        'b',
        { label: 'IBAN_CODE', value: 'AT61 1904 3002 3457 3201' },
        { name: 'ada' },
      );

      expect(out.conflict).toBeNull();
      expect(upsert.mock.calls[0][0].create).toMatchObject({
        label: 'iban_code',
        verdict: 'CONFIRMED',
        conflictTermId: null,
        decidedBy: 'ada',
      });
      expect(switchService.rememberIdentifierLabel).toHaveBeenCalledWith(
        'iban_code',
      );
    });

    it('opens a conflict when another entity holds the identifier', async () => {
      const { prisma, upsert } = prismaWith({
        termId: 'a',
        term: { id: 'a', term: 'Alpha GmbH', key: 'alpha' },
      });
      const { service } = build(prisma);

      const out = await service.confirmValue(
        'b',
        { label: 'iban_code', value: 'AT611904300234573201' },
        { name: 'ada' },
      );

      expect(out.conflict).toEqual({
        id: 'a',
        term: 'Alpha GmbH',
        key: 'alpha',
      });
      expect(upsert.mock.calls[0][0].create).toMatchObject({
        verdict: 'PROPOSED',
        conflictTermId: 'a',
        decidedBy: null,
      });
    });

    it('lets two entities share a name: ambiguity, not a conflict', async () => {
      const { prisma, upsert } = prismaWith({
        termId: 'a',
        term: { id: 'a', term: 'Jane Doe', key: 'jane-doe' },
      });
      const { service } = build(prisma);

      const out = await service.confirmValue(
        'b',
        { label: 'person', value: 'Jane Doe' },
        { name: 'ada' },
        'MANUAL',
      );

      expect(out.conflict).toBeNull();
      expect(prisma.entityValue.findFirst).not.toHaveBeenCalled();
      expect(upsert.mock.calls[0][0].create).toMatchObject({
        verdict: 'CONFIRMED',
      });
    });

    it('only proposes when an agent asks', async () => {
      const { prisma, upsert } = prismaWith(null);
      const { service } = build(prisma);

      await service.confirmValue(
        'b',
        { label: 'email_address', value: 'office@beta.example' },
        { name: 'ai-autopilot', isAgent: true },
      );

      expect(upsert.mock.calls[0][0].create).toMatchObject({
        verdict: 'PROPOSED',
      });
    });

    it('refuses a tag label', async () => {
      const { prisma } = prismaWith(null);
      const { service } = build(prisma);

      await expect(
        service.confirmValue(
          'b',
          { label: 'tag:status', value: 'aufgelöst' },
          { name: 'ada' },
        ),
      ).rejects.toThrow(/never link/);
    });
  });

  it('never lets an agent decide candidates or merge (R22)', async () => {
    const { service } = build();
    const agent = { name: 'ai-autopilot', isAgent: true };

    await expect(
      service.review([{ id: 'v', decision: 'accept' }], agent),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.merge('a', 'b', agent)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('does not accept a conflict: the identifier would have two holders (R6)', async () => {
    const update = jest.fn();
    const prisma = {
      entityValue: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'c1', verdict: 'PROPOSED', termId: 'b', conflictTermId: 'a' },
          { id: 'm1', verdict: 'PROPOSED', termId: 'b', conflictTermId: null },
        ]),
        update,
      },
      glossaryActivity: { create: jest.fn().mockResolvedValue({}) },
    };
    const { service } = build(prisma);

    const out = await service.review(
      [
        { id: 'c1', decision: 'accept' },
        { id: 'm1', decision: 'accept' },
      ],
      { name: 'ada' },
    );

    expect(out.accepted).toBe(1);
    expect(out.skipped).toEqual([{ id: 'c1', reason: expect.any(String) }]);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].where).toEqual({ id: 'm1' });
  });

  it('defuses spreadsheet formulas in the access-request export', () => {
    const row = {
      assetName: '=HYPERLINK("http://evil")',
      externalUrl: 'https://x',
      sourceName: 'mail',
      snippet: {
        location: 'p1',
        matched: '+1 555',
        before: '',
        after: '',
      },
      findingType: 'PERSON',
      detectorType: 'PII',
      label: 'person',
      value: 'x',
      seenAt: null,
    } as unknown as EntityMention;

    const csv = mentionsCsv([row]);

    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(",'+1 555,");
    expect(csv).not.toMatch(/(^|,)=/m);
  });
});
