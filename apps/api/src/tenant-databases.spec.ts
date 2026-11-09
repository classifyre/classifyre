import {
  controlDatabaseName,
  openDatabaseUrl,
  selectDatabaseForMode,
} from './database-mode';
import {
  forgetWorkspacesForTests,
  rememberWorkspace,
  tenantDatabaseName,
  tenantDatabasePassword,
  tenantDatabaseUrl,
  workspaceDatabaseUrl,
} from './tenant-databases';

const TENANT = '7f3a0c1e-2b4d-4e5f-8a9b-0c1d2e3f4a5b';
const OPEN = 'postgresql://owner:secret@db:5432/classifyre?sslmode=disable';

describe('databases per sign-in mode', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    forgetWorkspacesForTests();
  });

  it('keeps the configured database without sign-in', () => {
    const env: NodeJS.ProcessEnv = { DATABASE_URL: OPEN };
    selectDatabaseForMode(env);
    expect(env.DATABASE_URL).toBe(OPEN);
    expect(openDatabaseUrl(env)).toBe(OPEN);
  });

  it('switches to the control database with sign-in, and still knows the open one', () => {
    const env: NodeJS.ProcessEnv = { DATABASE_URL: OPEN, IAM_ENABLED: 'true' };
    selectDatabaseForMode(env);
    selectDatabaseForMode(env);
    expect(new URL(env.DATABASE_URL ?? '').pathname).toBe(
      '/classifyre_control',
    );
    expect(env.DATABASE_URL).toContain('sslmode=disable');
    expect(new URL(openDatabaseUrl(env) ?? '').pathname).toBe('/classifyre');
  });

  it('takes the control database name from the chart, and only a plain name', () => {
    expect(
      controlDatabaseName({ CLASSIFYRE_CONTROL_DATABASE: 'cfy_ctl' }),
    ).toBe('cfy_ctl');
    expect(() =>
      controlDatabaseName({ CLASSIFYRE_CONTROL_DATABASE: 'x"; DROP' }),
    ).toThrow(/lower-case Postgres name/);
  });

  it('names a tenant database after the tenant id, never its alias', () => {
    expect(tenantDatabaseName(TENANT)).toBe(
      'classifyre_t_7f3a0c1e2b4d4e5f8a9b0c1d2e3f4a5b',
    );
  });

  it('logs in to a tenant database as its own role, with a password from the key', () => {
    process.env.DATABASE_URL = withControl();
    process.env.CLASSIFYRE_TENANT_DATABASE_KEY = 'key-1';
    const url = new URL(tenantDatabaseUrl(TENANT));
    const name = tenantDatabaseName(TENANT);
    expect(url.pathname).toBe(`/${name}`);
    expect(url.username).toBe(name);
    expect(url.password).toBe(tenantDatabasePassword(name));
    expect(url.host).toBe('db:5432');
    const other = tenantDatabasePassword(name, {
      CLASSIFYRE_TENANT_DATABASE_KEY: 'key-2',
    });
    expect(other).not.toBe(url.password);
  });

  it('refuses tenant databases without the key', () => {
    process.env.DATABASE_URL = withControl();
    delete process.env.CLASSIFYRE_TENANT_DATABASE_KEY;
    expect(() => tenantDatabaseUrl(TENANT)).toThrow(
      /CLASSIFYRE_TENANT_DATABASE_KEY/,
    );
  });

  it('routes a workspace to the open database without sign-in', () => {
    process.env.DATABASE_URL = OPEN;
    delete process.env.IAM_ENABLED;
    expect(new URL(workspaceDatabaseUrl('ns_x')).pathname).toBe('/classifyre');
  });

  it('routes a workspace to its tenant database with sign-in, and never guesses', () => {
    process.env.DATABASE_URL = withControl();
    process.env.IAM_ENABLED = 'true';
    process.env.CLASSIFYRE_TENANT_DATABASE_KEY = 'key-1';
    expect(() => workspaceDatabaseUrl('ns_unknown')).toThrow(
      /No tenant is known/,
    );
    rememberWorkspace('ns_known', TENANT);
    expect(new URL(workspaceDatabaseUrl('ns_known')).pathname).toBe(
      `/${tenantDatabaseName(TENANT)}`,
    );
  });
});

function withControl(): string {
  const url = new URL(OPEN);
  url.pathname = '/classifyre_control';
  return url.toString();
}
