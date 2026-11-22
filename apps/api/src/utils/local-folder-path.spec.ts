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
});
