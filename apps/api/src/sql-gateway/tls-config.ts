/**
 * Whether TLS is enabled on the SQL gateway.
 *
 * Enabled by default whenever `SQL_GATEWAY_TLS_ENABLED` is unset or empty so
 * deployments stay encrypted unless an administrator explicitly opts out
 * (`SQL_GATEWAY_TLS_ENABLED=false|0|no|off`).
 */
export function isSqlGatewayTlsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.SQL_GATEWAY_TLS_ENABLED?.trim();
  if (!raw) return true;
  return !/^(0|false|no|off)$/i.test(raw);
}
