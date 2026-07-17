/**
 * Re-run evidence analysis + neighbourhood calibration for a whole embedding
 * space against the database in DATABASE_URL. Operator/calibration entry
 * point; the API schedules the same pass automatically when the inference
 * queue drains.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... bun scripts/recalibrate-embeddings.ts [spaceId]
 */
import { PrismaService } from '../src/prisma.service';
import { EmbeddingAnalysisService } from '../src/embedding/embedding-analysis.service';
import { EmbeddingService } from '../src/embedding/embedding.service';

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const spaceId =
      process.argv[2] ??
      (
        await prisma.embeddingSpace.findFirst({
          where: { isActive: true },
          select: { id: true },
        })
      )?.id;
    if (!spaceId) {
      throw new Error('No active embedding space found; pass a spaceId');
    }
    const analysis = new EmbeddingAnalysisService(prisma);
    const capability = {
      ensureReady: () => Promise.resolve(undefined),
      hasVector: () => true,
      version: () => 'external',
    };
    const embeddings = new EmbeddingService(
      prisma,
      capability as never,
      analysis,
    );
    const started = Date.now();
    const { analyzed } = await embeddings.recalibrateSpace(spaceId);
    console.log(
      `Recalibrated ${analyzed} findings in space ${spaceId} in ${Math.round(
        (Date.now() - started) / 1000,
      )}s`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
