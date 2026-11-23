import { groupRowsOf, rowProblems } from './dataset-input-rows';

describe('rows the owning group reads of an input (DQ §5.12)', () => {
  it('is all without filtering, or with a rule without conditions', () => {
    expect(groupRowsOf({})).toBe('all');
    expect(groupRowsOf({ rowFilter: { anyOf: [[]] } })).toBe('all');
    expect(
      groupRowsOf({
        rowFilter: {
          anyOf: [[], [{ column: 'region', op: 'in', values: ['DACH'] }]],
        },
      }),
    ).toBe('all');
  });

  it('is filtered when a rule with conditions selects its rows', () => {
    expect(
      groupRowsOf({
        rowFilter: {
          anyOf: [[{ column: 'region', op: 'in', values: ['DACH'] }]],
        },
      }),
    ).toBe('filtered');
  });

  it('is none when filtering is on and no rule is for the group (fails closed)', () => {
    expect(groupRowsOf({ rowFilter: { anyOf: [] } })).toBe('none');
  });

  it('is unknown without a group catalog entry', () => {
    expect(groupRowsOf(undefined)).toBeNull();
  });

  it('names every input the group reads no row of, as a problem that blocks sharing', () => {
    // Found 2026-11-23 (Kestrel & Finch battle test): a three-input dataset
    // shared fine and silently returned only the one unfiltered input's rows.
    expect(
      rowProblems([
        { sqlName: 'crm.contacts', groupRows: 'none' },
        { sqlName: 'loyalty.members', groupRows: 'all' },
        { sqlName: 'sf.contact', groupRows: 'none' },
        { sqlName: 'sf.opportunity', groupRows: 'filtered' },
      ]),
    ).toEqual([
      'The owning group reads no row of crm.contacts, sf.contact: row filtering is on there and no rule is for the group. Add one in the table’s Rows step, or pick another owning group.',
    ]);
    expect(rowProblems([{ sqlName: 'x', groupRows: 'filtered' }])).toEqual([]);
  });
});
