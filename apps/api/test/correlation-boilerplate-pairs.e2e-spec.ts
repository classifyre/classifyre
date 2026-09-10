import { Prisma } from '@prisma/client';
import { CorrelationReviewIndexService } from '../src/correlation/review/correlation-review-index.service';
import { createTestApp, TestApp } from './create-test-app';

// 2026-09-10: one 43k-member boilerplate group projected ~920M pairs. The
// pairs CTE self-joins the whole group and the window sort materialises every
// row before BOILERPLATE_PAIR_CAP trims the output, so the spill hit 142GB of
// pgsql_tmp and took the node down with DiskPressure. The projection must stay
// bounded no matter the group size while keeping identical output for groups
// that were never a problem.
describe('Correlation boilerplate pair projection (e2e)', () => {
  let ctx: TestApp;

  // Oversized enough that the old code cannot finish: 20k members project
  // 200M pairs (tens of GB of sort spill, minutes of runtime). The fixed code
  // pre-caps each group to 1,000 ranked assets, so at most 500k pairs.
  const GIANT_MEMBERS = 20000;
  const SMALL_MEMBERS = 5;
  const GIANT_GH = '9'.repeat(64);
  const SMALL_GH = 'a'.repeat(64);
  // 2GB separates the two regimes by an order of magnitude: the fixed query
  // spills tens of MB, the old one tens of GB.
  const MAX_TEMP_BYTES = 2 * 1024 * 1024 * 1024;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 180000);

  afterAll(async () => {
    await ctx.close();
  });

  it('finishes fast on an oversized group, caps output, keeps small groups intact', async () => {
    if (ctx.isRemote || !ctx.prisma) return;
    const prisma = ctx.prisma;
    const total = GIANT_MEMBERS + SMALL_MEMBERS;

    // Self-cleaning: the schema survives across reruns, and leftover seed rows
    // would change the group sizes the assertions below depend on.
    await prisma.$executeRaw(
      Prisma.sql`TRUNCATE TABLE sources, embedding_spaces CASCADE`,
    );

    const [source] = await prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`INSERT INTO sources (id, name, type, config, updated_at)
                 VALUES (gen_random_uuid(), 'bp-pairs-test', 'JIRA', '{}', now())
                 RETURNING id`,
    );
    const [space] = await prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`INSERT INTO embedding_spaces (id, provider, model, revision, dim, pooling, normalized)
                 VALUES (gen_random_uuid(), 'test', 'test', 't', 384, 'mean', true)
                 RETURNING id`,
    );
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO assets (id, hash, checksum, name, external_url, asset_type, source_type, source_id, updated_at)
      SELECT gen_random_uuid(), 'h' || g, 'c' || g, 'asset-' || g, 'http://example/' || g,
             'file', 'JIRA', ${source.id}, now()
      FROM generate_series(1, ${total}) g`);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO findings (id, detection_identity, asset_id, source_id, detector_type,
                            finding_type, category, severity, confidence,
                            matched_content, detected_at, updated_at)
      SELECT gen_random_uuid(), 'bp-' || g, a.id, ${source.id}, 'SECRETS',
             'BOILERPLATE', 'test', 'LOW', 0.5,
             'x', now(), now()
      FROM (SELECT id, row_number() OVER () AS rn FROM assets
            WHERE source_id = ${source.id}) a
      JOIN generate_series(1, ${total}) g ON g = a.rn`);
    // Distinct importance per row so the per-group ranking is deterministic.
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO finding_evidence_analyses (finding_id, space_id, importance_score,
                                             duplicate_group_hash, updated_at)
      SELECT f.id, ${space.id},
             CASE WHEN g <= ${SMALL_MEMBERS}
                  THEN 100000 - g ELSE ${total} - g END,
             CASE WHEN g <= ${SMALL_MEMBERS} THEN ${SMALL_GH} ELSE ${GIANT_GH} END,
             now()
      FROM (SELECT id, row_number() OVER () AS rn FROM findings
            WHERE source_id = ${source.id}) f
      JOIN generate_series(1, ${total}) g ON g = f.rn`);

    const tempBefore = await tempBytes(prisma);
    await ctx
      .get(CorrelationReviewIndexService)
      .refresh({ labelWeights: {}, defaultWeight: 0 });
    const tempAfter = await tempBytes(prisma);
    expect(tempAfter - tempBefore).toBeLessThan(MAX_TEMP_BYTES);

    const rows = await prisma.$queryRaw<{ pattern: string; count: bigint }[]>(
      Prisma.sql`SELECT pattern_key AS pattern, COUNT(*)::bigint AS count
                 FROM correlation_pair_signatures
                 WHERE family = 'NEAR_DUPLICATE_TEXT'
                 GROUP BY pattern_key`,
    );
    const byPattern = new Map(rows.map((r) => [r.pattern, Number(r.count)]));
    // Oversized group: output capped, never the 200M-pair explosion.
    expect(byPattern.get(`boilerplate:${GIANT_GH.slice(0, 8)}`)).toBe(200);
    // Small group: every pair survives, exactly as before the fix.
    expect(byPattern.get(`boilerplate:${SMALL_GH.slice(0, 8)}`)).toBe(
      (SMALL_MEMBERS * (SMALL_MEMBERS - 1)) / 2,
    );
  }, 180000);

  it('incremental refresh rewrites only touched groups and leaves the rest alone', async () => {
    if (ctx.isRemote || !ctx.prisma) return;
    const prisma = ctx.prisma;
    const smallPattern = `boilerplate:${SMALL_GH.slice(0, 8)}`;

    const smallAssets = await prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT DISTINCT f.asset_id AS id
                 FROM finding_evidence_analyses a
                 JOIN findings f ON f.id = a.finding_id
                 WHERE a.duplicate_group_hash = ${SMALL_GH}`,
    );
    expect(smallAssets).toHaveLength(SMALL_MEMBERS);

    // Simulate drift: drop the small group's pairs and remember the giant
    // group's watermark. An incremental refresh must restore exactly the
    // touched group and not rewrite anything else.
    await prisma.$executeRaw(
      Prisma.sql`DELETE FROM correlation_pair_signatures
                 WHERE pattern_key = ${smallPattern}`,
    );
    const [before] = await prisma.$queryRaw<{ max: Date | null }[]>(
      Prisma.sql`SELECT MAX(computed_at) AS max
                 FROM correlation_pair_signatures
                 WHERE pattern_key = ${`boilerplate:${GIANT_GH.slice(0, 8)}`}`,
    );

    await ctx.get(CorrelationReviewIndexService).refresh({
      labelWeights: {},
      defaultWeight: 0,
      touchedAssetIds: smallAssets.map((a) => a.id),
    });

    const rows = await prisma.$queryRaw<{ pattern: string; count: bigint }[]>(
      Prisma.sql`SELECT pattern_key AS pattern, COUNT(*)::bigint AS count
                 FROM correlation_pair_signatures
                 WHERE family = 'NEAR_DUPLICATE_TEXT'
                 GROUP BY pattern_key`,
    );
    const byPattern = new Map(rows.map((r) => [r.pattern, Number(r.count)]));
    expect(byPattern.get(smallPattern)).toBe(
      (SMALL_MEMBERS * (SMALL_MEMBERS - 1)) / 2,
    );
    expect(byPattern.get(`boilerplate:${GIANT_GH.slice(0, 8)}`)).toBe(200);
    const [after] = await prisma.$queryRaw<{ max: Date | null }[]>(
      Prisma.sql`SELECT MAX(computed_at) AS max
                 FROM correlation_pair_signatures
                 WHERE pattern_key = ${`boilerplate:${GIANT_GH.slice(0, 8)}`}`,
    );
    expect(after.max?.getTime()).toBe(before.max?.getTime());
  }, 180000);
});

async function tempBytes(
  prisma: NonNullable<TestApp['prisma']>,
): Promise<number> {
  const [row] = await prisma.$queryRaw<{ temp_bytes: bigint }[]>(
    Prisma.sql`SELECT temp_bytes FROM pg_stat_database
               WHERE datname = current_database()`,
  );
  return Number(row.temp_bytes);
}
