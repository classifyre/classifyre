import { parse, stringify } from 'yaml';
import { fromContract, logicalType, toContract } from './odcs';
import { compileQuality, ident, literal, readCsvRow } from './quality-sql';
import { RuleError, validateRule, validSchedule } from './quality-rules';
import { dueRules } from './quality.worker';

describe('whole-table quality rules (GOV G-4)', () => {
  it('compiles every rule of a table into one SELECT', () => {
    const compiled = compileQuality(
      'shop.public.orders',
      ['id', 'email', 'status'],
      [
        {
          id: 'a',
          type: 'library',
          metric: 'nullValues',
          columnName: 'email',
          arguments: {},
        },
        {
          id: 'b',
          type: 'library',
          metric: 'invalidValues',
          columnName: 'status',
          arguments: { validValues: ['open', "it's"], pattern: '^[a-z]+$' },
        },
        {
          id: 'c',
          type: 'library',
          metric: 'duplicateValues',
          columnName: 'id',
          arguments: {},
        },
        {
          id: 'd',
          type: 'library',
          metric: 'duplicateValues',
          columnName: null,
          arguments: { properties: ['id', 'email'] },
        },
        {
          id: 'e',
          type: 'sql',
          metric: 'query',
          columnName: 'email',
          arguments: {
            query: "SELECT COUNT(*) FROM {object} WHERE {property} LIKE '%@%'",
          },
        },
        {
          id: 'f',
          type: 'library',
          metric: 'nullValues',
          columnName: 'gone',
          arguments: {},
        },
      ],
    );
    expect(compiled.sql).toBe(
      'SELECT COUNT(*) AS q__rows, ' +
        'SUM(CASE WHEN "email" IS NULL THEN 1 ELSE 0 END) AS q_0, ' +
        `SUM(CASE WHEN "status" IS NOT NULL AND (CAST("status" AS VARCHAR) NOT IN ('open', 'it''s') OR NOT REGEXP_MATCHES(CAST("status" AS VARCHAR), '^[a-z]+$')) THEN 1 ELSE 0 END) AS q_1, ` +
        'COUNT("id") - COUNT(DISTINCT "id") AS q_2, ' +
        'COUNT(*) - (SELECT COUNT(*) FROM (SELECT DISTINCT "id", "email" FROM shop.public.orders) AS q__distinct) AS q_3, ' +
        `(SELECT COUNT(*) FROM shop.public.orders WHERE "email" LIKE '%@%') AS q_4 ` +
        'FROM shop.public.orders',
    );
    expect(compiled.aliases.get('e')).toBe('q_4');
    expect(compiled.errors.get('f')).toMatch(/no column gone/);
  });

  it('quotes names and literals', () => {
    expect(ident('a"b')).toBe('"a""b"');
    expect(literal("o'k")).toBe("'o''k'");
    expect(literal(3)).toBe('3');
  });

  it('reads the job CSV', () => {
    const row = readCsvRow('q__rows,q_0,q_1\n120,3,\n');
    expect(row.get('q__rows')).toBe(120);
    expect(row.get('q_0')).toBe(3);
    expect(row.get('q_1')).toBeNull();
    expect(readCsvRow('').size).toBe(0);
  });

  it('validates library and sql rules', () => {
    const nulls = validateRule({
      name: 'Email filled',
      type: 'library',
      metric: 'nullValues',
      columnName: 'email',
      dimension: 'completeness',
      operator: 'mustBeLessThan',
      threshold: 5,
      unit: 'percent',
      schedule: 'daily',
    });
    expect(nulls).toMatchObject({ unit: 'percent', schedule: '0 6 * * *' });
    expect(() =>
      validateRule({ ...nulls, columnName: null, unit: 'percent' }),
    ).toThrow(/one column/);
    expect(() =>
      validateRule({
        name: 'Bad',
        type: 'library',
        metric: 'invalidValues',
        columnName: 'status',
        dimension: 'conformity',
        operator: 'mustBe',
        threshold: 0,
      }),
    ).toThrow(/validValues or arguments.pattern/);
    expect(() =>
      validateRule({
        name: 'Two',
        type: 'sql',
        metric: 'query',
        dimension: 'accuracy',
        operator: 'mustBe',
        threshold: 0,
        arguments: { query: 'SELECT 1; DROP TABLE x' },
      }),
    ).toThrow(RuleError);
    expect(() =>
      validateRule({
        name: 'Fresh',
        type: 'metadata',
        metric: 'rowCount',
        dimension: 'completeness',
        operator: 'mustBe',
        threshold: 1,
        unit: 'percent',
      }),
    ).toThrow(/percent/);
  });

  it('accepts schedules at most hourly', () => {
    expect(validSchedule(null)).toBeNull();
    expect(validSchedule('hourly')).toBe('0 * * * *');
    expect(validSchedule('15 2 * * *')).toBe('15 2 * * *');
    expect(() => validSchedule('*/5 * * * *')).toThrow(/at most hourly/);
    expect(() => validSchedule('daily please')).toThrow(RuleError);
  });

  it('finds the rules that came due since they last ran', () => {
    const now = new Date('2026-11-12T06:03:00Z');
    const due = dueRules(
      [
        { id: 'a', schedule: '0 6 * * *', lastScheduledAt: null },
        {
          id: 'b',
          schedule: '0 6 * * *',
          lastScheduledAt: new Date('2026-11-12T06:00:00Z'),
        },
        { id: 'c', schedule: '0 7 * * *', lastScheduledAt: null },
        { id: 'd', schedule: null, lastScheduledAt: null },
      ],
      now,
    );
    expect(due.map((r) => [r.id, r.at.toISOString()])).toEqual([
      ['a', '2026-11-12T06:00:00.000Z'],
    ]);
  });
});

