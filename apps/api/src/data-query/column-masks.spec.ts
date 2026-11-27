import {
  columnsAsSeen,
  effectiveColumnPolicy,
  exposureOf,
  maskSalt,
  maskedType,
  parseRunMasks,
  runMasksOf,
  jobMasks,
  toColumnMask,
  type ColumnMask,
} from './column-masks';

describe('effectiveColumnPolicy', () => {
  it.each([
    [null, { action: 'clear', fromClassification: true }],
    ['public', { action: 'clear', fromClassification: true }],
    ['confidential', { action: 'clear', fromClassification: true }],
    ['personal', { action: 'mask', mask: 'redact', fromClassification: true }],
    ['sensitive', { action: 'mask', mask: 'redact', fromClassification: true }],
    ['secret', { action: 'hide', fromClassification: true }],
  ])('follows the classification %s when nobody set access', (c, want) => {
    expect(
      effectiveColumnPolicy({
        access: null,
        maskKind: null,
        classification: c,
      }),
    ).toEqual(want);
  });

  it("takes a steward's access over the classification", () => {
    expect(
      effectiveColumnPolicy({
        access: 'clear',
        maskKind: null,
        classification: 'secret',
      }),
    ).toEqual({ action: 'clear', fromClassification: false });
    expect(
      effectiveColumnPolicy({
        access: 'hide',
        maskKind: 'hash',
        classification: null,
      }),
    ).toEqual({ action: 'hide', fromClassification: false });
    expect(
      effectiveColumnPolicy({
        access: 'mask',
        maskKind: 'hash',
        classification: null,
      }),
    ).toEqual({ action: 'mask', mask: 'hash', fromClassification: false });
  });

  it('applies a mask kind to the default mask too', () => {
    expect(
      effectiveColumnPolicy({
        access: null,
        maskKind: 'partial',
        classification: 'personal',
      }),
    ).toEqual({ action: 'mask', mask: 'partial', fromClassification: true });
  });

  it('ignores values it does not know', () => {
    expect(
      effectiveColumnPolicy({
        access: 'reveal',
        maskKind: 'rot13',
        classification: 'personal',
      }),
    ).toEqual({ action: 'mask', mask: 'redact', fromClassification: true });
  });
});

describe('toColumnMask', () => {
  it('drops clear columns and keeps the rest', () => {
    expect(
      toColumnMask('a', { action: 'clear', fromClassification: true }),
    ).toBeNull();
    expect(
      toColumnMask('a', { action: 'hide', fromClassification: false }),
    ).toEqual({ column: 'a', action: 'hide' });
    expect(
      toColumnMask('a', {
        action: 'mask',
        mask: 'partial',
        fromClassification: false,
      }),
    ).toEqual({ column: 'a', action: 'mask', mask: 'partial' });
  });
});

