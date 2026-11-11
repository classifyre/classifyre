import {
  IdentityUnavailableError,
  tokenRequest,
  iamWebConfig,
  needsRenewal,
  newFlow,
  safeReturnTo,
  seal,
  sessionCookies,
  unseal,
} from "./session";

const env = {
  IAM_ISSUER_URL: "https://classifyre.example/iam/realms/classifyre/",
  IAM_INTERNAL_URL: "http://classifyre-iam:8080/iam",
  IAM_REALM: "classifyre",
  IAM_WEB_CLIENT_ID: "classifyre-web",
  IAM_WEB_CLIENT_SECRET: "client-secret",
  IAM_APP_URL: "https://classifyre.example",
};

function jwtExpiringIn(seconds: number): string {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part({ exp: Math.floor(Date.now() / 1000) + seconds })}.x`;
}

describe("web sign-in session", () => {
  const config = iamWebConfig(env);

  it("refuses to start without the identity server settings", () => {
    expect(() => iamWebConfig({})).toThrow(/IAM_ISSUER_URL/);
  });

  it("exchanges tokens in-cluster but sends browsers to the public issuer", () => {
    expect(config.tokenUrl).toBe(
      "http://classifyre-iam:8080/iam/realms/classifyre/protocol/openid-connect/token",
    );
    expect(config.issuerUrl).toBe(
      "https://classifyre.example/iam/realms/classifyre",
    );
    expect(config.secureCookies).toBe(true);
  });

  it("seals the refresh token so only this server can read it", () => {
    const sealed = seal(config, "refresh-token");
    expect(sealed).not.toContain("refresh-token");
    expect(unseal(config, sealed)).toBe("refresh-token");
    expect(unseal({ ...config, clientSecret: "other" }, sealed)).toBeNull();
    expect(unseal(config, `${sealed.slice(0, -2)}xx`)).toBeNull();
  });

  it("makes a fresh PKCE verifier and state each time", () => {
    const a = newFlow();
    const b = newFlow();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(a.verifier);
    expect(a.state).not.toBe(b.state);
  });

  it("renews shortly before expiry", () => {
    expect(needsRenewal(jwtExpiringIn(600))).toBe(false);
    expect(needsRenewal(jwtExpiringIn(30))).toBe(true);
    expect(needsRenewal(undefined)).toBe(true);
  });

  it("returns only to paths inside the app", () => {
    expect(safeReturnTo("/acme/findings?x=1")).toBe("/acme/findings?x=1");
    expect(safeReturnTo("https://evil.example/")).toBe("/");
    expect(safeReturnTo("//evil.example/")).toBe("/");
    expect(safeReturnTo("/\\evil.example/")).toBe("/");
    expect(safeReturnTo("/\t/evil.example/")).toBe("/");
    expect(safeReturnTo(null)).toBe("/");
  });

  it("keeps the refresh token sealed in its cookie", () => {
    const cookies = sessionCookies(config, {
      access_token: "a.b.c",
      refresh_token: "r",
      expires_in: 300,
      refresh_expires_in: 1800,
    });
    expect(cookies.map((cookie) => cookie.name)).toEqual([
      "cf_session",
      "cf_refresh",
    ]);
    expect(cookies[1]?.value).not.toBe("r");
    expect(cookies.every((cookie) => cookie.maxAge === 1800)).toBe(true);
  });

  describe("when the identity server is away", () => {
    afterEach(() => jest.restoreAllMocks());

    it("tells a refused token (sign-in ended) from no answer (keep the session)", async () => {
      const fetchMock = jest.spyOn(global, "fetch");
      fetchMock.mockResolvedValueOnce(new Response("{}", { status: 400 }));
      await expect(tokenRequest(config, { grant_type: "refresh_token" })).resolves.toBeNull();

      fetchMock.mockResolvedValueOnce(new Response("", { status: 503 }));
      await expect(tokenRequest(config, { grant_type: "refresh_token" })).rejects.toBeInstanceOf(
        IdentityUnavailableError,
      );

      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
      await expect(tokenRequest(config, { grant_type: "refresh_token" })).rejects.toBeInstanceOf(
        IdentityUnavailableError,
      );
    });
  });
});
