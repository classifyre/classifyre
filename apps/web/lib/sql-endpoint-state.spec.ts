import {
  connectionStrings,
  endpointState,
  SQL_SETUP_DOCS_HREF,
} from "./sql-endpoint-state";

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

describe("connectionStrings", () => {
  it("includes sslmode=verify-full and sslrootcert when TLS is enabled with a custom CA", () => {
    const strings = connectionStrings(
      {
        host: "sql.example.com",
        port: 5432,
        database: "finance",
        sslMode: "verify-full",
        caCertificate: "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----",
      },
      "ana_bi",
      "secret",
    );
    expect(strings.psql).toContain("sslmode=verify-full sslrootcert=classifyre-sql-ca.crt");
    expect(strings.jdbc).toContain("ssl=true&sslmode=verify-full&sslrootcert=classifyre-sql-ca.crt");
    expect(strings.odbc).toContain("SSLMode=verify-full;");
    expect(strings.npgsql).toContain("SSL Mode=VerifyFull;Root Certificate=classifyre-sql-ca.crt");
    expect(strings.uri).toContain("?sslmode=verify-full");
  });

  it("omits sslrootcert when TLS is enabled with a publicly trusted certificate", () => {
    const strings = connectionStrings(
      {
        host: "sql.example.com",
        port: 5432,
        database: "finance",
        sslMode: "verify-full",
        caCertificate: null,
      },
      "ana_bi",
      "secret",
    );
    expect(strings.psql).toContain("sslmode=verify-full\"");
    expect(strings.psql).not.toContain("sslrootcert");
    expect(strings.jdbc).toContain("ssl=true&sslmode=verify-full");
    expect(strings.jdbc).not.toContain("sslrootcert");
    expect(strings.npgsql).toContain("SSL Mode=VerifyFull");
    expect(strings.npgsql).not.toContain("Root Certificate");
  });

  it("uses sslmode=disable and ssl=false with no CA when TLS is disabled", () => {
    const strings = connectionStrings(
      {
        host: "localhost",
        port: 5433,
        database: "default",
        sslMode: "disable",
        caCertificate: "ignored-if-present",
      },
      "ana_bi",
      "secret",
    );
    expect(strings.psql).toContain("sslmode=disable\"");
    expect(strings.psql).not.toContain("sslrootcert");
    expect(strings.uri).toContain("?sslmode=disable");
    expect(strings.jdbc).toContain("ssl=false&sslmode=disable");
    expect(strings.jdbc).not.toContain("ssl=true");
    expect(strings.jdbc).not.toContain("sslrootcert");
    expect(strings.odbc).toContain("SSLMode=disable;");
    expect(strings.npgsql).toContain("SSL Mode=Disable");
    expect(strings.npgsql).not.toContain("Root Certificate");
  });
});
