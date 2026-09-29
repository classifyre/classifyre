import { RETURN_TO_PARAM, safeReturnTo, withReturnTo } from "./return-to";

describe("returnTo", () => {
  it("accepts addresses inside the app", () => {
    expect(safeReturnTo("/ns/investigations/c1?panel=watches&watch=w1")).toBe(
      "/ns/investigations/c1?panel=watches&watch=w1",
    );
    expect(safeReturnTo("/ns/investigations/c1?panel=details&edge=lnk%3Aabc")).not.toBeNull();
  });

  it("refuses anything that leaves the app", () => {
    for (const bad of ["https://evil.test", "//evil.test/x", "/\\evil.test", "javascript:alert(1)", "/javascript:alert(1)", "", null, undefined]) {
      expect(safeReturnTo(bad)).toBeNull();
    }
  });

  it("adds itself to a path with or without a query", () => {
    expect(withReturnTo("/a/edit", "/b?x=1")).toBe(`/a/edit?${RETURN_TO_PARAM}=%2Fb%3Fx%3D1`);
    expect(withReturnTo("/a/new?caseId=c", "/b")).toBe(`/a/new?caseId=c&${RETURN_TO_PARAM}=%2Fb`);
  });
});
