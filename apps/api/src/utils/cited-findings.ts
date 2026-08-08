import type { PrismaService } from '../prisma.service';

/**
 * Which findings an investigation cites, scoped to one source where possible.
 *
 * `CaseFinding.findingId` is a plain string with no foreign key, so Prisma
 * cannot join it to `Finding` — every caller that needed "is this finding cited
 * by a case?" therefore read the whole `case_findings` table and intersected in
 * memory. Correct, and fine at seventeen rows; on an instance with hundreds of
 * sources it is a full table scan per source, on paths that run per scan, per
 * config read and per detector-value query.
 *
 * Scoping the read to the source in SQL keeps that work proportional to the
 * source rather than to the instance. Ids are `text` columns, not `uuid` — no
 * casts.
 */
export async function citedFindingIds(
  prisma: PrismaService,
  sourceId: string | null,
): Promise<Set<string>> {
  const rows = sourceId
    ? await prisma.$queryRaw<Array<{ findingId: string }>>`
        SELECT cf.finding_id AS "findingId"
        FROM case_findings cf
        JOIN findings f ON f.id = cf.finding_id
        WHERE f.source_id = ${sourceId}
      `
    : // Instance-wide scope: no narrower query exists, but case_findings holds
      // curated evidence a person or agent attached one at a time, so it stays
      // small even on a large corpus.
      await prisma.$queryRaw<Array<{ findingId: string }>>`
        SELECT finding_id AS "findingId" FROM case_findings
      `;
  return new Set(rows.map((row) => row.findingId));
}
