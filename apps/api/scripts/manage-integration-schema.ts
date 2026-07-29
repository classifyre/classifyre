import { Client } from 'pg';

function normalizeSchemaKey(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

  const base = normalized.length > 0 ? normalized : 'default';
  const prefixed = `it_${base}`;
  const truncated = prefixed.slice(0, 63);

  if (/^[a-z_]/.test(truncated)) {
    return truncated;
  }

  return `it_${truncated}`.slice(0, 63);
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function withClient<T>(
  databaseUrl: string,
  handler: (client: Client) => Promise<T>,
): Promise<T> {
  const adminUrl = new URL(databaseUrl);
  adminUrl.searchParams.delete('schema');

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();

  try {
    return await handler(client);
  } finally {
    await client.end();
  }
}

async function main() {
  const command = process.argv[2];
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const schemaKey = process.env.INTEGRATION_TEST_SCHEMA_KEY?.trim();
  const explicitSchema = process.env.INTEGRATION_TEST_SCHEMA?.trim();

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const schema =
    explicitSchema || normalizeSchemaKey(schemaKey || process.env.USER || 'default');

  if (schema === 'public') {
    throw new Error('Refusing to manage the public schema');
  }

  if (command === 'prepare') {
    await withClient(databaseUrl, async (client) => {
      const quotedSchema = quoteIdentifier(schema);
      await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
      await client.query(`CREATE SCHEMA ${quotedSchema}`);
    });

    const testUrl = new URL(databaseUrl);
    testUrl.searchParams.set('schema', schema);

    process.stdout.write(`DATABASE_URL=${JSON.stringify(testUrl.toString())}\n`);
    process.stdout.write(`INTEGRATION_TEST_SCHEMA=${JSON.stringify(schema)}\n`);
    return;
  }

  if (command === 'cleanup') {
    await withClient(databaseUrl, async (client) => {
      // Namespace schemas first. The suite provisions a namespace per run, and
      // each one creates its own `ns_<uuid>` schema OUTSIDE the integration
      // schema — dropping only the integration schema takes the `namespaces`
      // registry row with it and orphans the tenant schema, so a shared CI
      // database accumulated one dead `ns_*` schema (55 tables) per run with
      // nothing left pointing at it. Read the registry before it is dropped.
      const { rows } = await client.query<{ schema_name: string }>(
        `SELECT n.schema_name
           FROM ${quoteIdentifier(schema)}.namespaces n
          WHERE n.type = 'local'`,
      ).catch(() => ({ rows: [] as Array<{ schema_name: string }> }));

      for (const row of rows) {
        // Belt and braces: only ever drop something that looks like a tenant
        // schema, never whatever a corrupted registry row happens to contain.
        if (!/^ns_[0-9a-f]{32}$/.test(row.schema_name)) continue;
        await client.query(
          `DROP SCHEMA IF EXISTS ${quoteIdentifier(row.schema_name)} CASCADE`,
        );
        // pg-boss keeps its own schema per namespace alongside the tenant one.
        await client.query(
          `DROP SCHEMA IF EXISTS ${quoteIdentifier(
            row.schema_name.replace(/^ns_/, 'pgboss_'),
          )} CASCADE`,
        );
      }

      await client.query(
        `DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`,
      );
    });
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
