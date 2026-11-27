/**
 * What the app may say about SQL connections, from the endpoint the API
 * reports. Pure (a type-only import), so it is unit tested without the client.
 *
 * - `loading`: the endpoint has not arrived. Show nothing: rendering a control
 *   first and hiding it when the answer is "off" is what made the connect
 *   button flash on and off.
 * - `off`: this deployment runs no SQL gateway (Helm `sqlGateway.enabled:
 *   false`).
 * - `unconfigured`: the gateway runs, but has no public address
 *   (`sqlGateway.publicHost`, `SQL_GATEWAY_PUBLIC_HOST`), so there is nothing
 *   to tell a tool. The app warns and links the setup guide.
 * - `ready`: connection details can be shown.
 */
import type { DataConnectionEndpointDto } from "@workspace/api-client";

export type EndpointState = "loading" | "off" | "unconfigured" | "ready";

export function endpointState(
  endpoint: Pick<DataConnectionEndpointDto, "enabled" | "configured"> | null,
): EndpointState {
  if (!endpoint) return "loading";
  if (!endpoint.enabled) return "off";
  return endpoint.configured ? "ready" : "unconfigured";
}

/**
 * The setup guide, from the documentation served beside the app: every ingress
 * (LoadBalancer, NodePort, Traefik, ingress-nginx, Docker) and the public host.
 */
export const SQL_SETUP_DOCS_HREF =
  "/docs/sql-connections/#making-the-endpoint-reachable";

const NPGSQL_SSL_MODE: Record<string, string> = {
  "verify-full": "VerifyFull",
  "verify-ca": "VerifyCA",
  require: "Require",
  disable: "Disable",
};

/** How common tools connect, from the endpoint and a connection's user name. */
export function connectionStrings(
  endpoint: Pick<
    DataConnectionEndpointDto,
    "host" | "port" | "database" | "sslMode" | "caCertificate"
  >,
  username: string,
  password = "<password>",
) {
  const host = endpoint.host ?? "<host>";
  const { port, database, sslMode } = endpoint;
  const caPath = "classifyre-sql-ca.crt";
  const tlsEnabled = sslMode !== "disable";
  const withCa = tlsEnabled && Boolean(endpoint.caCertificate);
  const npgsqlMode = NPGSQL_SSL_MODE[sslMode] ?? "VerifyFull";
  return {
    psql: `psql "host=${host} port=${port} dbname=${database} user=${username} sslmode=${sslMode}${withCa ? ` sslrootcert=${caPath}` : ""}"`,
    uri: `postgresql://${encodeURIComponent(username)}@${host}:${port}/${encodeURIComponent(database)}?sslmode=${sslMode}`,
    jdbc: tlsEnabled
      ? `jdbc:postgresql://${host}:${port}/${database}?user=${username}&ssl=true&sslmode=${sslMode}${withCa ? `&sslrootcert=${caPath}` : ""}`
      : `jdbc:postgresql://${host}:${port}/${database}?user=${username}&ssl=false&sslmode=disable`,
    odbc: `Driver={PostgreSQL Unicode};Server=${host};Port=${port};Database=${database};Uid=${username};Pwd=${password};SSLMode=${sslMode};`,
    npgsql: `Host=${host};Port=${port};Database=${database};Username=${username};Password=${password};SSL Mode=${npgsqlMode}${withCa ? `;Root Certificate=${caPath}` : ""}`,
  };
}
