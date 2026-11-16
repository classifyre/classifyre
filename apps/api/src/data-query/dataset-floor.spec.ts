import {
  columnFloors,
  datasetColumnPolicy,
  datasetColumns,
  parseDatasetColumns,
  stricterClassification,
} from './dataset-floor';
import { groupPrincipal } from './data-principal';
import { clearScopeFor } from './clear-scope';
import { governedDataScope } from '../governance/governance-filter';

describe('shared dataset floors (DQ §5.12)', () => {
  const lineage = [
    {
      table: 'files.local.customers',
      fields: [
        { downstream: 'id', upstreams: ['id'], type: 'IDENTITY' },
        { downstream: 'email', upstreams: ['email'], type: 'IDENTITY' },
        {
          downstream: 'contact',
          upstreams: ['email', 'phone'],
          type: 'TRANSFORMED',
        },
        { downstream: null, upstreams: ['country'], type: 'INDIRECT' },
      ],
    },
    {
      table: 'files.local.orders',
      fields: [
        { downstream: 'total', upstreams: ['amount'], type: 'AGGREGATED' },
      ],
    },
    {
      table: '',
      fields: [{ downstream: 'n', upstreams: [], type: 'TRANSFORMED' }],
    },
  ];
  const ids: Record<string, string> = {
    'files.local.customers': 'cust',
    'files.local.orders': 'ord',
  };
  const columns = datasetColumns(
    [
      { name: 'id', type: 'BIGINT' },
      { name: 'email', type: 'VARCHAR' },
      { name: 'contact', type: 'VARCHAR' },
      { name: 'total', type: 'HUGEINT' },
      { name: 'label', type: 'VARCHAR' },
      { name: 'n', type: 'BIGINT' },
    ],
    lineage,
    (name) => ids[name],
  );
  const classes: Record<string, string> = {
    'cust/email': 'personal',
    'cust/phone': 'sensitive',
    'ord/amount': 'confidential',
  };
  const classify = (assetId: string, column: string) =>
    classes[`${assetId}/${column}`] ?? null;

  it('records each output column with the input columns it comes from', () => {
    expect(columns.find((c) => c.name === 'contact')).toEqual({
      name: 'contact',
      type: 'VARCHAR',
      upstreams: [
        { assetId: 'cust', column: 'email' },
        { assetId: 'cust', column: 'phone' },
      ],
      traced: true,
      transform: 'TRANSFORMED',
    });
    expect(columns.find((c) => c.name === 'total')?.transform).toBe(
      'AGGREGATED',
    );
    // Indirect dependencies (a WHERE, a join key) are not a column's source.
    expect(columns.find((c) => c.name === 'label')?.traced).toBe(false);
  });

  it('gives each column the strictest classification of its sources', () => {
    const floors = columnFloors(columns, classify, 'sensitive');
    expect(floors.get('id')).toEqual({ floor: null, from: [] });
    expect(floors.get('email')?.floor).toBe('personal');
    expect(floors.get('contact')).toEqual({
      floor: 'sensitive',
      from: [{ assetId: 'cust', column: 'phone' }],
    });
    expect(floors.get('total')?.floor).toBe('confidential');
  });

  it('a column no table feeds (count(*), a literal) inherits nothing', () => {
    expect(columns.find((c) => c.name === 'n')).toMatchObject({
      traced: true,
      upstreams: [],
      transform: 'CONSTANT',
    });
    expect(
      columnFloors(columns, classify, 'sensitive').get('n')?.floor,
    ).toBeNull();
  });

  it('fails closed: an untraced column takes the strictest input', () => {
    expect(
      columnFloors(columns, classify, 'sensitive').get('label')?.floor,
    ).toBe('sensitive');
  });

  it('lets the dataset be stricter, never looser', () => {
    // Nothing set: the floor's default mask.
    expect(
      datasetColumnPolicy({
        floor: 'personal',
        access: null,
        maskKind: null,
        classification: null,
      }),
    ).toMatchObject({ action: 'mask', mask: 'redact' });
    // A steward's "clear" or a lower classification cannot undo it.
    expect(
      datasetColumnPolicy({
        floor: 'personal',
        access: 'clear',
        maskKind: null,
        classification: 'public',
      }),
    ).toMatchObject({ action: 'mask', mask: 'redact' });
    // A weaker mask kind neither.
    expect(
      datasetColumnPolicy({
        floor: 'personal',
        access: null,
        maskKind: 'partial',
        classification: null,
      }),
    ).toMatchObject({ action: 'mask', mask: 'redact' });
    // Stricter is fine.
    expect(
      datasetColumnPolicy({
        floor: 'personal',
        access: 'hide',
        maskKind: null,
        classification: null,
      }),
    ).toMatchObject({ action: 'hide' });
    expect(
      datasetColumnPolicy({
        floor: null,
        access: null,
        maskKind: null,
        classification: 'secret',
      }),
    ).toMatchObject({ action: 'hide' });
  });

  it('orders classifications', () => {
    expect(stricterClassification('personal', 'secret')).toBe('secret');
    expect(stricterClassification(null, 'internal')).toBe('internal');
    expect(stricterClassification(null, null)).toBeNull();
  });

  it('reads stored columns defensively', () => {
    expect(
      parseDatasetColumns([
        {
          name: 'a',
          type: 'INT',
          upstreams: [{ assetId: 'x', column: 'a' }],
          traced: true,
        },
        { name: 'b', traced: true, upstreams: [] },
        { nope: 1 },
        'c',
      ]),
    ).toEqual([
      {
        name: 'a',
        type: 'INT',
        upstreams: [{ assetId: 'x', column: 'a' }],
        traced: true,
        transform: null,
      },
      { name: 'b', type: '', upstreams: [], traced: true, transform: null },
    ]);
  });
});

