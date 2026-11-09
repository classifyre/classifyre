import { Client } from 'pg';
import { from as copyFrom, to as copyTo } from 'pg-copy-streams';
import { pipeline } from 'node:stream/promises';
import { deployForSchema } from './database-migrations';

/**
 * Copies one workspace schema from one database to another (docs/prd/TEN
 * §4.9): the open database into a tenant's, or back. Postgres cannot move a
 * schema across databases, and the API image has no `pg_dump` for the server
 * version, so the tables are streamed with `COPY` in binary.
 *
 * Both sides are migrated to this version first, so the target has exactly
 * the source's tables. Foreign keys are dropped on the target during the copy
 * and added back after (which checks them), and user triggers are off so
 * rollups are not counted twice. Sequences take the source's values. The
 * pg-boss schema is not copied: queues and source schedules are made again
 * when the workspace's workers start; jobs queued in the source are not
 * carried over.
 *
 * The target schema must not exist yet; a failed copy drops it again. The
 * source is only read.
 */
export interface CopyResult {
  tables: number;
  rows: number;
}

const MIGRATIONS_TABLE = '_prisma_migrations';

function quoted(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function connect(url: string): Promise<Client> {
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

async function tablesOf(
  client: Client,
  schema: string,
): Promise<Array<{ table: string; columns: string[] }>> {
  const { rows } = await client.query<{ table: string; columns: string[] }>(
    `SELECT c.relname AS table,
            array_agg(a.attname::text ORDER BY a.attnum) AS columns
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = $1
        AND c.relkind IN ('r', 'p')
        AND NOT c.relispartition
        AND c.relname <> $2
        AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
      GROUP BY c.relname
      ORDER BY c.relname`,
    [schema, MIGRATIONS_TABLE],
  );
  return rows;
}

async function migrationsOf(client: Client, schema: string): Promise<string[]> {
  const { rows } = await client.query<{ migration_name: string }>(
    `SELECT migration_name FROM ${quoted(schema)}.${MIGRATIONS_TABLE}
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name`,
  );
  return rows.map((row) => row.migration_name);
}

async function count(client: Client, schema: string, table: string) {
  const { rows } = await client.query<{ count: string }>(
    `SELECT count(*) AS count FROM ${quoted(schema)}.${quoted(table)}`,
  );
  return Number(rows[0]?.count ?? 0);
}

export async function copyWorkspaceSchema(options: {
  /** The source's schema, and the target's (another name for a copy with a new id). */
  schema: string;
  targetSchema?: string;
  sourceUrl: string;
  targetUrl: string;
  log?: (message: string) => void;
}): Promise<CopyResult> {
  const { schema, sourceUrl, targetUrl } = options;
  const into = options.targetSchema ?? schema;
  const log = options.log ?? (() => undefined);

  const source = await connect(sourceUrl);
  const target = await connect(targetUrl);
  let created = false;
  try {
    const exists = await target.query(
      'SELECT 1 FROM pg_namespace WHERE nspname = $1',
      [into],
    );
    if (exists.rowCount) {
      throw new Error(
        `Schema ${into} already exists in the target database; nothing was copied.`,
      );
    }

    await deployForSchema(schema, sourceUrl);
    await target.query(`CREATE SCHEMA ${quoted(into)}`);
    created = true;
    await deployForSchema(into, targetUrl);
    const [fromVersion, toVersion] = await Promise.all([
      migrationsOf(source, schema),
      migrationsOf(target, into),
    ]);
    if (fromVersion.join() !== toVersion.join()) {
      throw new Error(
        `Schema ${schema} has other migrations in the source than this version makes; upgrade both sides first.`,
      );
    }

    const tables = await tablesOf(source, schema);
    const { rows: foreignKeys } = await target.query<{
      table: string;
      name: string;
      definition: string;
    }>(
      `SELECT cl.relname AS table, co.conname AS name,
              pg_get_constraintdef(co.oid) AS definition
         FROM pg_constraint co
         JOIN pg_class cl ON cl.oid = co.conrelid
         JOIN pg_namespace n ON n.oid = cl.relnamespace
        WHERE n.nspname = $1 AND co.contype = 'f'`,
      [into],
    );
    for (const fk of foreignKeys) {
      await target.query(
        `ALTER TABLE ${quoted(into)}.${quoted(fk.table)} DROP CONSTRAINT ${quoted(fk.name)}`,
      );
    }

    // Some migrations seed rows (singleton settings, rollup state); the copy
    // brings the source's own.
    if (tables.length) {
      await target.query(
        `TRUNCATE ${tables.map(({ table }) => `${quoted(into)}.${quoted(table)}`).join(', ')}`,
      );
    }

    let total = 0;
    for (const { table, columns } of tables) {
      const from = `${quoted(schema)}.${quoted(table)}`;
      const name = `${quoted(into)}.${quoted(table)}`;
      const list = columns.map(quoted).join(', ');
      await target.query(`ALTER TABLE ${name} DISABLE TRIGGER USER`);
      await pipeline(
        source.query(
          copyTo(
            `COPY (SELECT ${list} FROM ${from}) TO STDOUT (FORMAT binary)`,
          ),
        ),
        target.query(
          copyFrom(`COPY ${name} (${list}) FROM STDIN (FORMAT binary)`),
        ),
      );
      await target.query(`ALTER TABLE ${name} ENABLE TRIGGER USER`);
      const [copied, expected] = await Promise.all([
        count(target, into, table),
        count(source, schema, table),
      ]);
      if (copied !== expected) {
        throw new Error(
          `${into}.${table}: copied ${copied} of ${expected} rows; the source changed during the copy or the copy failed.`,
        );
      }
      total += copied;
      if (copied > 0) log(`  ${table}: ${copied} rows`);
    }

    for (const fk of foreignKeys) {
      await target.query(
        `ALTER TABLE ${quoted(into)}.${quoted(fk.table)} ADD CONSTRAINT ${quoted(fk.name)} ${fk.definition}`,
      );
    }

    const { rows: sequences } = await source.query<{ name: string }>(
      `SELECT sequencename AS name FROM pg_sequences WHERE schemaname = $1`,
      [schema],
    );
    for (const { name } of sequences) {
      const { rows } = await source.query<{
        last_value: string;
        is_called: boolean;
      }>(`SELECT last_value, is_called FROM ${quoted(schema)}.${quoted(name)}`);
      if (rows[0]) {
        await target.query('SELECT setval($1::regclass, $2, $3)', [
          `${quoted(into)}.${quoted(name)}`,
          rows[0].last_value,
          rows[0].is_called,
        ]);
      }
    }

    return { tables: tables.length, rows: total };
  } catch (error) {
    if (created) {
      await target
        .query(`DROP SCHEMA IF EXISTS ${quoted(into)} CASCADE`)
        .catch(() => undefined);
    }
    throw error;
  } finally {
    await Promise.all([
      source.end().catch(() => undefined),
      target.end().catch(() => undefined),
    ]);
  }
}
