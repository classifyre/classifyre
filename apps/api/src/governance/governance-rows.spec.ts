import { GovernanceRowsService } from './governance-rows.service';

/**
 * Row filters on the Governance tab (docs/prd/DQ-data-query.md §5.10): who
 * governs a table may make readers see fewer rows; only who sees every row
 * (its owner or a steward) may make them see more.
 */
const STOP = new Error('stop: past the checks');
const region = (values: string[]) => [{ column: 'region', op: 'in', values }];

function service(input: {
  allowed?: boolean;
  /** The caller owns or stewards the table. */
  everyRow?: boolean;
  before?: { id: string; principalRef: string; conditions: unknown }[] | null;
}) {
  const prisma = {
    assetRowPolicy: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          input.before === undefined || input.before === null
            ? null
            : { assetId: 'a-1', rules: input.before },
        ),
    },
    governanceRole: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          input.everyRow ? [{ scopeType: 'ASSET', scopeId: 'a-1' }] : [],
        ),
    },
    $transaction: jest.fn().mockRejectedValue(STOP),
  };
  const governance = {
    mayGovernScope: jest.fn().mockResolvedValue({
      allowed: input.allowed ?? true,
      name: 'customers',
      sourceId: 's-1',
    }),
    person: () => ({ actorRef: 'user:ana', groupIds: ['g-1'] }),
    assertPrincipalExists: jest.fn().mockResolvedValue(undefined),
  };
  const columns = {
    state: jest.fn().mockResolvedValue({
      columns: [{ name: 'region' }, { name: 'email' }],
    }),
  };
  return new GovernanceRowsService(
    prisma as never,
    governance as never,
    columns as never,
    { current: () => ({ ref: 'user:ana' }) } as never,
    { resolve: jest.fn().mockResolvedValue([]) } as never,
    { record: jest.fn() } as never,
  );
}

const code = (error: unknown) =>
  (error as { getResponse?: () => { code?: string } }).getResponse?.().code;

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'done';
  } catch (error) {
    if (error === STOP) return 'allowed';
    return code(error) ?? (error as Error).message;
  }
}

const rule = {
  id: 'r-1',
  principalRef: 'group:g-1',
  conditions: region(['Tirol']),
};

describe('changing row filters', () => {
  it('refuses someone who does not govern the table', async () => {
    expect(
      await outcome(() =>
        service({ allowed: false }).updateAssetRows('a-1', {
          enabled: true,
          rules: [],
        }),
      ),
    ).toBe('CAPABILITY_REQUIRED');
  });

  it.each([
    ['turning filtering on', null, { enabled: true, rules: [rule] }],
    [
      'removing a rule',
      [rule, { ...rule, id: 'r-2' }],
      { enabled: true, rules: [rule] },
    ],
  ])(
    'lets an admin who is filtered make it stricter: %s',
    async (_, before, body) => {
      expect(
        await outcome(() => service({ before }).updateAssetRows('a-1', body)),
      ).toBe('allowed');
    },
  );

  it.each([
    ['turning filtering off', [rule], { enabled: false }],
    [
      'adding a rule',
      [rule],
      {
        enabled: true,
        rules: [rule, { principalRef: 'everyone', conditions: [] }],
      },
    ],
    [
      'widening a rule',
      [rule],
      {
        enabled: true,
        rules: [{ ...rule, conditions: region(['Tirol', 'Wien']) }],
      },
    ],
  ])('refuses that admin %s', async (_, before, body) => {
    expect(
      await outcome(() => service({ before }).updateAssetRows('a-1', body)),
    ).toBe('ALL_ROWS_REQUIRED');
  });

  it('lets the owner or a steward show more', async () => {
    expect(
      await outcome(() =>
        service({ before: [rule], everyRow: true }).updateAssetRows('a-1', {
          enabled: false,
        }),
      ),
    ).toBe('allowed');
  });

  it.each([
    [
      'a column the table does not have',
      {
        principalRef: 'everyone',
        conditions: [{ column: 'zip', op: 'in', values: ['1'] }],
      },
      'This table has no column zip.',
    ],
    [
      'a rule for one person',
      { principalRef: 'user:ana', conditions: [] },
      'A rule is for a group (group:<id>) or for everyone: access goes to groups.',
    ],
  ])('refuses %s', async (_, ruleInput, message) => {
    expect(
      await outcome(() =>
        service({ before: null }).updateAssetRows('a-1', {
          enabled: true,
          rules: [ruleInput],
        }),
      ),
    ).toBe(message);
  });
});
