import { BadRequestException } from '@nestjs/common';

import {
  metadataPredicatePrisma,
  metadataPredicateSql,
  parseMetadataPath,
  parseMetadataWhere,
} from './asset-metadata-predicate';

describe('parseMetadataPath', () => {
  it('accepts the documented metadata. prefix, a bare key and nesting', () => {
    expect(parseMetadataPath('metadata.legal_form_code')).toEqual([
      'legal_form_code',
    ]);
    expect(parseMetadataPath('legal_form_code')).toEqual(['legal_form_code']);
    expect(parseMetadataPath('address.postcode')).toEqual([
      'address',
      'postcode',
    ]);
  });

  it.each(['', 'a..b', 'a b', "x'); DROP TABLE assets; --", 'a.b.c.d.e.f'])(
    'refuses %p',
    (key) => {
      expect(() => parseMetadataPath(key)).toThrow(BadRequestException);
    },
  );
});

describe('parseMetadataWhere', () => {
  it('turns the request example into predicates', () => {
    expect(
      parseMetadataWhere({
        'metadata.filing_count': { gt: 0 },
        legal_form_code: { in: ['GES', 'AG'] },
      }),
    ).toEqual([
      { path: ['filing_count'], operator: 'gt', value: 0 },
      { path: ['legal_form_code'], operator: 'in', value: ['GES', 'AG'] },
    ]);
  });

  it('fails loudly on what it does not understand, never matching everything', () => {
    for (const where of [
      { k: { equals: 'x' } },
      { k: 'x' },
      { k: {} },
      { k: { in: [] } },
      { k: { in: [{ nested: true }] } },
      { k: { exists: 'yes' } },
      { k: { gt: true } },
      { k: { eq: null } },
      ['k'],
    ]) {
      expect(() => parseMetadataWhere(where)).toThrow(BadRequestException);
    }
  });

  it('names the operators a caller may use when it restricts them', () => {
    expect(() =>
      parseMetadataWhere({ k: { gt: 1 } }, { operators: ['eq', 'in'] }),
    ).toThrow(/use one of: eq, in/);
  });
});

describe('metadataPredicateSql', () => {
  it('compares JSON values, and ranges only against their own type', () => {
    const sql = metadataPredicateSql(
      parseMetadataWhere({
        legal_form_code: { in: ['GES', 'AG'] },
        filing_count: { gt: 0 },
        filed_on: { gte: '2024-01-01' },
        euid: { exists: false },
        active: { eq: true },
      }),
      'a',
    );

    expect(sql.sql).toContain('a.metadata #> ?::text[] = ANY(?::jsonb[])');
    expect(sql.sql).toContain(
      "(jsonb_typeof(a.metadata #> ?::text[]) = 'number' AND (a.metadata #>> ?::text[])::numeric > ?)",
    );
    expect(sql.sql).toContain(
      "(jsonb_typeof(a.metadata #> ?::text[]) = 'string' AND a.metadata #>> ?::text[] >= ?)",
    );
    expect(sql.sql).toContain(
      "(a.metadata #> ?::text[] IS NULL OR jsonb_typeof(a.metadata #> ?::text[]) = 'null')",
    );
    expect(sql.sql).toContain('a.metadata #> ?::text[] = ?::jsonb');
    // Every value is bound; JSON-encoded where compared as jsonb.
    expect(sql.values).toEqual([
      ['legal_form_code'],
      ['"GES"', '"AG"'],
      ['filing_count'],
      ['filing_count'],
      0,
      ['filed_on'],
      ['filed_on'],
      '2024-01-01',
      ['euid'],
      ['euid'],
      ['active'],
      'true',
    ]);
  });

  it('is TRUE for no predicates and refuses an alias it cannot trust', () => {
    expect(metadataPredicateSql([], 'a').sql).toBe('TRUE');
    expect(() => metadataPredicateSql([], 'a; DROP')).toThrow();
  });
});

describe('metadataPredicatePrisma', () => {
  it('compiles equality to JSON path filters', () => {
    expect(
      metadataPredicatePrisma(
        parseMetadataWhere(
          { status: { eq: 'active' }, legal_form_code: { in: ['GES', 'AG'] } },
          { operators: ['eq', 'in'] },
        ),
      ),
    ).toEqual([
      { metadata: { path: ['status'], equals: 'active' } },
      {
        OR: [
          { metadata: { path: ['legal_form_code'], equals: 'GES' } },
          { metadata: { path: ['legal_form_code'], equals: 'AG' } },
        ],
      },
    ]);
  });

  it('refuses a range rather than answer it with jsonb type ordering', () => {
    expect(() =>
      metadataPredicatePrisma([
        { path: ['filing_count'], operator: 'gt', value: 0 },
      ]),
    ).toThrow(BadRequestException);
  });
});
