import {
  PACKAGE_NAME_PATTERN,
  PACKAGE_VERSION_PATTERN,
  packageEntriesAreValid,
} from "./notebook-packages";

describe("package name validation", () => {
  it.each([
    "pandas",
    "google-cloud-storage",
    "ruamel.yaml",
    "a",
    "zope_interface",
  ])("accepts %p", (name) => {
    expect(PACKAGE_NAME_PATTERN.test(name)).toBe(true);
  });

  it.each([
    "",
    "-leading",
    ".leading",
    "has space",
    "semi;colon",
    // An argument-looking name must never reach the installer's argv.
    "--index-url",
    "a".repeat(65),
  ])("rejects %p", (name) => {
    expect(PACKAGE_NAME_PATTERN.test(name)).toBe(false);
  });
});

describe("package version validation", () => {
  it.each(["", "2.2.0", ">=2.0", "~=1.4", "!=2.1.0", "==1.0.0", "1.0.*"])(
    "accepts %p",
    (version) => {
      expect(PACKAGE_VERSION_PATTERN.test(version)).toBe(true);
    },
  );

  it.each(["; rm -rf /", "$(id)", "latest", "--force"])(
    "rejects %p",
    (version) => {
      expect(PACKAGE_VERSION_PATTERN.test(version)).toBe(false);
    },
  );
});

describe("packageEntriesAreValid", () => {
  it("accepts a distinct, well-formed list", () => {
    expect(
      packageEntriesAreValid([
        { name: "pandas", version: ">=2.0" },
        { name: "httpx" },
      ]),
    ).toBe(true);
  });

  it("rejects a duplicate regardless of case", () => {
    expect(
      packageEntriesAreValid([{ name: "pandas" }, { name: "Pandas" }]),
    ).toBe(false);
  });

  it("rejects a bad name or version", () => {
    expect(packageEntriesAreValid([{ name: "--index-url" }])).toBe(false);
    expect(packageEntriesAreValid([{ name: "pandas", version: "; id" }])).toBe(
      false,
    );
  });
});
