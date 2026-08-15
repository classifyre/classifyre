import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { CorrelationGraphResult } from './correlation.service';
import { CorrelationJobScheduler } from './correlation-job-scheduler.service';
import { CorrelationLockService } from './correlation-lock.service';

const SNAPSHOT_ID = 1;

type GraphBuilder = () => Promise<CorrelationGraphResult>;

/** PostgreSQL-backed last-good snapshot for the unscoped graph. */
@Injectable()
export class CorrelationGraphCacheService {
  private readonly logger = new Logger(CorrelationGraphCacheService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lock: CorrelationLockService,
    private readonly jobs: CorrelationJobScheduler,
  ) {}

  /**
   * The cached graph as raw JSON text, for handlers that only forward it.
   *
   * `getOrBuild` costs three full copies of the graph: Prisma parses the JSONB
   * column into a JS object tree, and the framework serializes that tree back
   * into a response body — with the driver's own text in between. On a real
   * corpus (58k nodes / 252k edges) the 25 MB stored payload expands to a
   * ~233 MB JSON string, and all three copies are live at once; that peak is
   * what exhausts the desktop API's heap, and it grows with every scan.
   *
   * Reading `payload::text` and writing it straight to the response leaves one
   * copy. It is still O(graph) — bounding that needs a scoped or paginated
   * graph, not a cheaper read — but it removes the multiplier.
   *
   * @returns the payload, or null when no snapshot has been published yet (the
   * caller should then fall back to {@link getOrBuild}, which builds one).
   */
  async readPayloadJson(): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        payload: string | null;
        built_version: bigint;
        requested_version: bigint;
      }>
    >(Prisma.sql`
      SELECT payload::text AS payload, built_version, requested_version
      FROM correlation_graph_snapshot
      WHERE id = ${SNAPSHOT_ID}
    `);

    const row = rows[0];
    if (!row?.payload) return null;
    // Same staleness contract as getOrBuild: serve the last-good snapshot now,
    // schedule the rebuild behind it.
    if (row.built_version < row.requested_version) {
      void this.jobs.scheduleGraphRefresh('stale graph read');
    }
    return row.payload;
  }

  async getOrBuild(builder: GraphBuilder): Promise<CorrelationGraphResult> {
    const snapshot = await this.prisma.correlationGraphSnapshot.findUnique({
      where: { id: SNAPSHOT_ID },
    });
    if (snapshot?.payload) {
      if (snapshot.builtVersion < snapshot.requestedVersion) {
        void this.jobs.scheduleGraphRefresh('stale graph read');
      }
      return snapshot.payload as unknown as CorrelationGraphResult;
    }

    // Only the first cold request pays the build cost. Other replicas wait on
    // the namespace lock, then re-read the row populated by the winner.
    return this.lock.runExclusive(async () => {
      const current = await this.ensureRow();
      if (current.payload) {
        return current.payload as unknown as CorrelationGraphResult;
      }
      return this.buildAndPublish(builder, current.requestedVersion);
    });
  }

  async invalidate(reason: string): Promise<void> {
    await this.prisma.correlationGraphSnapshot.upsert({
      where: { id: SNAPSHOT_ID },
      create: {
        id: SNAPSHOT_ID,
        requestedVersion: 1n,
        lastInvalidation: reason,
      },
      update: {
        requestedVersion: { increment: 1n },
        lastInvalidation: reason,
      },
    });
    await this.jobs.scheduleGraphRefresh(reason);
  }

  async refreshIfStale(builder: GraphBuilder): Promise<void> {
    await this.lock.runExclusive(async () => {
      const state = await this.ensureRow();
      if (state.payload && state.builtVersion >= state.requestedVersion) {
        return;
      }
      try {
        await this.buildAndPublish(builder, state.requestedVersion);
      } catch (error) {
        await this.recordError(error);
        throw error;
      }
    });
  }

  private async ensureRow() {
    return this.prisma.correlationGraphSnapshot.upsert({
      where: { id: SNAPSHOT_ID },
      create: { id: SNAPSHOT_ID },
      update: {},
    });
  }

  private async buildAndPublish(
    builder: GraphBuilder,
    version: bigint,
  ): Promise<CorrelationGraphResult> {
    const started = Date.now();
    const graph = await builder();

    // Serialize once, explicitly, and hand Postgres a string.
    //
    // Passing the object as `Prisma.InputJsonValue` makes the client walk and
    // serialize a structure of hundreds of thousands of nodes and edges inside
    // its own parameter encoding, which is where a publish on a large corpus
    // died with "CALL_AND_RETRY_LAST Allocation failed" — an allocation the
    // heap guard cannot pre-empt, because it is one request rather than a
    // gradual climb. One `JSON.stringify` we control is bounded, measurable,
    // and mirrors what readPayloadJson does in the other direction.
    const payload = JSON.stringify(graph);
    const payloadMb = Math.round(payload.length / (1024 * 1024));

    const published = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE correlation_graph_snapshot
      SET payload = ${payload}::jsonb,
          built_version = ${version},
          built_at = NOW(),
          build_duration_ms = ${Date.now() - started},
          last_error = NULL,
          updated_at = NOW()
      WHERE id = ${SNAPSHOT_ID} AND requested_version = ${version}
    `);

    if (published === 0) {
      // Something invalidated the graph while it was being assembled. Never
      // replace the last-good payload with a snapshot of that moving target.
      void this.jobs.scheduleGraphRefresh(
        'graph changed during snapshot build',
      );
      return graph;
    }
    // Payload size is logged because it is the quantity that decides whether
    // this survives: it grows with the corpus, every publish holds it in the
    // heap at once, and a JS string cannot exceed ~512 MB however much memory
    // the machine has. When this number starts reading in the hundreds, the
    // answer is a scoped or paginated graph, not a larger heap.
    this.logger.log(
      `Published correlation graph snapshot v${version.toString()} (${graph.nodes.length} nodes, ${graph.edges.length} edges, ${payloadMb} MB, ${Date.now() - started} ms)`,
    );
    return graph;
  }

  private async recordError(error: unknown): Promise<void> {
    await this.prisma.correlationGraphSnapshot.update({
      where: { id: SNAPSHOT_ID },
      data: {
        lastError: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
