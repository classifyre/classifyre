import { endpointState, SQL_SETUP_DOCS_HREF } from "./sql-endpoint-state";

const endpoint = (over: { enabled: boolean; configured: boolean }) => ({
  ...over,
  host: over.configured ? "sql.example.com" : null,
  port: 5432,
  database: "ws",
  sslMode: "verify-full" as const,
  caCertificate: null,
});

describe("endpointState", () => {
  it("is loading until the endpoint arrives (so nothing flashes)", () => {
    expect(endpointState(null)).toBe("loading");
  });

  it("is off when the deployment runs no gateway, whatever else is set", () => {
    expect(endpointState(endpoint({ enabled: false, configured: false }))).toBe(
      "off",
    );
    expect(endpointState(endpoint({ enabled: false, configured: true }))).toBe(
      "off",
    );
  });

  it("is unconfigured when the gateway runs without a public address", () => {
    expect(endpointState(endpoint({ enabled: true, configured: false }))).toBe(
      "unconfigured",
    );
  });

  it("is ready with the gateway on and a public address", () => {
    expect(endpointState(endpoint({ enabled: true, configured: true }))).toBe(
      "ready",
    );
  });
});

describe("SQL_SETUP_DOCS_HREF", () => {
  it("points at the reachability section of the bundled SQL connections docs", () => {
    expect(SQL_SETUP_DOCS_HREF).toBe(
      "/docs/sql-connections/#making-the-endpoint-reachable",
    );
  });
});
