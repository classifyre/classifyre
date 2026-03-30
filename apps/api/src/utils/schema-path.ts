import * as fs from 'fs';
import * as path from 'path';

const SCHEMAS_DIR_RELATIVE = path.join('packages', 'schemas', 'src', 'schemas');

function findSchemasDir(startDirs: string[]): string {
  const attemptedRoots: string[] = [];
  const visited = new Set<string>();

  for (const startDir of startDirs) {
    let current = path.resolve(startDir);

    while (!visited.has(current)) {
      visited.add(current);
      attemptedRoots.push(current);

      const candidate = path.join(current, SCHEMAS_DIR_RELATIVE);
      if (fs.existsSync(candidate)) {
        return candidate;
      }

      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  throw new Error(
    `Schemas directory not found. Looked for ${SCHEMAS_DIR_RELATIVE} from: ${attemptedRoots.join(', ')}`,
  );
}

export function resolveSchemasDir(fromDir: string): string {
  return findSchemasDir([fromDir, process.cwd()]);
}

export function resolveSchemaFile(fromDir: string, fileName: string): string {
  return path.join(resolveSchemasDir(fromDir), fileName);
}
