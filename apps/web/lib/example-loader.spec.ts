import { getSourceExamples, isDesktopOnlyExample } from "./example-loader";

/**
 * The desktop-only gate on source examples.
 *
 * Detected from the config an example ships rather than from its name: an
 * example that configures `local_folders` points at an absolute path on local
 * disk, which a browser tab talking to a Kubernetes cluster does not have — and
 * the API refuses to store those paths there anyway. Naming it by hand would
 * mean the next folder-reading example is offered where it cannot work.
 */
describe("isDesktopOnlyExample", () => {
  it("flags an example that configures local folders", () => {
    expect(
      isDesktopOnlyExample({
        name: "Read a folder",
        description: "",
        config: {
          optional: { local_folders: [{ name: "dumps", path: "/tmp/dumps" }] },
        },
      }),
    ).toBe(true);
  });

  it("does not flag an example without them", () => {
    expect(
      isDesktopOnlyExample({
        name: "REST API",
        description: "",
        config: { optional: { variables: { api_base: "https://x" } } },
      }),
    ).toBe(false);
    expect(
      isDesktopOnlyExample({ name: "Bare", description: "", config: {} }),
    ).toBe(false);
    expect(
      isDesktopOnlyExample({
        name: "Empty list",
        description: "",
        config: { optional: { local_folders: [] } },
      }),
    ).toBe(false);
  });

  it("finds exactly one desktop-only CUSTOM example in the shipped set", () => {
    const custom = getSourceExamples("CUSTOM");
    expect(custom.length).toBeGreaterThan(1);
    expect(custom.filter(isDesktopOnlyExample)).toHaveLength(1);
  });
});
