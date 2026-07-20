import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';

type PgBossModule = typeof import('pg-boss');
type PgBossInstance = InstanceType<PgBossModule['PgBoss']>;

/**
 * Derive the pg-boss schema for this deployment from DATABASE_URL.
 *
 * Namespaces are isolated as Postgres schemas via the Prisma-only `?schema=`
 * URL param. pg-boss never reads that param and defaults to one shared
 * `pgboss` schema, so every namespace on the same physical database would
 * share a single job table — letting one namespace's worker dequeue and
 * execute another namespace's jobs (observed as autopilot agent cycles
 * leaking across namespaces). Give each namespace its own pg-boss schema.
 */
export function pgBossSchemaForDatabaseUrl(
  databaseUrl: string | undefined,
): string | undefined {
  if (!databaseUrl) return undefined;
  let namespace: string | null;
  try {
    namespace = new URL(databaseUrl).searchParams.get('schema');
  } catch {
    return undefined;
  }
  if (!namespace) return undefined;
  // pg-boss requires a plain identifier (letters/digits/underscore, <= 50
  // chars). Sanitize rather than fail so a scan can never be blocked by an
  // exotic namespace name.
  const sanitized = namespace.replace(/[^a-zA-Z0-9_]/g, '_');
  return `pgboss_${sanitized}`.slice(0, 50);
}

@Injectable()
export class PgBossService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PgBossService.name);
  private boss: PgBossInstance | null = null;

  private async ensureBoss(): Promise<PgBossInstance> {
    if (this.boss) {
      return this.boss;
    }

    const { PgBoss } = await import('pg-boss');
    const schema = pgBossSchemaForDatabaseUrl(process.env.DATABASE_URL);
    const boss = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      ...(schema ? { schema } : {}),
    });

    boss.on('error', (error) => {
      this.logger.error('pg-boss error:', error);
    });

    this.boss = boss;
    return boss;
  }

  async onApplicationBootstrap(): Promise<void> {
    const boss = await this.ensureBoss();
    await boss.start();
    this.logger.log('pg-boss started');
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.boss) {
      return;
    }

    await this.boss.stop({ graceful: true, timeout: 10_000 });
    this.boss = null;
    this.logger.log('pg-boss stopped');
  }

  async getBossAsync(): Promise<PgBossInstance> {
    return this.ensureBoss();
  }

  getBoss(): PgBossInstance {
    if (!this.boss) {
      throw new Error('pg-boss is not initialized yet');
    }
    return this.boss;
  }
}
