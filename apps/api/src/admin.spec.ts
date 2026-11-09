import { parseCopy, parseSplit, UsageError } from './admin';

describe('workspaces copy arguments', () => {
  it('copies named workspaces into a tenant', () => {
    expect(parseCopy(['--to-tenant', 'acme', 'Finance', 'q3'])).toEqual({
      to: { tenant: 'acme' },
      slugs: ['finance', 'q3'],
      ownerGroupId: undefined,
    });
  });

  it('copies every workspace made without sign-in into a tenant', () => {
    expect(parseCopy(['--to-tenant', 'acme', '--all'])).toMatchObject({
      to: { tenant: 'acme' },
      slugs: 'all',
    });
  });

  it('copies named tenant workspaces to the open database', () => {
    expect(parseCopy(['--to-local', 'finance'])).toMatchObject({
      to: 'local',
      slugs: ['finance'],
    });
  });

  it.each([
    [[], 'Say where to'],
    [['--to-tenant', 'acme'], 'Name the workspaces, or pass --all'],
    [['--to-tenant', 'acme', '--all', 'finance'], 'Name the workspaces'],
    [['--to-tenant', 'local', '--all'], 'Use --to-local'],
    [['--to-local', '--all'], 'named workspaces only'],
    [['--to-local', '--owner-group', 'g1', 'finance'], 'no owner group'],
    [['--to-tenant', '--all'], '--to-tenant needs a value'],
    [['--to-tenant', 'acme', '--force', 'finance'], 'Unknown option'],
  ])('refuses %j', (args, message) => {
    expect(() => parseCopy(args)).toThrow(UsageError);
    expect(() => parseCopy(args)).toThrow(message);
  });
});

describe('tenants split arguments', () => {
  it('removes the copied originals unless told to keep them', () => {
    expect(parseSplit([])).toEqual({ keepSource: false });
    expect(parseSplit(['--keep-source'])).toEqual({ keepSource: true });
    expect(() => parseSplit(['--all'])).toThrow(UsageError);
  });
});