describe('a group as principal (DQ §5.12)', () => {
  const principal = groupPrincipal({
    groupId: 'finance',
    lineage: ['finance', 'org'],
    capabilities: new Set(['workspace.view']),
    resourceGrants: {
      'data.query': { sourceIds: ['src-1'], assetIds: ['t-1'] },
      'data.unmask': { sourceIds: [], assetIds: ['t-1'] },
    },
  });

  it('owns nothing (owners are people) but carries its lineage', () => {
    expect(principal.ownerRef).toBeNull();
    expect(principal.person).toEqual({
      actorRef: 'group:finance',
      groupIds: ['finance', 'org'],
    });
    expect(principal.resourceGrants('data.connect')).toEqual({
      sourceIds: [],
      assetIds: [],
    });
  });

  it('reads in clear what its grants and its stewardship give', async () => {
    const db = {
      governanceRole: {
        findMany: jest.fn().mockResolvedValue([
          { scopeType: 'ASSET', scopeId: 't-2' },
          { scopeType: 'SOURCE', scopeId: 'src-9' },
        ]),
      },
    };
    const scope = await clearScopeFor(db as never, principal);
    expect(scope.all).toBe(false);
    expect([...scope.assetIds].sort()).toEqual(['t-1', 't-2']);
    expect([...scope.sourceIds]).toEqual(['src-9']);
    // Stewardship of the group or a group above it counts.
    expect(db.governanceRole.findMany.mock.calls[0][0].where).toMatchObject({
      role: { in: ['OWNER', 'STEWARD'] },
      principalRef: { in: ['group:finance', 'group:org'] },
    });
  });

  it('a workspace-wide data.unmask reads everything in clear', async () => {
    const scope = await clearScopeFor({} as never, {
      ...principal,
      capabilities: new Set(['data.unmask']),
    });
    expect(scope.all).toBe(true);
  });

  it('nobody in particular governs nothing', async () => {
    const db = { governanceRole: { findMany: jest.fn() } };
    expect(await governedDataScope(db as never, null)).toEqual({
      assetIds: [],
      sourceIds: [],
    });
    expect(
      await governedDataScope(db as never, {
        actorRef: 'system:x',
        groupIds: ['a'],
      }),
    ).toEqual({ assetIds: [], sourceIds: [] });
    expect(db.governanceRole.findMany).not.toHaveBeenCalled();
  });
});
