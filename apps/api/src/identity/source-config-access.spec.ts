import { SourceConfigAccess, withoutConfig } from './source-config-access';
import type { Actor } from './actor';

const source = {
  id: 's1',
  name: 'Shop db',
  type: 'POSTGRESQL',
  config: {
    type: 'POSTGRESQL',
    required: { host: 'db.example.test', port: 5432 },
    masked: { username: 'reader' },
    sampling: { strategy: 'AUTOMATIC' },
  },
  lastRunAt: new Date('2026-11-11T10:00:00Z'),
};

describe('withoutConfig', () => {
  it('keeps what a source is, never how it is set up', () => {
    expect(withoutConfig(source)).toEqual({
      ...source,
      config: { type: 'POSTGRESQL' },
    });
  });

  it('reaches sources in lists, search pages and runs', () => {
    const page = { items: [{ ...source, latestRunner: { recipe: { a: 1 } } }] };
    expect(withoutConfig(page)).toEqual({
      items: [
        {
          ...source,
          config: { type: 'POSTGRESQL' },
          latestRunner: { recipe: null },
        },
      ],
    });
    expect(withoutConfig([{ id: 'r1', recipe: source.config }])).toEqual([
      { id: 'r1', recipe: null },
    ]);
  });

  it('leaves dates and binary bodies alone', () => {
    const buffer = Buffer.from('x');
    expect(withoutConfig(buffer)).toBe(buffer);
    expect(withoutConfig({ at: source.lastRunAt }).at).toBe(source.lastRunAt);
  });
});

describe('SourceConfigAccess', () => {
  const person: Actor = {
    id: 'u1',
    displayName: 'Ada',
    kind: 'person',
    via: 'oidc',
    ref: 'user:u1',
  };
  const visitor: Actor = {
    id: null,
    displayName: null,
    kind: 'visitor',
    via: 'none',
  };
  const job: Actor = {
    id: null,
    displayName: null,
    kind: 'system',
    via: 'internal-key',
  };

  const access = (manage: boolean, actor: Actor) =>
    new SourceConfigAccess({ current: () => actor } as never, {
      check: () => ({ allow: manage }),
      capabilities: () => new Set(),
    });

  it('shows the configuration to people who can change sources', async () => {
    expect(await access(true, person).forCaller(source)).toBe(source);
  });

  it('hides it from viewers and visitors', async () => {
    expect((await access(false, person).forCaller(source)).config).toEqual({
      type: 'POSTGRESQL',
    });
    expect((await access(false, visitor).forCaller(source)).config).toEqual({
      type: 'POSTGRESQL',
    });
  });

  it('never from scan jobs with the internal key', async () => {
    expect(await access(false, job).forCaller(source)).toBe(source);
  });
});
