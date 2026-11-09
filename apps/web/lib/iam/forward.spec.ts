import { withoutAppCookies } from "./forward";

describe("identity server proxy cookies", () => {
  it("keeps the identity server's cookies and drops Classifyre's session", () => {
    expect(
      withoutAppCookies(
        "cf_session=a; KEYCLOAK_SESSION=b; cf_refresh=c; AUTH_SESSION_ID=d; cf_id=e",
      ),
    ).toBe("KEYCLOAK_SESSION=b; AUTH_SESSION_ID=d");
    expect(withoutAppCookies("cf_session=a; cf_auth_flow=x")).toBeNull();
    expect(withoutAppCookies(null)).toBeNull();
  });
});
