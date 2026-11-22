import { posix } from 'node:path';

/**
 * Folders a Mounted Folder source may never point at (the same list as the
 * CLI's apps/cli/src/utils/local_roots.py, which checks again at every scan
 * and query): the system's view of the machine, temporary files of other
 * work, and the image's own state — /var/lib/classifyre holds the key that
 * decrypts every workspace's source credentials (re-review 2026-11-22).
 */
const CONTAINS_NOT = ['/tmp', '/var/tmp', '/dev/shm'];
const INSIDE_NOT = [
  '/proc',
  '/sys',
  '/dev',
  '/etc',
  '/run',
  '/var/run',
  '/root',
  '/var/lib/classifyre',
  '/var/lib/postgresql',
  '/app',
  '/opt',
  '/cache',
];

function within(path: string, root: string): boolean {
  return (
    path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)
  );
}

/** Why a source may not read this folder, or null when it may. */
export function localFolderRefusal(raw: string): string | null {
  const path = posix.normalize(raw.trim()).replace(/\/+$/, '') || '/';
  if (!path.startsWith('/')) return null; // the run refuses a relative path
  const refused = `The folder ${raw} cannot be a source`;
  if (CONTAINS_NOT.some((root) => within(root, path))) {
    return `${refused}: it holds temporary files of other work.`;
  }
  if (INSIDE_NOT.some((root) => within(path, root) || within(root, path))) {
    return `${refused}: it is part of the system or of Classifyre.`;
  }
  return null;
}
