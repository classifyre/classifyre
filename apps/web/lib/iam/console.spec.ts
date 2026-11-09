import { accountPagePath, identityConsolePath } from "./console";

const env = {
  IAM_ENABLED: "true",
  IAM_REALM_CONSOLE: "true",
  IAM_REALM: "classifyre",
};

describe("identity console link", () => {
  it("opens the realm's organizations, or one of them", () => {
    expect(identityConsolePath(env)).toBe(
      "/iam/admin/classifyre/console/#/classifyre/organizations",
    );
    expect(
      identityConsolePath(env, "621DD068-0FF2-409C-B505-3775F3AE7FD5"),
    ).toBe(
      "/iam/admin/classifyre/console/#/classifyre/organizations/621dd068-0ff2-409c-b505-3775f3ae7fd5/settings",
    );
  });

  it("ignores anything but an organization id", () => {
    expect(identityConsolePath(env, "../../master/console")).toBe(
      "/iam/admin/classifyre/console/#/classifyre/organizations",
    );
  });

  it("is off without sign-in or without the realm console", () => {
    expect(
      identityConsolePath({ ...env, IAM_REALM_CONSOLE: "false" }),
    ).toBeNull();
    expect(identityConsolePath({ ...env, IAM_ENABLED: "false" })).toBeNull();
    expect(identityConsolePath({ ...env, IAM_REALM: "" })).toBeNull();
  });
});

describe("account page link", () => {
  it("opens the person's own account page in the realm, with sign-in only", () => {
    expect(accountPagePath(env)).toBe("/iam/realms/classifyre/account/");
    expect(accountPagePath({ ...env, IAM_REALM_CONSOLE: "false" })).toBe(
      "/iam/realms/classifyre/account/",
    );
    expect(accountPagePath({ ...env, IAM_ENABLED: "false" })).toBeNull();
    expect(accountPagePath({ ...env, IAM_REALM: "../master" })).toBeNull();
  });
});
