import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma.service';

/**
 * Run `fn` in a transaction with a local statement timeout, so a preview or a
 * rollup query on a large corpus fails fast instead of holding a connection.
 */
export async function withStatementTimeout<T>(
  prisma: PrismaService,
  ms: number,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT set_config('statement_timeout', ${String(Math.max(Math.trunc(ms), 1))}, true)`,
      );
      return fn(tx);
    },
    { timeout: ms + 5_000, maxWait: 10_000 },
  );
}

/** Whether an error is a Postgres statement timeout (57014). */
export function isStatementTimeout(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes('57014') || /statement timeout/i.test(text);
}

/** A short, display-safe excerpt of matched content. */
export function excerpt(value: string | null | undefined, max = 160): string {
  if (!value) return '';
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