describe('columnsAsSeen', () => {
  const columns = [
    { name: 'id', type: 'BIGINT' },
    { name: 'Email', type: 'VARCHAR' },
    { name: 'ssn', type: 'VARCHAR' },
    { name: 'customer_id', type: 'BIGINT' },
  ];
  const masks = [
    { column: 'email', action: 'mask' as const, mask: 'partial' as const },
    { column: 'ssn', action: 'hide' as const },
    { column: 'customer_id', action: 'mask' as const, mask: 'hash' as const },
    { column: 'gone', action: 'hide' as const },
  ];

  it('leaves hidden columns out and marks masked ones', () => {
    expect(columnsAsSeen(columns, masks, false)).toEqual({
      columns: [
        { name: 'id', type: 'BIGINT' },
        { name: 'Email', type: 'VARCHAR', access: 'mask', mask: 'partial' },
        {
          name: 'customer_id',
          type: 'VARCHAR',
          access: 'mask',
          mask: 'hash',
        },
      ],
      hidden: 1,
    });
  });

  it('shows everything to someone who reads it in clear, marked', () => {
    const seen = columnsAsSeen(columns, masks, true);
    expect(seen.hidden).toBe(0);
    expect(seen.columns.map((c) => [c.name, c.access, c.inClear])).toEqual([
      ['id', undefined, undefined],
      ['Email', 'mask', true],
      ['ssn', 'hide', true],
      ['customer_id', 'mask', true],
    ]);
    expect(seen.columns[3].type).toBe('BIGINT');
  });

  it('changes nothing without masks', () => {
    expect(columnsAsSeen(columns, [], false)).toEqual({ columns, hidden: 0 });
  });

  it('preserves isPrimaryKey and nullable on visible and masked columns while stripping hidden ones', () => {
    const richColumns = [
      { name: 'id', type: 'BIGINT', isPrimaryKey: true, nullable: false },
      { name: 'Email', type: 'VARCHAR', isPrimaryKey: false, nullable: true },
      { name: 'ssn', type: 'VARCHAR', isPrimaryKey: true, nullable: false },
    ];
    const seen = columnsAsSeen(richColumns, masks, false);
    expect(seen).toEqual({
      columns: [
        { name: 'id', type: 'BIGINT', isPrimaryKey: true, nullable: false },
        {
          name: 'Email',
          type: 'VARCHAR',
          isPrimaryKey: false,
          nullable: true,
          access: 'mask',
          mask: 'partial',
        },
      ],
      hidden: 1,
    });
  });
});

describe('maskedType and maskSalt', () => {
  it('types a hash as text and keeps every other type', () => {
    expect(maskedType('BIGINT', 'hash')).toBe('VARCHAR');
    expect(maskedType('BIGINT', 'null')).toBe('BIGINT');
    expect(maskedType('VARCHAR', 'redact')).toBe('VARCHAR');
  });

  it('hashes structs and lists value by value, keeping their shape', () => {
    expect(maskedType('INTEGER[2]', 'hash')).toBe('VARCHAR[]');
    expect(
      maskedType(
        'STRUCT("my name" VARCHAR, age INTEGER, addr STRUCT(zip INTEGER), tags BIGINT[])',
        'hash',
      ),
    ).toBe(
      'STRUCT("my name" VARCHAR, age VARCHAR, addr STRUCT(zip VARCHAR), tags VARCHAR[])',
    );
    expect(maskedType('STRUCT(e INTEGER)[]', 'hash')).toBe(
      'STRUCT(e VARCHAR)[]',
    );
    expect(maskedType('MAP(VARCHAR, INTEGER)', 'hash')).toBe('VARCHAR');
    expect(maskedType('STRUCT(a INTEGER)', 'redact')).toBe('STRUCT(a INTEGER)');
  });

  it('gives each workspace its own stable key', () => {
    const secret = Buffer.from('s'.repeat(32));
    expect(maskSalt(secret, 'ws-1')).toBe(maskSalt(secret, 'ws-1'));
    expect(maskSalt(secret, 'ws-1')).not.toBe(maskSalt(secret, 'ws-2'));
    expect(maskSalt(secret, 'ws-1')).toHaveLength(32);
  });
});

describe('exposureOf', () => {
  it('orders restricted, hidden, emptied or redacted, hashed, last four, scrubbed, clear', () => {
    const of = (
      action: 'clear' | 'mask' | 'hide' | 'restrict',
      mask?: string,
    ) =>
      exposureOf(
        effectiveColumnPolicy({
          access: action,
          maskKind: mask ?? null,
          classification: null,
        }),
      );
    const order = [
      of('restrict'),
      of('hide'),
      of('mask', 'redact'),
      of('mask', 'hash'),
      of('mask', 'partial'),
      of('mask', 'scrub'),
      of('clear'),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(order).size).toBe(order.length);
    expect(of('mask', 'null')).toBe(of('mask', 'redact'));
  });
});

