import { localFolderRefusal } from './local-folder-path';

describe('localFolderRefusal', () => {
  it.each([
    '/',
    '/var/lib/classifyre',
    '/var/lib/classifyre/',
    '/var/lib',
    '/app/api',
    '/etc',
    '/tmp',
    '/data/../etc',
  ])('refuses %s', (path) => {
    expect(localFolderRefusal(path)).toMatch(/cannot be a source/);
  });

  it.each(['/data/case-files', '/mnt/corpora/smoke', '/tmp/pytest-of-ana/x'])(
    'accepts %s',
    (path) => {
      expect(localFolderRefusal(path)).toBeNull();
    },
  );

  it('refuses a query’s private directory and the folder holding a configured key', () => {
    expect(localFolderRefusal('/srv/x/classifyre-queries/q-1')).toMatch(
      /private directory/,
    );
    expect(
      localFolderRefusal('/srv/secrets', {
        CLASSIFYRE_KEY_FILE: '/srv/secrets/masked-config.key',
      }),
    ).toMatch(/holds Classifyre's keys/);
    expect(
      localFolderRefusal('/srv/data', {
        CLASSIFYRE_KEY_FILE: '/srv/secrets/masked-config.key',
      }),
    ).toBeNull();
  });
});