describe('ODCS contracts (GOV §5.5)', () => {
  const input = {
    id: 'asset:1',
    version: '1.4.0',
    name: 'orders',
    domain: 'shop',
    status: 'active',
    description: 'Orders, one row each.',
    usage: null,
    limitations: 'No refunds.',
    legalBasis: 'CONTRACT',
    retention: '10 y',
    terms: ['customer-order'],
    members: [
      {
        username: 'ann@example.org',
        name: 'Ann',
        role: 'owner' as const,
        dateIn: '2026-11-01T00:00:00.000Z',
      },
      { username: '/finance', name: 'finance', role: 'steward' as const },
      {
        username: 'old@example.org',
        role: 'owner' as const,
        dateOut: '2026-10-01T00:00:00.000Z',
      },
    ],
    table: 'shop.public.orders',
    physicalName: 'orders',
    columns: [
      {
        name: 'email',
        type: 'VARCHAR',
        businessName: 'Customer e-mail',
        description: null,
        classification: 'personal',
        criticalDataElement: true,
        termKey: 'email-address',
      },
      {
        name: 'id',
        type: 'BIGINT',
        businessName: null,
        description: null,
        classification: null,
        criticalDataElement: false,
        termKey: null,
      },
    ],
    rules: [
      {
        key: 'email-filled',
        name: 'Email filled',
        description: null,
        columnName: 'email',
        dimension: 'completeness',
        type: 'library',
        metric: 'nullValues',
        arguments: {},
        operator: 'mustBeLessThan',
        threshold: 5,
        unit: 'percent',
        severity: 'HIGH',
        businessImpact: null,
        schedule: '0 6 * * *',
      },
      {
        key: 'no-pii-notes',
        name: 'No PII',
        description: null,
        columnName: null,
        dimension: 'conformity',
        type: 'detector',
        metric: 'openFindings',
        arguments: { detectorType: 'PII' },
        operator: 'mustBe',
        threshold: 0,
        unit: 'findings',
        severity: 'MEDIUM',
        businessImpact: null,
        schedule: null,
      },
      {
        key: 'fresh',
        name: 'Fresh',
        description: null,
        columnName: null,
        dimension: 'timeliness',
        type: 'metadata',
        metric: 'freshness',
        arguments: {},
        operator: 'mustBeLessOrEqualTo',
        threshold: 24,
        unit: 'hours',
        severity: 'LOW',
        businessImpact: null,
        schedule: null,
      },
    ],
    qualityScore: 80,
    url: null,
  };

  it('writes a v3.2 contract with team, schema, quality and SLA', () => {
    const contract = toContract(input) as Record<string, any>;
    expect(contract).toMatchObject({
      apiVersion: 'v3.2.0',
      kind: 'DataContract',
      status: 'active',
      description: {
        purpose: 'Orders, one row each.',
        limitations: 'No refunds.',
      },
      authoritativeDefinitions: [{ url: 'term://glossary/customer-order' }],
    });
    expect(contract.team.members).toHaveLength(3);
    const email = contract.schema[0].properties[0];
    expect(email).toMatchObject({
      name: 'email',
      logicalType: 'string',
      businessName: 'Customer e-mail',
      classification: 'personal',
      criticalDataElement: true,
      quality: [
        {
          id: 'email-filled',
          type: 'library',
          metric: 'nullValues',
          mustBeLessThan: 5,
          unit: 'percent',
          scheduler: 'cron',
        },
      ],
    });
    expect(contract.schema[0].quality[0]).toMatchObject({
      type: 'custom',
      engine: 'classifyre',
      mustBe: 0,
    });
    expect(contract.slaProperties).toEqual([
      expect.objectContaining({ property: 'latency', value: 24, unit: 'h' }),
      expect.objectContaining({ property: 'retention', value: '10 y' }),
    ]);
  });

  it('reads back what it wrote, through YAML', () => {
    const plan = fromContract(parse(stringify(toContract(input))));
    expect(plan.status).toBe('active');
    expect(plan.description).toBe('Orders, one row each.');
    expect(plan.members).toEqual([
      { username: 'ann@example.org', role: 'OWNER' },
      { username: '/finance', role: 'STEWARD' },
    ]);
    expect(plan.columns[0]).toMatchObject({
      name: 'email',
      businessName: 'Customer e-mail',
      classification: 'personal',
      criticalDataElement: true,
      termKey: 'email-address',
    });
    expect(
      plan.rules.map((r) => [r.key, r.type, r.metric, r.columnName]),
    ).toEqual([
      ['no-pii-notes', 'detector', 'openFindings', null],
      ['fresh', 'metadata', 'freshness', null],
      ['email-filled', 'library', 'nullValues', 'email'],
    ]);
    expect(plan.legalBasis).toBe('CONTRACT');
    expect(plan.skipped).toEqual([]);
  });

  it('skips what it cannot evaluate, and says why', () => {
    const plan = fromContract({
      kind: 'DataContract',
      team: { members: [{ username: 'x', role: 'analyst' }] },
      schema: [
        {
          name: 't',
          quality: [
            { id: 'sodacheck', type: 'custom', engine: 'soda', mustBe: 0 },
            { id: 'nocompare', type: 'library', metric: 'rowCount' },
          ],
        },
        { name: 'second' },
      ],
    });
    expect(plan.skipped.map((s) => s.reason)).toEqual([
      'Needs a username and the role owner, steward or custodian.',
      'Only the first object applies: this contract describes one table.',
      'sodacheck: engine soda is not evaluated here.',
      'nocompare: no mustBe… comparison.',
    ]);
    expect(() => fromContract({ kind: 'Nope' })).toThrow(/DataContract/);
  });

  it('maps types to ODCS logical types', () => {
    expect(
      [
        'BIGINT',
        'double',
        'BOOLEAN',
        'TIMESTAMP WITH TIME ZONE',
        'date',
        'STRUCT(a INT)',
        'VARCHAR[]',
        'long',
      ].map(logicalType),
    ).toEqual([
      'integer',
      'number',
      'boolean',
      'timestamp',
      'date',
      'object',
      'array',
      'integer',
    ]);
  });
});
