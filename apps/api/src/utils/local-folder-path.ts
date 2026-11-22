import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { posix } from 'node:path';
import { resolveSchemaFile } from './schema-path';

/**
 * Folders a Mounted Folder source may never point at: the one list in
 * packages/schemas/src/schemas/local_folder_denylist.json, which the CLI
 * (apps/cli/src/utils/local_roots.py) checks again at every scan and query,
 * against the mounted folders too. /var/lib/classifyre holds the key that
 * decrypts every workspace's source credentials (re-review 2026-11-22).
 */
interface Denylist {
  containsNot: string[];
  insideNot: string[];
  privateNames: string[];
  protectedPathEnv: string[];
}

let denylist: Denylist | undefined;

function loadDenylist(): Denylist {
  denylist ??= JSON.parse(
    fs.readFileSync(
      resolveSchemaFile(__dirname, 'local_folder_denylist.json'),
      'utf8',
    ),
  ) as Denylist;
  return denylist;
}

function normal(raw: string): string {
  return posix.normalize(raw.trim()).replace(/\/+$/, '') || '/';
}

function within(path: string, root: string): boolean {
  return (
    path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)
  );
}

/** Why a source may not read this folder, or null when it may. */
export function localFolderRefusal(
  raw: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const path = normal(raw);
  if (!path.startsWith('/')) return null; // the run refuses a relative path
  const deny = loadDenylist();
  const refused = `The folder ${raw} cannot be a source`;
  if (
    [...deny.containsNot, normal(tmpdir())].some((root) => within(root, path))
  ) {
    return `${refused}: it holds temporary files of other work.`;
  }
  if (deny.insideNot.some((root) => within(path, root) || within(root, path))) {
    return `${refused}: it is part of the system or of Classifyre.`;
  }
  if (
    path
      .split('/')
      .some((part) => deny.privateNames.some((name) => part.startsWith(name)))
  ) {
    return `${refused}: it is a query's private directory.`;
  }
  for (const name of deny.protectedPathEnv) {
    const named = env[name]?.trim();
    if (named && named.startsWith('/') && within(normal(named), path)) {
      return `${refused}: it holds Classifyre's keys (${name}).`;
    }
  }
  return null;
}
