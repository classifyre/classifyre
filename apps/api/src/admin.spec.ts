import { parseCopy, parseCreate, parsePublish, UsageError } from './admin';

describe('workspaces copy arguments', () => {
  it('copies named workspaces into a tenant', () => {
    expect(parseCopy(['--to-tenant', 'acme', 'Finance', 'q3'])).toEqual({
      tenant: 'acme',
      slugs: ['finance', 'q3'],
      ownerGroupId: undefined,
    });
  });

  it('copies every workspace made without sign-in into a tenant', () => {
    expect(parseCopy(['--to-tenant', 'acme', '--all'])).toMatchObject({
      tenant: 'acme',
      slugs: 'all',
    });
  });

  it.each([
    [[], 'Say where to'],
    [['--to-local', 'finance'], 'Unknown option'],
    [['--to-tenant', 'acme'], 'Name the workspaces, or pass --all'],
    [['--to-tenant', 'acme', '--all', 'finance'], 'Name the workspaces'],
    [['--to-tenant', '--all'], '--to-tenant needs a value'],
    [['--to-tenant', 'acme', '--force', 'finance'], 'Unknown option'],
  ])('refuses %j', (args, message) => {
    expect(() => parseCopy(args)).toThrow(UsageError);
    expect(() => parseCopy(args)).toThrow(message);
  });
});

describe('workspaces create arguments', () => {
  it('names the workspace after its slug unless told', () => {
    expect(parseCreate(['--tenant', 'default', '--slug', 'Demo'])).toEqual({
      tenant: 'default',
      slug: 'demo',
      name: 'demo',
      ownerGroupId: undefined,
    });
    expect(
      parseCreate([
        '--tenant',
        'default',
        '--slug',
        'demo',
        '--name',
        'Demo',
        '--owner-group',
        'g1',
      ]),
    ).toMatchObject({ name: 'Demo', ownerGroupId: 'g1' });
  });

  it.each([
    [['--slug', 'demo'], 'needs --tenant and --slug'],
    [['--tenant', 'default'], 'needs --tenant and --slug'],
    [['--tenant'], '--tenant needs a value'],
    [['--tenant', 'default', '--slug', 'demo', '--all'], 'Unknown option'],
  ])('refuses %j', (args, message) => {
    expect(() => parseCreate(args)).toThrow(UsageError);
    expect(() => parseCreate(args)).toThrow(message);
  });
});

describe('workspaces publish arguments', () => {
  it('publishes named workspaces, every one, or makes them private', () => {
    expect(parsePublish(['--tenant', 'showcase', 'Nova'])).toEqual({
      tenant: 'showcase',
      slugs: ['nova'],
      off: false,
    });
    expect(parsePublish(['--tenant', 'showcase', '--all', '--off'])).toEqual({
      tenant: 'showcase',
      slugs: 'all',
      off: true,
    });
  });

  it.each([
    [['--all'], 'needs --tenant'],
    [['--tenant', 'showcase'], 'Name the workspaces'],
    [['--tenant', 'showcase', '--all', 'nova'], 'Name the workspaces'],
    [['--tenant', 'showcase', '--force'], 'Unknown option'],
  ])('refuses %j', (args, message) => {
    expect(() => parsePublish(args)).toThrow(message);
  });
});
