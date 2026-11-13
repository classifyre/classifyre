import { useCallback, useEffect, useState } from "react";
import {
  api,
  type DataConnectionDto,
  type DataConnectionEndpointDto,
  type DataConnectionListDto,
  type DataConnectionSecretDto,
} from "@workspace/api-client";

export type {
  DataConnectionDto,
  DataConnectionEndpointDto,
  DataConnectionListDto,
  DataConnectionSecretDto,
};

/** Whose connections a list shows (docs/prd/DQ-data-query.md §5.7). */
export type ConnectionsScope =
  | { kind: "mine" }
  | { kind: "all" }
  | { kind: "asset"; id: string }
  | { kind: "source"; id: string };

function load(scope: ConnectionsScope): Promise<DataConnectionListDto> {
  const sql = api.sqlConnections;
  switch (scope.kind) {
    case "mine":
      return sql.dataConnectionControllerMine();
    case "all":
      return sql.dataConnectionControllerAll();
    case "asset":
      return sql.dataConnectionControllerForAsset({ id: scope.id });
    case "source":
      return sql.dataConnectionControllerForSource({ id: scope.id });
  }
}

export function useDataConnections(scope: ConnectionsScope | null) {
  const key = scope ? `${scope.kind}:${"id" in scope ? scope.id : ""}` : "";
  const [data, setData] = useState<DataConnectionListDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(Boolean(scope));
  const reload = useCallback(async () => {
    if (!scope) return;
    setLoading(true);
    try {
      setData(await load(scope));
      setError(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload };
}

export function useSqlEndpoint() {
  const [endpoint, setEndpoint] = useState<DataConnectionEndpointDto | null>(
    null,
  );
  useEffect(() => {
    let alive = true;
    void api.sqlConnections
      .dataConnectionControllerEndpoint()
      .then((value) => alive && setEndpoint(value))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return endpoint;
}

export const createConnection = (body: {
  name: string;
  expiresInDays?: number;
  scope?: string[];
}) =>
  api.sqlConnections.dataConnectionControllerCreate({
    createDataConnectionDto: body,
  });

export const issueConnection = (body: {
  personRef: string;
  name: string;
  expiresInDays?: number;
  scope?: string[];
}) =>
  api.sqlConnections.dataConnectionControllerIssue({
    issueDataConnectionDto: body,
  });

export const newPassword = (id: string) =>
  api.sqlConnections.dataConnectionControllerPassword({ id });

export const revokeConnection = (id: string, reason?: string) =>
  api.sqlConnections.dataConnectionControllerRevoke({
    id,
    revokeDataConnectionDto: { reason },
  });

export const blockConnection = (
  id: string,
  target: { type: "source" | "asset"; id: string; reason?: string },
) =>
  api.sqlConnections.dataConnectionControllerBlock({
    id,
    blockDataConnectionDto: {
      type: target.type,
      id: target.id,
      reason: target.reason,
    } as never,
  });

export const unblockConnection = (id: string, blockId: string) =>
  api.sqlConnections.dataConnectionControllerUnblock({ id, blockId });

/** How common tools connect, from the endpoint and a connection's user name. */
export function connectionStrings(
  endpoint: DataConnectionEndpointDto,
  username: string,
  password = "<password>",
) {
  const host = endpoint.host ?? "<host>";
  const { port, database } = endpoint;
  const caPath = "classifyre-sql-ca.crt";
  const withCa = Boolean(endpoint.caCertificate);
  return {
    psql: `psql "host=${host} port=${port} dbname=${database} user=${username} sslmode=${endpoint.sslMode}${withCa ? ` sslrootcert=${caPath}` : ""}"`,
    uri: `postgresql://${encodeURIComponent(username)}@${host}:${port}/${encodeURIComponent(database)}?sslmode=${endpoint.sslMode}`,
    jdbc: `jdbc:postgresql://${host}:${port}/${database}?user=${username}&ssl=true&sslmode=${endpoint.sslMode}${withCa ? `&sslrootcert=${caPath}` : ""}`,
    odbc: `Driver={PostgreSQL Unicode};Server=${host};Port=${port};Database=${database};Uid=${username};Pwd=${password};SSLMode=${endpoint.sslMode};`,
    npgsql: `Host=${host};Port=${port};Database=${database};Username=${username};Password=${password};SSL Mode=VerifyFull${withCa ? `;Root Certificate=${caPath}` : ""}`,
  };
}
