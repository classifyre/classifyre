/**
 * The read-only database login and, more importantly, the access rules that
 * come with it.
 *
 * Enabling this setting opens the embedded PostgreSQL port beyond loopback,
 * which is only defensible because the managed pg_hba block refuses every
 * non-loopback role except the read-only one. If that block is wrong — absent,
 * ordered after initdb's own records, or written twice — the setting stops
 * being "share the data" and becomes "share the superuser". So the block is
 * asserted directly rather than through anything that needs a live cluster.
 *
 * Run with Node 22:
 *   npx tsx test/postgres-readonly.test.ts
 */

import assert from "node:assert/strict";
import {
  applyManagedHba,
  dropReadonlyRole,
  ensureReadonlyRole,
  generateReadonlyPassword,
  grantSchemaToReadonlyRole,
  listenAddresses,
  READONLY_ROLE,
  schemaGrantStatements,
  type SqlClient,
} from "../src/main/postgres-readonly";

const INITDB_HBA = [
  "# TYPE  DATABASE        USER            ADDRESS                 METHOD",
  "local   all             all                                     trust",
  "host    all             all             127.0.0.1/32            scram-sha-256",
  "host    all             all             ::1/128                 scram-sha-256",
  "",
].join("\n");

/** Records the block applies, in order, ignoring comments and blank lines. */
function records(hba: string): string[] {
  return hba
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

class FakeClient implements SqlClient {
  readonly statements: string[] = [];
  constructor(private readonly rows: Record<string, unknown[]> = {}) {}

  async query(sql: string): Promise<{ rows: unknown[] }> {
    this.statements.push(sql.replace(/\s+/g, " ").trim());
    for (const [needle, rows] of Object.entries(this.rows)) {
      if (sql.includes(needle)) return { rows };
    }
    return { rows: [] };
  }
}

async function main(): Promise<void> {
  // --- listener ----------------------------------------------------------
  assert.equal(listenAddresses(false), "127.0.0.1");
  assert.equal(listenAddresses(true), "0.0.0.0");

  // --- pg_hba block ------------------------------------------------------
  const enabled = applyManagedHba(INITDB_HBA, true, "classifyre");
  const lines = records(enabled);

  // First-match-wins: every managed record must precede initdb's own, or
  // initdb's `host all all 127.0.0.1/32` would answer first and the reject
  // rules would never be reached.
  const managedCount = lines.findIndex((line) => line.startsWith("local"));
  assert.ok(managedCount > 0, "the managed block must come first");

  const managed = lines.slice(0, managedCount);
  // The superuser is reachable on loopback only...
  const superuserRecords = managed.filter((line) => / classifyre /.test(line));
  assert.deepEqual(
    superuserRecords.map((line) => line.split(/\s+/)[3]),
    ["127.0.0.1/32", "::1/128"],
  );
  // ...the read-only role from anywhere...
  const readonlyRecords = managed.filter((line) => line.includes(READONLY_ROLE));
  assert.deepEqual(
    readonlyRecords.map((line) => line.split(/\s+/)[3]),
    ["0.0.0.0/0", "::/0"],
  );
  assert.ok(readonlyRecords.every((line) => line.endsWith("scram-sha-256")));
  // ...and everything else over TCP is refused, on both address families.
  const rejects = managed.filter((line) => line.endsWith("reject"));
  assert.deepEqual(
    rejects.map((line) => line.split(/\s+/)[3]),
    ["0.0.0.0/0", "::/0"],
  );
  // No managed record may hand a non-loopback client anything but the
  // read-only role. This is the invariant the whole feature rests on.
  for (const record of managed) {
    const [, , user, address] = record.split(/\s+/);
    const loopback = address === "127.0.0.1/32" || address === "::1/128";
    assert.ok(
      loopback || user === READONLY_ROLE || record.endsWith("reject"),
      `non-loopback record grants ${user}: ${record}`,
    );
  }

  // Idempotent: repeated startups converge rather than accumulate.
  assert.equal(applyManagedHba(enabled, true, "classifyre"), enabled);
  // And removable: turning the setting off restores the original file.
  assert.equal(applyManagedHba(enabled, false, "classifyre"), INITDB_HBA);
  assert.equal(applyManagedHba(INITDB_HBA, false, "classifyre"), INITDB_HBA);

  // --- grants ------------------------------------------------------------
  const grants = schemaGrantStatements("ns_deadbeef");
  // SELECT on existing tables and a default privilege for future ones: neither
  // is retroactive on its own, so a migration run after this would otherwise
  // add tables the login cannot see.
  assert.ok(grants.some((s) => s.startsWith("GRANT USAGE ON SCHEMA")));
  assert.ok(grants.some((s) => s.includes("GRANT SELECT ON ALL TABLES")));
  assert.ok(grants.some((s) => s.startsWith("ALTER DEFAULT PRIVILEGES")));
  // Nothing in the set may grant a write.
  for (const statement of grants) {
    assert.ok(
      !/(INSERT|UPDATE|DELETE|TRUNCATE|ALL PRIVILEGES)/.test(statement),
      `read-only grant is not read-only: ${statement}`,
    );
  }
  // Schema names are interpolated, so anything unexpected must be refused.
  for (const bad of ['ns"; DROP SCHEMA public', "NS_Upper", "ns-1"]) {
    assert.throws(() => schemaGrantStatements(bad), /unsafe SQL identifier/);
  }

  // --- role provisioning -------------------------------------------------
  const password = generateReadonlyPassword();
  assert.ok(password.length >= 32, "read-only password must be long");

  const fresh = new FakeClient({ "FROM pg_namespace": [{ nspname: "ns_beef" }] });
  await ensureReadonlyRole(fresh, "classifyre", password);
  {
    assert.ok(fresh.statements.some((s) => s.startsWith("CREATE ROLE")));
    // The clear password must never enter a statement: PostgreSQL logs DDL,
    // so it would end up in the app's own log file.
    for (const statement of fresh.statements) {
      assert.ok(!statement.includes(password), "clear password reached SQL");
    }
    assert.ok(
      fresh.statements.some((s) => s.includes("SCRAM-SHA-256$4096:")),
      "expected a SCRAM verifier",
    );
    assert.ok(fresh.statements.some((s) => s.includes('GRANT CONNECT ON DATABASE')));
    assert.ok(fresh.statements.some((s) => s.includes('"ns_beef"')));
  }

  const existing = new FakeClient({ "FROM pg_roles": [{ "?column?": 1 }] });
  await ensureReadonlyRole(existing, "classifyre", password);
  {
    assert.ok(
      existing.statements.some((s) => s.startsWith("ALTER ROLE")),
      "an existing role is updated, not re-created",
    );
  }

  // A schema created after the login exists still has to be granted, or the
  // workspace made tomorrow is invisible to the tool configured today.
  const withRole = new FakeClient({ "FROM pg_roles": [{ "?column?": 1 }] });
  await grantSchemaToReadonlyRole(withRole, "ns_new");
  {
    assert.ok(withRole.statements.some((s) => s.includes('"ns_new"')));
  }
  const withoutRole = new FakeClient();
  await grantSchemaToReadonlyRole(withoutRole, "ns_new");
  {
    assert.equal(withoutRole.statements.length, 1, "no role, no grants");
  }

  // Dropping has to release the grants first — a role still referenced by a
  // privilege cannot be dropped.
  const dropping = new FakeClient({ "FROM pg_roles": [{ "?column?": 1 }] });
  await dropReadonlyRole(dropping);
  {
    const owned = dropping.statements.findIndex((s) => s.startsWith("DROP OWNED"));
    const role = dropping.statements.findIndex((s) => s.startsWith("DROP ROLE"));
    assert.ok(owned >= 0 && role > owned, "DROP OWNED BY must precede DROP ROLE");
  }

  console.log("postgres-readonly: all assertions passed");
}

void main();