describe('run masks', () => {
  const tables = [
    {
      sqlName: 'lab.crm.contacts',
      masks: [
        { column: 'email', action: 'mask' as const, mask: 'hash' as const },
        { column: 'ssn', action: 'hide' as const },
      ],
    },
  ];

  it('names masked columns and counts hidden ones without their names', () => {
    expect(runMasksOf(tables)).toEqual([
      {
        table: 'lab.crm.contacts',
        action: 'mask',
        column: 'email',
        mask: 'hash',
      },
      { table: 'lab.crm.contacts', action: 'hide' },
    ]);
  });

  it('reads stored masks back, dropping hidden names and odd shapes', () => {
    expect(
      parseRunMasks([
        { table: 't', action: 'mask', column: 'email', mask: 'rot13' },
        { table: 't', action: 'hide', column: 'ssn' },
        { table: 't', action: 'reveal', column: 'x' },
        { action: 'mask', column: 'y' },
        'junk',
      ]),
    ).toEqual([
      { table: 't', action: 'mask', column: 'email', mask: 'redact' },
      { table: 't', action: 'hide' },
    ]);
    expect(parseRunMasks(null)).toEqual([]);
  });
});

describe('restricted columns and scrubbed text (2026-11-23)', () => {
  // Kestrel & Finch: sales reps given "Data reader, unmasked" also read the
  // social insurance numbers the steward had hidden; a ticket body with two
  // keys in it was hidden whole from customer care.
  it('restrict is a policy of its own, stricter than hide', () => {
    const restrict = effectiveColumnPolicy({
      access: 'restrict',
      maskKind: null,
      classification: 'sensitive',
    });
    expect(restrict).toEqual({ action: 'restrict', fromClassification: false });
    const hide = effectiveColumnPolicy({
      access: 'hide',
      maskKind: null,
      classification: null,
    });
    expect(exposureOf(restrict)).toBeLessThan(exposureOf(hide));
  });

  it('scrub shows more than any other mask, less than clear', () => {
    const scrub = effectiveColumnPolicy({
      access: 'mask',
      maskKind: 'scrub',
      classification: 'secret',
    });
    const partial = { ...scrub, mask: 'partial' as const };
    expect(scrub.mask).toBe('scrub');
    expect(exposureOf(scrub)).toBeGreaterThan(exposureOf(partial));
    expect(exposureOf(scrub)).toBeLessThan(
      exposureOf({ action: 'clear', fromClassification: false }),
    );
  });

  const columns = [
    { name: 'email', type: 'VARCHAR' },
    { name: 'svnr', type: 'VARCHAR' },
    { name: 'region', type: 'VARCHAR' },
  ];
  const masks: ColumnMask[] = [
    { column: 'email', action: 'mask', mask: 'hash' },
    { column: 'svnr', action: 'restrict' },
  ];

  it('hides a restricted column from someone who reads the table in clear', () => {
    const seen = columnsAsSeen(columns, masks, true, false);
    expect(seen.hidden).toBe(1);
    expect(seen.columns.map((c) => c.name)).toEqual(['email', 'region']);
    expect(jobMasks(masks, true, false)).toEqual([
      { column: 'svnr', action: 'hide' },
    ]);
  });

  it('shows it to its owners and stewards', () => {
    const seen = columnsAsSeen(columns, masks, true, true);
    expect(seen.hidden).toBe(0);
    expect(seen.columns.find((c) => c.name === 'svnr')).toMatchObject({
      access: 'restrict',
      inClear: true,
    });
    expect(jobMasks(masks, true, true)).toEqual([]);
  });

  it('hides it, and masks the rest, for everyone else', () => {
    expect(columnsAsSeen(columns, masks, false, false).hidden).toBe(1);
    expect(jobMasks(masks, false, false)).toEqual([
      { column: 'email', action: 'mask', mask: 'hash' },
      { column: 'svnr', action: 'hide' },
    ]);
  });
});
