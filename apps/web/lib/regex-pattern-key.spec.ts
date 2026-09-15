import { regexPatternKey } from "./regex-pattern-key";

describe("regexPatternKey", () => {
  it("keeps the key's case, so saving never renames a finding type", () => {
    expect(regexPatternKey("AT_FIRMENBUCHNUMMER")).toBe("AT_FIRMENBUCHNUMMER");
    expect(regexPatternKey("euid")).toBe("euid");
  });

  it("trims and joins whitespace with underscores", () => {
    expect(regexPatternKey("  Company  number ")).toBe("Company_number");
  });
});
