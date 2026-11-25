import { quoteIdent } from './catalog-ddl';

/**
 * Setup applied once to `classifyre_tpl` (docs/prd/SG-sql-gateway-native-catalog.md §4.3).
 *
 * Every per-`(workspace, catalogHash)` database is cloned from this template so
 * it inherits Classifyre's planner helpers (`classifyre.reads`, `classifyre.fail`)
 * and the hardened function/schema revocations without paying setup cost per DB.
 */
export const TEMPLATE_SETUP = `
CREATE EXTENSION IF NOT EXISTS plpgsql;
CREATE SCHEMA IF NOT EXISTS classifyre;

CREATE OR REPLACE FUNCTION classifyre.fail(state text, msg text) RETURNS void
  LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION USING ERRCODE = state, MESSAGE = msg; END$$;

-- What a statement reads, as ["schema|relation", ...] from its plan; null
-- when it cannot be planned. SECURITY INVOKER ensures planning runs strictly
-- with the caller's locked-down r_<hash> privileges.
CREATE OR REPLACE FUNCTION classifyre.reads(q text, q_nulls text) RETURNS text
  LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  plan jsonb;
BEGIN
  BEGIN
    EXECUTE 'EXPLAIN (VERBOSE, GENERIC_PLAN, FORMAT JSON) ' || q INTO plan;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      EXECUTE 'EXPLAIN (VERBOSE, FORMAT JSON) ' || q_nulls INTO plan;
    EXCEPTION WHEN OTHERS THEN
      RETURN NULL;
    END;
  END;
  RETURN (
    SELECT coalesce(json_agg(DISTINCT (node ->> 'Schema') || '|' || (node ->> 'Relation Name')), '[]'::json)::text
      FROM jsonb_path_query(plan, 'strict $.**') AS node
     WHERE jsonb_typeof(node) = 'object' AND node ? 'Relation Name'
  );
END$$;

REVOKE ALL ON SCHEMA classifyre FROM PUBLIC;
GRANT USAGE ON SCHEMA classifyre TO PUBLIC;
GRANT EXECUTE ON FUNCTION classifyre.reads(text, text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION classifyre.fail(text, text) TO PUBLIC;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Revoke functions that run dynamic SQL text (bypassing EXPLAIN), sleep/stall
-- CPU, touch server files, or manipulate large objects (SG §4.3, R5).
DO $$
DECLARE
  f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure FROM pg_proc p
     WHERE p.pronamespace = 'pg_catalog'::regnamespace
       AND (
         p.proname LIKE '%\\_to\\_xml%'
         OR p.proname LIKE '%\\_to\\_xmlschema'
         OR p.proname IN (
           'ts_stat',
           'ts_rewrite',
           'query_to_xml_and_xmlschema',
           'pg_sleep',
           'pg_sleep_for',
           'pg_sleep_until'
         )
         OR p.proname LIKE 'pg\\_read\\_file%'
         OR p.proname LIKE 'pg\\_read\\_binary\\_file%'
         OR p.proname LIKE 'pg\\_ls\\_dir%'
         OR p.proname LIKE 'pg\\_stat\\_file%'
         OR p.proname LIKE 'lo\\_%'
       )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
END$$;
`;

export interface ProvisionRoleAndDbSqlInput {
  dbName: string;
  roleName: string;
  password: string;
  templateDb: string;
  adminUser: string;
  roleConnectionLimit: number;
  statementTimeoutMs: number;
  workMem: string;
}

/** Ordered admin SQL statements creating locked-down `r_<hash>` and `c_<hash>`. */
export function buildProvisionStatements(
  input: ProvisionRoleAndDbSqlInput,
): string[] {
  const qDb = quoteIdent(input.dbName);
  const qRole = quoteIdent(input.roleName);
  const qTpl = quoteIdent(input.templateDb);
  const qAdmin = quoteIdent(input.adminUser);
  const qPass = `'${input.password.replace(/'/g, "''")}'`;
  return [
    `DROP DATABASE IF EXISTS ${qDb} WITH (FORCE)`,
    `DROP ROLE IF EXISTS ${qRole}`,
    `CREATE ROLE ${qRole} LOGIN PASSWORD ${qPass} ` +
      `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION ` +
      `CONNECTION LIMIT ${input.roleConnectionLimit}`,
    `ALTER ROLE ${qRole} SET default_transaction_read_only = on`,
    `ALTER ROLE ${qRole} SET statement_timeout = '${input.statementTimeoutMs}ms'`,
    `ALTER ROLE ${qRole} SET lock_timeout = '5s'`,
    `ALTER ROLE ${qRole} SET work_mem = '${input.workMem}'`,
    `ALTER ROLE ${qRole} SET temp_file_limit = '0'`,
    `CREATE DATABASE ${qDb} TEMPLATE ${qTpl} OWNER ${qAdmin}`,
    `REVOKE ALL ON DATABASE ${qDb} FROM PUBLIC`,
    `REVOKE TEMP ON DATABASE ${qDb} FROM PUBLIC`,
    `GRANT CONNECT ON DATABASE ${qDb} TO ${qRole}`,
  ];
}

/** Read-only schema/table grants for `r_<hash>` inside `c_<hash>`. */
export function buildSchemaGrantSql(
  dataSchemas: ReadonlySet<string>,
  roleName: string,
): string {
  const qRole = quoteIdent(roleName);
  const statements: string[] = [];
  for (const schema of dataSchemas) {
    const qSchema = quoteIdent(schema);
    statements.push(`GRANT USAGE ON SCHEMA ${qSchema} TO ${qRole};`);
    statements.push(
      `GRANT SELECT ON ALL TABLES IN SCHEMA ${qSchema} TO ${qRole};`,
    );
  }
  return statements.join('\n');
}
