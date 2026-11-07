import { parseMove, UsageError } from './admin';

describe('workspaces move arguments', () => {
  it('moves named workspaces into a tenant', () => {
    expect(parseMove(['--to-tenant', 'acme', 'Finance', 'q3'])).toEqual({
      to: { tenant: 'acme' },
      slugs: ['finance', 'q3'],
      from: undefined,
      ownerGroupId: undefined,
    });
  });

  it('moves every workspace of a tenant back to local', () => {
    expect(parseMove(['--to-local', '--from', 'acme', '--all'])).toMatchObject({
      to: 'local',
      slugs: 'all',
      from: 'acme',
    });
  });

  it.each([
    [[], 'Say where to'],
    [['--to-tenant', 'acme'], 'Name the workspaces, or pass --all'],
    [['--to-tenant', 'acme', '--all', 'finance'], 'Name the workspaces'],
    [['--to-tenant', 'local', '--all'], 'Use --to-local'],
    [['--to-local', '--all'], '--to-local --all needs --from'],
    [['--to-tenant', 'acme', '--from', 'globex', '--all'], 'only from'],
    [['--to-local', '--owner-group', 'g1', 'finance'], 'no owner group'],
    [['--to-tenant', '--all'], '--to-tenant needs a value'],
    [['--to-tenant', 'acme', '--force', 'finance'], 'Unknown option'],
  ])('refuses %j', (args, message) => {
    expect(() => parseMove(args)).toThrow(UsageError);
    expect(() => parseMove(args)).toThrow(message);
  });
});
