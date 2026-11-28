import { Prisma } from '@prisma/client';

/**
 * A table file's columns are recorded when a scan processes it; the discovery
 * pass every run starts with sends the file without them, and a file the scan
 * cache skips is sent no other way. For an unchanged file they still hold.
 * (A changed one loses them until this run has read it.)
 */
export function keepFileColumns(
  incoming: Prisma.InputJsonValue,
  existing: Prisma.JsonValue | undefined,
): Prisma.InputJsonValue {
  const next = incoming as Record<string, unknown>;
  const prior = (existing ?? {}) as Record<string, unknown>;
  const sameFile =
    typeof next.object_key === 'string' && prior.object_key === next.object_key;
  if (!sameFile || next.columns || !Array.isArray(prior.columns)) {
    return incoming;
  }
  return { ...next, columns: prior.columns };
}
