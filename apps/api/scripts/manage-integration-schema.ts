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
