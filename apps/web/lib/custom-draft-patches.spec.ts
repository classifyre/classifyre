import { applyDraftPatches, isDraftPatchPath } from "./custom-draft-patches";
import type { CustomSourceDraft } from "@/components/notebook/custom-source-config";

/**
 * The assistant's patches for the parts of a CUSTOM source that are not in the
 * schema form. Before this existed they were forwarded to a form that had no
 * such fields: the reply said "Filled in optional.packages", nothing changed,
 * and the next run failed on the import it thought it had declared.
 */
const draft = (over: Partial<CustomSourceDraft> = {}): CustomSourceDraft => ({
  cells: [],
  revision: 1,
  packages: [],
  localFolders: [],
  variables: [],
  secrets: [],
  originalSecretKeys: [],
  ...over,
});

describe("isDraftPatchPath", () => {
  it("claims the sections the form does not render", () => {
    expect(isDraftPatchPath("optional.packages")).toBe(true);
    expect(isDraftPatchPath("optional.variables.api_base")).toBe(true);
    expect(isDraftPatchPath("masked.secrets.api_token")).toBe(true);
    expect(isDraftPatchPath("optional.local_folders")).toBe(true);
  });

  it("leaves everything else to the schema form", () => {
    expect(isDraftPatchPath("name")).toBe(false);
    expect(isDraftPatchPath("optional.sampling")).toBe(false);
    expect(isDraftPatchPath("schedule.cron")).toBe(false);
  });
});

describe("applyDraftPatches", () => {
  it("merges packages rather than replacing what the author added", () => {
    const result = applyDraftPatches(
      draft({ packages: [{ name: "httpx", version: ">=0.27" }] }),
      [{ path: "optional.packages", value: [{ name: "pandas" }] }],
    );

    expect(result.draft.packages).toEqual([
      { name: "httpx", version: ">=0.27" },
      { name: "pandas" },
    ]);
    expect(result.applied).toEqual(["optional.packages"]);
  });

  it("takes a bare string for a package, and the newer version on a repeat", () => {
    const result = applyDraftPatches(draft({ packages: [{ name: "pandas" }] }), [
      {
        path: "optional.packages",
        value: ["openpyxl", { name: "Pandas", version: "2.2.0" }],
      },
    ]);

    expect(result.draft.packages).toEqual([
      { name: "Pandas", version: "2.2.0" },
      { name: "openpyxl" },
    ]);
  });

  it("sets one variable without disturbing the others", () => {
    const result = applyDraftPatches(
      draft({ variables: [{ key: "api_base", value: "https://old" }] }),
      [
        { path: "optional.variables.api_base", value: "https://new" },
        { path: "optional.variables.page_size", value: 50 },
      ],
    );

    expect(result.draft.variables).toEqual([
      { key: "api_base", value: "https://new" },
      { key: "page_size", value: "50" },
    ]);
  });

  it("adds a secret by name", () => {
    const result = applyDraftPatches(draft(), [
      { path: "masked.secrets.api_token", value: "s3cret" },
    ]);

    expect(result.draft.secrets).toEqual([{ key: "api_token", value: "s3cret" }]);
  });

  it("replaces folders wholesale, dropping malformed entries", () => {
    const result = applyDraftPatches(draft(), [
      {
        path: "optional.local_folders",
        value: [{ name: "dumps", path: "/mnt/corpora/dumps" }, { name: "bad" }],
      },
    ]);

    expect(result.draft.localFolders).toEqual([
      { name: "dumps", path: "/mnt/corpora/dumps" },
    ]);
  });

  it("skips a malformed patch instead of losing the whole reply", () => {
    const result = applyDraftPatches(draft({ packages: [{ name: "httpx" }] }), [
      { path: "optional.packages", value: "not-a-list" },
      { path: "optional.variables.api_base", value: "https://example.com" },
    ]);

    expect(result.draft.packages).toEqual([{ name: "httpx" }]);
    expect(result.applied).toEqual(["optional.variables.api_base"]);
  });
});
