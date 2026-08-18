import { createPostgresScramVerifier, randomPassword } from './postgres-credentials.js';

/**
 * Optional read-only access to the embedded database.
 *
 * The app itself only ever needs the `classifyre` superuser, which stays on
 * loopback. This module adds a second login for the case the superuser cannot
 * serve: pointing a BI tool, a notebook or `psql` at the corpus without
 * handing it the credential that can also drop it.
 *
 * Because such a tool usually runs on a different machine, enabling the login
 * also opens the listener beyond loopback — so the pg_hba block below is not
 * decoration. It is the only thing standing between "read-only access from the
 * LAN" and "superuser access from the LAN", and it is written first so that
 * pg_hba's first-match-wins evaluation reaches it before initdb's own records.
 */
export const READONLY_ROLE = 'classifyre_readonly';

const HBA_BEGIN = '# >>> classifyre managed (read-only access) >>>';
const HBA_END = '# <<< classifyre managed <<<';

/** Schema names the app is willing to interpolate into SQL. */
const SAFE_IDENTIFIER = /^[a-z0-9_]+$/;

function managedHbaBlock(superuser: string): string {
  return [
    HBA_BEGIN,
    '# Written by Classifyre while read-only database access is enabled.',
    '# Removing this block by hand is safe; the app rewrites it on startup.',
    `host  all  ${superuser}  127.0.0.1/32  scram-sha-256`,
    `host  all  ${superuser}  ::1/128       scram-sha-256`,
    `host  all  ${READONLY_ROLE}  0.0.0.0/0  scram-sha-256`,
    `host  all  ${READONLY_ROLE}  ::/0       scram-sha-256`,
    '# Anything else arriving over TCP is refused, so opening the listener',
    '# cannot promote a non-loopback client to the superuser role.',
    'host  all  all  0.0.0.0/0  reject',
    'host  all  all  ::/0       reject',
    HBA_END,
  ].join('\n');
}

/**
 * Adds or removes the managed block in a pg_hba.conf.
 *
 * Idempotent in both directions: the block is identified by its markers and
 * replaced wholesale, so repeated startups converge rather than accumulate.
 */
export function applyManagedHba(
  contents: string,
  enabled: boolean,
  superuser: string,
): string {
  const begin = contents.indexOf(HBA_BEGIN);
  const end = contents.indexOf(HBA_END);
  let stripped = contents;
  if (begin >= 0 && end > begin) {
    const after = end + HBA_END.length;
    // Swallow the newline that terminated the block so removing it does not
    // leave a growing run of blank lines behind.
    const trailing = stripped.startsWith('\n', after) ? after + 1 : after;
    stripped = contents.slice(0, begin) + contents.slice(trailing);
  }
  if (!enabled) return stripped;
  return `${managedHbaBlock(superuser)}\n${stripped}`;
}

/** Address the server binds while read-only access is on/off. */
export function listenAddresses(readonlyEnabled: boolean): string {
  return readonlyEnabled ? '0.0.0.0' : '127.0.0.1';
}

/** Minimal shape of the `pg` client `embedded-postgres` hands out. */
export interface SqlClient {
  query: (sql: string) => Promise<{ rows: unknown[] }>;
}

function assertSafeIdentifier(name: string): void {
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new Error(`Refusing to use unsafe SQL identifier: ${name}`);
  }
}

/**
 * Statements that make one schema readable by the read-only role.
 *
 * ALTER DEFAULT PRIVILEGES covers tables a later migration adds; the explicit
 * GRANT covers the ones already there. Both are needed — neither is
 * retroactive on its own.
 */
export function schemaGrantStatements(schema: string): string[] {
  assertSafeIdentifier(schema);
  return [
    `GRANT USAGE ON SCHEMA "${schema}" TO "${READONLY_ROLE}"`,
    `GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO "${READONLY_ROLE}"`,
    `GRANT SELECT ON ALL SEQUENCES IN SCHEMA "${schema}" TO "${READONLY_ROLE}"`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT SELECT ON TABLES TO "${READONLY_ROLE}"`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT SELECT ON SEQUENCES TO "${READONLY_ROLE}"`,
  ];
}

async function listSchemas(client: SqlClient): Promise<string[]> {
  const result = await client.query(
    `SELECT nspname FROM pg_namespace
     WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'`,
  );
  return (result.rows as { nspname: string }[])
    .map((row) => row.nspname)
    .filter((name) => SAFE_IDENTIFIER.test(name));
}

async function roleExists(client: SqlClient): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM pg_roles WHERE rolname = '${READONLY_ROLE}'`,
  );
  return result.rows.length > 0;
}

/**
 * Sets the role's password from a SCRAM verifier, so the clear password never
 * appears in a statement (and therefore never in the server log). Mirrors the
 * guard PostgresManager.changePassword applies to the superuser.
 */
export function passwordClause(password: string): string {
  const verifier = createPostgresScramVerifier(password);
  if (
    !/^SCRAM-SHA-256\$\d+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(verifier)
  ) {
    throw new Error('Generated an invalid PostgreSQL SCRAM verifier');
  }
  return `PASSWORD '${verifier}'`;
}

/**
 * Creates (or updates) the read-only role and grants it SELECT across every
 * workspace schema. Safe to run on every startup.
 */
export async function ensureReadonlyRole(
  client: SqlClient,
  database: string,
  password: string,
): Promise<void> {
  assertSafeIdentifier(database);
  const clause = passwordClause(password);
  if (await roleExists(client)) {
    await client.query(`ALTER ROLE "${READONLY_ROLE}" WITH LOGIN ${clause}`);
  } else {
    await client.query(`CREATE ROLE "${READONLY_ROLE}" WITH LOGIN ${clause}`);
  }
  await client.query(`GRANT CONNECT ON DATABASE "${database}" TO "${READONLY_ROLE}"`);
  for (const schema of await listSchemas(client)) {
    for (const statement of schemaGrantStatements(schema)) {
      await client.query(statement);
    }
  }
}

/** Grants the read-only role access to a schema created after it existed. */
export async function grantSchemaToReadonlyRole(
  client: SqlClient,
  schema: string,
): Promise<void> {
  if (!(await roleExists(client))) return;
  for (const statement of schemaGrantStatements(schema)) {
    await client.query(statement);
  }
}

/**
 * Removes the role entirely. DROP OWNED BY is what releases the grants — a
 * role still referenced by a privilege cannot be dropped.
 */
export async function dropReadonlyRole(client: SqlClient): Promise<void> {
  if (!(await roleExists(client))) return;
  await client.query(`DROP OWNED BY "${READONLY_ROLE}" CASCADE`);
  await client.query(`DROP ROLE IF EXISTS "${READONLY_ROLE}"`);
}

/** A fresh read-only password. */
export { randomPassword as generateReadonlyPassword };
