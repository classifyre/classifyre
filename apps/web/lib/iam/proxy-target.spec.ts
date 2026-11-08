import {
  allowedIamPath,
  upstreamIamBaseUrl,
  upstreamIamUrl,
} from "./proxy-target";

const env = {
  IAM_ENABLED: "true",
  IAM_INTERNAL_URL: "http://classifyre-iam:8080/iam/",
  IAM_SERVICE_URL: "http://other:8080/iam",
  IAM_REALM: "classifyre",
};

describe("identity server proxy target", () => {
  it("prefers the in-cluster URL for the upstream, like the API does", () => {
    expect(upstreamIamBaseUrl(env)).toBe("http://classifyre-iam:8080/iam");
    expect(
      upstreamIamBaseUrl({ ...env, IAM_INTERNAL_URL: undefined }),
    ).toBe("http://other:8080/iam");
    expect(
      upstreamIamBaseUrl({
        ...env,
        IAM_INTERNAL_URL: undefined,
        IAM_SERVICE_URL: undefined,
      }),
    ).toBeNull();
  });

  it("is off without sign-in", () => {
    expect(upstreamIamBaseUrl({})).toBeNull();
    expect(allowedIamPath(["realms", "classifyre"], {})).toBe(false);
  });

  it("forwards the Classifyre realm and the theme's static files", () => {
    expect(allowedIamPath(["realms", "classifyre", "protocol", "openid-connect", "auth"], env)).toBe(
      true,
    );
    expect(allowedIamPath(["resources", "x", "theme.css"], env)).toBe(true);
  });

  it("blocks the master realm, the admin console and anything else", () => {
    expect(allowedIamPath(["realms", "master"], env)).toBe(false);
    expect(
      allowedIamPath(["realms", "master", "protocol", "openid-connect", "auth"], env),
    ).toBe(false);
    expect(allowedIamPath(["realms"], env)).toBe(false);
    expect(allowedIamPath(["realms", "other"], env)).toBe(false);
    expect(allowedIamPath(["admin", "master", "console"], env)).toBe(false);
    expect(allowedIamPath([], env)).toBe(false);
  });

  it("forwards only the realm's own identity console with iam.realmConsole", () => {
    const realmConsole = { ...env, IAM_REALM_CONSOLE: "true" };
    expect(allowedIamPath(["admin", "classifyre", "console"], realmConsole)).toBe(true);
    expect(allowedIamPath(["admin", "classifyre", "console", "whoami"], realmConsole)).toBe(true);
    expect(allowedIamPath(["admin", "realms", "classifyre", "organizations"], realmConsole)).toBe(
      true,
    );
    expect(allowedIamPath(["admin", "serverinfo"], realmConsole)).toBe(true);
    // The master realm's console and API, and every other realm, stay closed.
    expect(allowedIamPath(["admin", "master", "console"], realmConsole)).toBe(false);
    expect(allowedIamPath(["admin", "realms", "master", "users"], realmConsole)).toBe(false);
    expect(allowedIamPath(["admin", "realms"], realmConsole)).toBe(false);
    expect(allowedIamPath(["admin", "classifyre", "other"], realmConsole)).toBe(false);
    expect(allowedIamPath(["realms", "master", "protocol"], realmConsole)).toBe(false);
    expect(allowedIamPath([], realmConsole)).toBe(false);
    // Without the switch, none of it.
    expect(allowedIamPath(["admin", "classifyre", "console"], env)).toBe(false);
    expect(allowedIamPath(["admin", "realms", "classifyre", "users"], env)).toBe(false);
  });

  it("forwards the admin console when the operator exposes it", () => {
    const exposed = { ...env, IAM_EXPOSE_ADMIN_CONSOLE: "true" };
    expect(allowedIamPath(["admin", "master", "console"], exposed)).toBe(true);
    expect(
      allowedIamPath(["realms", "master", "protocol", "openid-connect", "auth"], exposed),
    ).toBe(true);
    expect(allowedIamPath(["realms", "classifyre"], exposed)).toBe(true);
    expect(allowedIamPath([], exposed)).toBe(true);
    // Without the flag the bare root 404s instead of advertising the console.
    expect(allowedIamPath([], env)).toBe(false);
  });

  it("keeps OIDC parameters and the trailing slash untouched", () => {
    // Swapped forEach args once sent `classifyre-web=client_id`; a dropped
    // trailing slash once made Keycloak double the `/iam` prefix.
    const withSlash = upstreamIamUrl(
      "http://classifyre-iam:8080/iam",
      ["realms", "classifyre", "protocol", "openid-connect", "auth"],
      new URLSearchParams("client_id=classifyre-web&scope=openid"),
      true,
    );
    expect(withSlash.toString()).toBe(
      "http://classifyre-iam:8080/iam/realms/classifyre/protocol/openid-connect/auth/?client_id=classifyre-web&scope=openid",
    );
    const withoutSlash = upstreamIamUrl(
      "http://classifyre-iam:8080/iam",
      ["realms", "classifyre", "protocol", "openid-connect", "auth"],
      new URLSearchParams(""),
      false,
    );
    expect(withoutSlash.toString()).toBe(
      "http://classifyre-iam:8080/iam/realms/classifyre/protocol/openid-connect/auth",
    );
  });
});
