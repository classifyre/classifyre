import {
  RUNTIME_MODULES,
  RUNTIME_PACKAGES,
  filterRuntimePackages,
  findRuntimeModule,
} from "./notebook-runtime-packages";

describe("the runtime package manifest", () => {
  it("is generated with a version for every entry", () => {
    // An entry with no version means pyproject and uv.lock disagree, which is
    // exactly the drift the generated file exists to prevent.
    expect(RUNTIME_PACKAGES.length).toBeGreaterThan(20);
    for (const entry of RUNTIME_PACKAGES) {
      expect(entry.version).toMatch(/\d/);
      expect(entry.modules.length).toBeGreaterThan(0);
    }
  });

  it("marks base dependencies as always available and groups as on demand", () => {
    const byName = new Map(RUNTIME_PACKAGES.map((e) => [e.name, e]));
    expect(byName.get("requests")?.availability).toBe("always");
    expect(byName.get("pdfplumber")?.availability).toBe("on-demand");
    expect(byName.get("pdfplumber")?.group).toBe("file-processing");
  });

  it("does not advertise the multi-gigabyte ML groups", () => {
    const names = new Set(RUNTIME_PACKAGES.map((entry) => entry.name));
    expect(names.has("torch")).toBe(false);
    expect(names.has("transformers")).toBe(false);
  });
});

describe("filterRuntimePackages", () => {
  it("returns everything for an empty query", () => {
    expect(filterRuntimePackages("  ")).toHaveLength(RUNTIME_PACKAGES.length);
  });

  it("matches on the import name, not just the distribution name", () => {
    // Someone searching for what they type in an import line -- `bs4` -- must
    // find `beautifulsoup4`.
    const names = filterRuntimePackages("bs4").map((entry) => entry.name);
    expect(names).toContain("beautifulsoup4");
  });

  it("matches on the group, so a whole capability can be found at once", () => {
    const names = filterRuntimePackages("file-processing").map((e) => e.name);
    expect(names).toContain("pdfplumber");
    expect(names).toContain("openpyxl");
  });

  it("returns nothing for a package that is not there", () => {
    expect(filterRuntimePackages("tensorflow")).toHaveLength(0);
  });
});

describe("findRuntimeModule", () => {
  it("resolves an import name back to its distribution", () => {
    expect(findRuntimeModule("bs4")?.package.name).toBe("beautifulsoup4");
    expect(findRuntimeModule("PIL")?.package.name).toBe("pillow");
  });

  it("is undefined for something the runtime does not have", () => {
    expect(findRuntimeModule("numpy_but_not_really")).toBeUndefined();
  });

  it("lists modules in a stable order", () => {
    const modules = RUNTIME_MODULES.map((entry) => entry.module);
    expect(modules).toEqual([...modules].sort((a, b) => a.localeCompare(b)));
  });
});
