/**
 * Validates that all i18n translation files have 1:1 key parity with en.json.
 *
 * Rules enforced:
 * - Every key in en.json must exist in the target language file.
 * - Every key in the target language file must exist in en.json (no extra keys).
 * - Keys must appear in the same order (same structure, no positional drift).
 * - Nested objects are validated recursively.
 */

import * as en from './en.json';
import * as de from './de.json';

type JsonObject = { [key: string]: JsonValue };
type JsonValue = string | JsonObject;

function collectPaths(obj: JsonObject, prefix = ''): string[] {
  const paths: string[] = [];
  for (const key of Object.keys(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (typeof value === 'object' && value !== null) {
      paths.push(...collectPaths(value, fullPath));
    } else {
      paths.push(fullPath);
    }
  }
  return paths;
}

function collectKeyOrder(
  obj: JsonObject,
  prefix = '',
): Array<[string, string[]]> {
  const result: Array<[string, string[]]> = [];
  const currentPath = prefix || '<root>';
  result.push([currentPath, Object.keys(obj)]);

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === 'object' && value !== null) {
      const childPath = prefix ? `${prefix}.${key}` : key;
      result.push(...collectKeyOrder(value, childPath));
    }
  }
  return result;
}

function runParityChecks(
  baseline: JsonObject,
  target: JsonObject,
  targetName: string,
): void {
  const baselinePaths = collectPaths(baseline);
  const targetPaths = collectPaths(target);

  const baselineSet = new Set(baselinePaths);
  const targetSet = new Set(targetPaths);

  const missingInTarget = baselinePaths.filter((p) => !targetSet.has(p));
  if (missingInTarget.length > 0) {
    throw new Error(
      `[${targetName}] Missing keys that exist in en.json:\n  ${missingInTarget.join('\n  ')}`,
    );
  }

  const extraInTarget = targetPaths.filter((p) => !baselineSet.has(p));
  if (extraInTarget.length > 0) {
    throw new Error(
      `[${targetName}] Extra keys not present in en.json:\n  ${extraInTarget.join('\n  ')}`,
    );
  }

  const baselineOrder = collectKeyOrder(baseline);
  const targetOrder = collectKeyOrder(target);

  for (const [path, baseKeys] of baselineOrder) {
    const targetEntry = targetOrder.find(([p]) => p === path);
    if (!targetEntry) {
      throw new Error(
        `[${targetName}] Object at path "${path}" is missing in target`,
      );
    }
    const targetKeys = targetEntry[1];
    const baseStr = baseKeys.join(',');
    const targetStr = targetKeys.join(',');
    if (baseStr !== targetStr) {
      throw new Error(
        `[${targetName}] Key order mismatch at "${path}":\n  en.json:   ${baseStr}\n  ${targetName}: ${targetStr}`,
      );
    }
  }
}

describe('i18n key parity', () => {
  it('de.json has identical keys and structure to en.json', () => {
    runParityChecks(
      en as unknown as JsonObject,
      de as unknown as JsonObject,
      'de.json',
    );
  });
});
