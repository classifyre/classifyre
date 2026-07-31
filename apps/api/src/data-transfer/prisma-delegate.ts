import { Prisma } from '@prisma/client';

import type { PrismaService } from '../prisma.service';

/**
 * The transfer services address models by name (from transfer-scopes.ts), which
 * Prisma's generated types cannot express — every delegate has a differently
 * typed `findMany`. This narrows the dynamic lookup to the handful of operations
 * a transfer actually performs, so the rest of the code stays type-checked and
 * the untyped surface is one file.
 */
export interface TransferDelegate {
  count(args?: unknown): Promise<number>;
  findMany(args?: unknown): Promise<unknown[]>;
  createMany(args: unknown): Promise<{ count: number }>;
  create(args: unknown): Promise<unknown>;
  upsert(args: unknown): Promise<unknown>;
}

export function modelDelegate(
  prisma: PrismaService,
  model: string,
): TransferDelegate {
  const delegate = (prisma as unknown as Record<string, unknown>)[model];
  if (!delegate || typeof delegate !== 'object') {
    throw new Error(
      `Unknown Prisma model '${model}' in the transfer scope registry`,
    );
  }
  return delegate as TransferDelegate;
}

/**
 * Scalar column names per model, read from the generated data model.
 *
 * Used to prune imported rows: an archive written by a different Classifyre
 * version can carry a column this instance does not have (or be missing one it
 * has), and Prisma rejects the whole batch on an unknown argument. Dropping
 * unrecognised columns lets an older archive import cleanly into a newer schema
 * instead of failing wholesale — the operator is told which columns were
 * dropped.
 */
const SCALAR_FIELDS = new Map<string, Set<string>>();

export function scalarFields(model: string): Set<string> {
  const cached = SCALAR_FIELDS.get(model);
  if (cached) return cached;

  const modelName = model.charAt(0).toUpperCase() + model.slice(1);
  const meta = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
  const fields = new Set(
    (meta?.fields ?? [])
      .filter((field) => field.kind !== 'object')
      .map((field) => field.name),
  );
  SCALAR_FIELDS.set(model, fields);
  return fields;
}

/** Every model name the generated client knows, for registry validation. */
export function knownModelNames(): Set<string> {
  return new Set(
    Prisma.dmmf.datamodel.models.map(
      (m) => m.name.charAt(0).toLowerCase() + m.name.slice(1),
    ),
  );
}
