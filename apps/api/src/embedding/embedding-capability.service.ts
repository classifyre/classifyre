import { Injectable, Logger, Optional } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma.service';
import { CLS_SCHEMA } from '../namespace/namespace.constants';

/**
 * Probes pgvector readiness. The extension lives in `public` (shared) but the
 * `content_embeddings.vec` column check runs against the current namespace's
 * schema, so readiness is cached per schema. There is no boot-time probe: it
 * runs lazily on first use within a namespace context (the embedding queue's
 * ensureRuntime), because no namespace exists at process startup.
 */
@Injectable()
export class EmbeddingCapabilityService {
  private readonly logger = new Logger(EmbeddingCapabilityService.name);
  private readonly vectorVersions = new Map<string, string>();
  private readonly readinessProbes = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly cls?: ClsService,
  ) {}

  private schemaKey(): string {
    return this.cls?.get<string>(CLS_SCHEMA) ?? '__default__';
  }

  async ensureReady(): Promise<void> {
    const key = this.schemaKey();
    if (this.vectorVersions.has(key)) return;
    const inFlight = this.readinessProbes.get(key);
    if (inFlight) return inFlight;
    const probe = this.probe(key);
    this.readinessProbes.set(key, probe);
    try {
      await probe;
    } catch (error) {
      if (this.readinessProbes.get(key) === probe)
        this.readinessProbes.delete(key);
      throw error;
    }
  }

  private async probe(key: string): Promise<void> {
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
    this.vectorVersions.set(key, result.version);
    this.logger.log(
      `pgvector ${result.version} ready: semantic queries use per-model HNSW indexes`,
    );
  }

  hasVector(): boolean {
    return this.vectorVersions.has(this.schemaKey());
  }

  version(): string | undefined {
    return this.vectorVersions.get(this.schemaKey());
  }
}
