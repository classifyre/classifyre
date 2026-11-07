import { iamEnabled } from '../identity/iam-config';
import { LOCAL_TENANT_ID } from '../identity/tenancy.sql';

/**
 * Which workspaces this process may see at all (docs/prd/TEN §6). Sign-in off:
 * only the `local` tenant's. Sign-in on: only real tenants'. Turning sign-in
 * off by mistake therefore never opens a tenant's workspaces to everyone, and
 * turning it on never hands the workspaces made without it to a tenant.
 *
 * Every registry read and write carries this predicate, so the request
 * pipeline, the lists, the workers and MCP all follow it without knowing.
 */
export function workspaceScopeSql(
  column = 'tenant_id',
  env: NodeJS.ProcessEnv = process.env,
): string {
  return iamEnabled(env)
    ? `${column} <> '${LOCAL_TENANT_ID}'`
    : `${column} = '${LOCAL_TENANT_ID}'`;
}
