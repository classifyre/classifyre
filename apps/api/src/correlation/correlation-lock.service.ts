import { createHash } from 'node:crypto';
import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Pool } from 'pg';
import { CLS_NAMESPACE_ID } from '../namespace/namespace.constants';
import {
  publicConnectionString,
  PUBLIC_SEARCH_PATH_OPTION,
} from '../registry/namespace-registry.sql';

/**
 * Namespace-scoped, session-level lock shared by every API/worker replica.
 * It serializes correlation writes and the rare cold snapshot build. PostgreSQL
 * releases the lock automatically if a pod or connection disappears.
 */
@Injectable()
export class CorrelationLockService implements OnApplicationShutdown {
  private readonly pool = new Pool({
    connectionString: publicConnectionString(),
    options: PUBLIC_SEARCH_PATH_OPTION,
    max: 4,
  });

  constructor(private readonly cls: ClsService) {}

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const namespaceId = this.cls.get<string>(CLS_NAMESPACE_ID);
    if (!namespaceId) {
      throw new Error('Correlation lock requires a namespace context.');
    }

    const lockKey = advisoryKey(namespaceId);
    const client = await this.pool.connect();
    let locked = false;
    try {
      await client.query('SELECT pg_advisory_lock($1::bigint)', [lockKey]);
      locked = true;
      return await operation();
    } finally {
      if (locked) {
        await client
          .query('SELECT pg_advisory_unlock($1::bigint)', [lockKey])
          .catch(() => undefined);
      }
      client.release();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

function advisoryKey(namespaceId: string): string {
  const bytes = createHash('sha256')
    .update('correlation:')
    .update(namespaceId)
    .digest();
  return bytes.readBigInt64BE(0).toString();
}
