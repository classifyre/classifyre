import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class EmbeddingCapabilityService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmbeddingCapabilityService.name);
  private vectorVersion?: string;
  private readinessProbe?: Promise<void>;

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureReady();
  }

  async ensureReady(): Promise<void> {
    if (this.vectorVersion) return;
    if (this.readinessProbe) return this.readinessProbe;
    const probe = this.probe();
    this.readinessProbe = probe;
    try {
      await probe;
    } catch (error) {
      if (this.readinessProbe === probe) this.readinessProbe = undefined;
      throw error;
    }
  }

  private async probe(): Promise<void> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        version: string | null;
        columnType: string | null;
        columnIsVector: boolean | null;
      }>
    >`
      SELECT
        (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS version,
        (
          SELECT format_type(attribute.atttypid, attribute.atttypmod)
          FROM pg_attribute attribute
          WHERE attribute.attrelid = to_regclass('content_embeddings')
            AND attribute.attname = 'vec'
            AND NOT attribute.attisdropped
        ) AS "columnType",
        (
          SELECT attribute.atttypid = vector_type.oid
          FROM pg_attribute attribute
          CROSS JOIN LATERAL (
            SELECT type.oid
            FROM pg_type type
            JOIN pg_extension extension
              ON extension.extname = 'vector'
             AND extension.extnamespace = type.typnamespace
            WHERE type.typname = 'vector'
          ) vector_type
          WHERE attribute.attrelid = to_regclass('content_embeddings')
            AND attribute.attname = 'vec'
            AND NOT attribute.attisdropped
        ) AS "columnIsVector"
    `;
    const result = rows[0];
    if (!result?.version) {
      throw new Error(
        'Classifyre cannot start because the PostgreSQL pgvector extension is not installed. Install the pgvector server package for this PostgreSQL version, connect as a database administrator, run `CREATE EXTENSION vector WITH SCHEMA public;`, and rerun the Classifyre migrations. Helm users should use the chart defaults (`pgvector/pgvector` for embedded PostgreSQL or the CloudNativePG `standard` image). External PostgreSQL must provide pgvector 0.8 or newer.',
      );
    }
    if (!result.columnIsVector) {
      throw new Error(
        `Classifyre detected pgvector ${result.version}, but content_embeddings.vec is missing or has the wrong type (${result.columnType ?? 'missing'}). The API normally applies pending migrations before this check; verify that DATABASE_URL points to the intended database and that the Prisma migration history is consistent with its schema.`,
      );
    }
    this.vectorVersion = result.version;
    this.logger.log(
      `pgvector ${result.version} ready: semantic queries use per-model HNSW indexes`,
    );
  }

  hasVector(): boolean {
    return this.vectorVersion !== undefined;
  }

  version(): string | undefined {
    return this.vectorVersion;
  }
}
