import {
  draftProblems,
  draftToSchema,
  schemaToDraft,
} from "./code-detector";
import { isNonTrainableKind, resolveDetectorKind } from "./detector-kind";

const DETECT = "def detect(asset, ctx):\n    yield Finding(label='x', value='y')\n";

const stored = {
  type: "CODE_DETECTOR",
  notebook: { revision: 4, cells: [{ id: "c1", type: "code", source: DETECT }] },
  variables: { limit: "5" },
  fields: [{ name: "expected", type: "number" }],
  severity: "high",
  category: "COMPLIANCE",
  needs_findings: true,
  deterministic: false,
  limits: { per_asset_timeout_seconds: 10, max_workers: 2 },
  scope: { asset_kinds: ["table"], metadata: { doc_type: "jab" } },
  budget: { max_consecutive_failures: 3 },
};

describe("code detector drafts", () => {
  it("resolves CODE_DETECTOR to the code editor, with nothing to train", () => {
    expect(resolveDetectorKind({ type: "CODE_DETECTOR" })).toBe("code");
    expect(isNonTrainableKind("code")).toBe(true);
  });

  it("round-trips a stored schema without losing what the form does not edit", () => {
    const draft = schemaToDraft(stored, ["api_token"]);
    expect(draft.revision).toBe(4);
    expect(draft.needsFindings).toBe(true);
    expect(draft.deterministic).toBe(false);
    expect(draft.assetKinds).toEqual(["table"]);

    const schema = draftToSchema(draft, stored);
    expect(schema.notebook).toEqual(stored.notebook);
    expect(schema.limits).toEqual({ per_asset_timeout_seconds: 10, max_workers: 2 });
    expect(schema.scope).toEqual(stored.scope);
    expect(schema.budget).toEqual(stored.budget);
    // An untouched secret is not sent at all: the server keeps it.
    expect(schema).not.toHaveProperty("secrets");
  });

  it("sends secrets as a patch: new values set, removed keys null", () => {
    const draft = schemaToDraft(stored, ["old_token"]);
    draft.secrets = [{ key: "new_token", value: "s3cr3t" }];
    expect(draftToSchema(draft, stored).secrets).toEqual({
      new_token: "s3cr3t",
      old_token: null,
    });
  });

  it("clears scope kinds and limits the form emptied", () => {
    const draft = schemaToDraft(stored);
    draft.assetKinds = [];
    draft.perAssetTimeoutSeconds = "";
    const schema = draftToSchema(draft, {
      ...stored,
      scope: { asset_kinds: ["table"] },
    });
    expect(schema.scope).toBeNull();
    expect(schema.limits).toEqual({ max_workers: 2 });
  });

  it("flags a notebook without detect() and bad field names", () => {
    const draft = schemaToDraft({
      ...stored,
      notebook: { cells: [{ id: "c", type: "code", source: "def setup(ctx): pass" }] },
      fields: [{ name: "not valid" }, { name: "a" }, { name: "a" }],
    });
    expect(draftProblems(draft)).toEqual([
      "missingDetect",
      "fieldName",
      "duplicateField",
    ]);
  });
});
