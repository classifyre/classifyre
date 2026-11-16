import {
  RowRuleError,
  parseConditions,
  parseRowPrincipal,
  parseRunRowFilters,
  rowPolicyLoosens,
  type RowCondition,
} from './row-filters';

const at: RowCondition[] = [{ column: 'region', op: 'in', values: ['Tirol'] }];
const wider: RowCondition[] = [
  { column: 'region', op: 'in', values: ['Tirol', 'Wien'] },
];

describe('row filter rules (DQ §5.10)', () => {
  it('reads conditions and drops repeated values', () => {
    expect(
      parseConditions([
        { column: ' region ', op: 'in', values: ['Tirol', 'Tirol', 3, true] },
      ]),
    ).toEqual([{ column: 'region', op: 'in', values: ['Tirol', 3, true] }]);
  });

  it.each([
    ['not a list', 'region'],
    ['no column', [{ op: 'in', values: ['a'] }]],
    ['an unknown test', [{ column: 'r', op: 'like', values: ['a'] }]],
    ['no value', [{ column: 'r', op: 'in', values: [] }]],
    ['an object value', [{ column: 'r', op: 'in', values: [{}] }]],
    [
      'too many conditions',
      Array(6).fill({ column: 'r', op: 'in', values: [1] }),
    ],
  ])('refuses %s', (_, input) => {
    expect(() => parseConditions(input)).toThrow(RowRuleError);
  });

  it('takes rules for groups and everyone, never for a person', () => {
    expect(parseRowPrincipal('group:g-1')).toBe('group:g-1');
    expect(parseRowPrincipal('everyone')).toBe('everyone');
    expect(() => parseRowPrincipal('user:ana')).toThrow(RowRuleError);
  });

  describe('what shows readers more rows', () => {
    const on = (
      rules: { id: string; principalRef: string; conditions: RowCondition[] }[],
    ) => ({
      enabled: true,
      rules,
    });
    const rule = { id: 'r-1', principalRef: 'group:g-1', conditions: at };

    it.each([
      ['turning filtering off', on([rule]), { enabled: false, rules: [] }],
      [
        'a new rule',
        on([rule]),
        on([rule, { ...rule, id: 'r-2', principalRef: 'group:g-2' }]),
      ],
      [
        'a rule without an id',
        on([rule]),
        {
          enabled: true,
          rules: [rule, { principalRef: 'everyone', conditions: at }],
        },
      ],
      ['widening a rule', on([rule]), on([{ ...rule, conditions: wider }])],
      [
        'giving a rule to another group',
        on([rule]),
        on([{ ...rule, principalRef: 'group:g-2' }]),
      ],
    ])('%s loosens', (_, before, after) => {
      expect(rowPolicyLoosens(before, after)).toBe(true);
    });

    it.each([
      [
        'turning filtering on, with rules',
        { enabled: false, rules: [] },
        on([rule]),
      ],
      ['removing a rule', on([rule, { ...rule, id: 'r-2' }]), on([rule])],
      ['changing nothing', on([rule]), on([rule])],
      [
        'staying off',
        { enabled: false, rules: [] },
        { enabled: false, rules: [] },
      ],
    ])('%s does not', (_, before, after) => {
      expect(rowPolicyLoosens(before, after)).toBe(false);
    });
  });

  it('keeps run filters of the stored shape only', () => {
    expect(
      parseRunRowFilters([
        { table: 'a.b.c', anyOf: [at] },
        { table: 'a.b.d', anyOf: [[{ column: 'x', op: 'drop', values: [1] }]] },
        { anyOf: [] },
      ]),
    ).toEqual([{ table: 'a.b.c', anyOf: [at] }]);
  });
});
