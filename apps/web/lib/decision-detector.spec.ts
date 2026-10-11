import {
  DECISION_PROVIDER_PRESETS,
  blankQuestion,
  decisionEndpointKey,
  draftProblems,
  draftToSchema,
  isDecisionSchema,
  providerIdForModel,
  questionFindingTypes,
  schemaToDraft,
  storedKeyIsKept,
  suggestQuestionName,
  withProvider,
  withQuestionType,
  type DecisionDraft,
} from "./decision-detector";
import { isNonTrainableKind, resolveDetectorKind } from "./detector-kind";
import {
  detectorTypeIconName,
  detectorTypeTranslationKey,
} from "./custom-detector-badge";
import en from "../i18n/en.json";

const stored = {
  type: "DECISION",
  model: "cloudflare/clef",
  api_base: "https://api.cloudflare.com/client/v4/accounts/acc-1/ai/run",
  extra_headers: { "x-team": "risk" },
  severity: "low",
  content_limit: 20000,
  questions: [
    {
      name: "refund_request",
      type: "yes_no",
      instructions: "Is the customer asking for a refund?",
      severity: "medium",
      threshold: 0.6,
    },
    {
      name: "urgency",
      type: "choice",
      instructions: "How urgent is this?",
      options: [
        { label: "low", description: "can wait a week", report: false },
        { label: "high", description: "needs action today", severity: "high" },
        { label: "unsure" },
      ],
    },
    {
      name: "frustration",
      type: "score",
      instructions: "How frustrated is the customer?",
      options: [
        { label: "calm", report: false },
        { label: "annoyed" },
        { label: "angry", severity: "critical" },
      ],
    },
  ],
  scope: { asset_kinds: ["record"], metadata: { doc_type: "ticket" } },
  budget: { max_attempts: 2 },
};

function problemsOf(draft: DecisionDraft): string[] {
  return draftProblems(draft).map((entry) =>
    entry.question === undefined
      ? entry.problem
      : `${entry.problem}@${entry.question}`,
  );
}

describe("decision detector kind", () => {
  it("resolves DECISION to its own editor, with nothing to train", () => {
    expect(resolveDetectorKind({ type: "DECISION" })).toBe("decision");
    expect(isNonTrainableKind("decision")).toBe(true);
    expect(isDecisionSchema({ type: "decision" })).toBe(true);
    expect(isDecisionSchema({ type: "LLM" })).toBe(false);
  });

  it("has a badge icon and a translated title", () => {
    expect(detectorTypeIconName(null, "DECISION")).toBe("Scale");
    expect(detectorTypeTranslationKey(null, "DECISION")).toBe(
      "detectors.types.decision.title",
    );
    expect(en.detectors.types.decision.title).toBeTruthy();
  });
});

describe("decision provider presets", () => {
  it("reads the preset off the model's provider prefix", () => {
    expect(providerIdForModel("typesafe/jev-latest")).toBe("typesafe");
    expect(providerIdForModel("openai/gpt-6-luna")).toBe("openai");
    expect(providerIdForModel("cloudflare/@cf/cloudflare/clef")).toBe(
      "cloudflare",
    );
    expect(providerIdForModel("openrouter/typesafe/jev-1.13")).toBe(
      "openrouter",
    );
    expect(providerIdForModel("strands_decider/local")).toBe("self_hosted");
    // Anything LiteLLM serves that has no preset is still a valid model.
    expect(providerIdForModel("databricks/openjev-qwen35")).toBe("other");
    expect(providerIdForModel("")).toBe("other");
  });

  it("names every preset and its hints in the translations", () => {
    for (const preset of DECISION_PROVIDER_PRESETS) {
      const copy = en.detectors.decision.providers[preset.id];
      expect(copy.name).toBeTruthy();
      expect(copy.hint).toBeTruthy();
      expect(copy.apiBaseHint).toBeTruthy();
      for (const model of preset.models) {
        expect(providerIdForModel(model)).toBe(preset.id);
      }
    }
  });

  it("clears the endpoint URL when the provider changes", () => {
    const draft = schemaToDraft(stored, ["api_key"]);
    const switched = withProvider(draft, "typesafe");
    expect(switched.model).toBe("typesafe/jev-latest");
    expect(switched.apiBase).toBe("");
    expect(withProvider(draft, "cloudflare")).toBe(draft);
    expect(withProvider(draft, "other").model).toBe("");
  });
});

describe("decision detector drafts", () => {
  it("starts a new detector on the first preset with one blank question", () => {
    const draft = schemaToDraft(undefined);
    expect(draft.providerId).toBe("typesafe");
    expect(draft.model).toBe("typesafe/jev-latest");
    expect(draft.severity).toBe("medium");
    expect(draft.hasStoredKey).toBe(false);
    expect(draft.questions).toEqual([blankQuestion("yes_no")]);
  });

  it("round-trips a stored schema without losing what the form does not edit", () => {
    const draft = schemaToDraft(stored, ["api_key"]);
    expect(draft.providerId).toBe("cloudflare");
    expect(draft.hasStoredKey).toBe(true);
    expect(draft.headers).toEqual([{ name: "x-team", value: "risk" }]);
    expect(draft.questions[1]!.options.map((option) => option.finding)).toEqual(
      ["none", "high", "default"],
    );

    const schema = draftToSchema(draft, stored);
    // The key was not touched, so no secrets patch is sent at all.
    expect(schema).not.toHaveProperty("secrets");
    expect(schema).toEqual(stored);
  });

  it("sends the API key only as a patch", () => {
    const draft = schemaToDraft(stored, ["api_key"]);

    expect(draftToSchema({ ...draft, apiKey: "cf-new" }, stored).secrets).toEqual(
      { api_key: "cf-new" },
    );
    expect(
      draftToSchema({ ...draft, removeStoredKey: true }, stored).secrets,
    ).toEqual({ api_key: null });
    // Nothing stored and nothing typed: nothing to remove.
    const fresh = schemaToDraft(stored, []);
    expect(
      draftToSchema({ ...fresh, removeStoredKey: true }, stored),
    ).not.toHaveProperty("secrets");
  });

  it("omits what was left blank and trims what was typed", () => {
    const draft = schemaToDraft(undefined);
    const schema = draftToSchema({
      ...draft,
      model: "  typesafe/jev-latest ",
      apiKey: "ts-key",
      headers: [{ name: "", value: "" }],
      questions: [
        {
          ...blankQuestion("yes_no"),
          name: " legal_threat ",
          instructions: " Is a lawsuit threatened? ",
        },
      ],
    });
    expect(schema).toEqual({
      type: "DECISION",
      model: "typesafe/jev-latest",
      severity: "medium",
      secrets: { api_key: "ts-key" },
      questions: [
        {
          name: "legal_threat",
          type: "yes_no",
          instructions: "Is a lawsuit threatened?",
        },
      ],
    });
  });

  it("keeps a question's wording and answers when its type changes", () => {
    const choice = schemaToDraft(stored).questions[1]!;
    const asScore = withQuestionType(choice, "score");
    expect(asScore.type).toBe("score");
    expect(asScore.instructions).toBe(choice.instructions);
    expect(asScore.options.map((option) => option.label)).toEqual([
      "low",
      "high",
      "unsure",
    ]);

    const asYesNo = withQuestionType(choice, "yes_no");
    expect(asYesNo.options).toEqual([]);
    expect(draftToSchema({ ...schemaToDraft(stored), questions: [asYesNo] })
      .questions).toEqual([
      { name: "urgency", type: "yes_no", instructions: "How urgent is this?" },
    ]);

    // From no answers at all: a starter scale whose lowest step is quiet.
    const fresh = withQuestionType(blankQuestion("yes_no"), "score");
    expect(fresh.options.map((option) => option.finding)).toEqual([
      "none",
      "default",
      "default",
    ]);
  });
});

describe("the stored key follows its endpoint", () => {
  it("normalises the endpoint the way the API does", () => {
    expect(decisionEndpointKey("TypeSafe/jev-latest", "")).toBe("typesafe|");
    expect(decisionEndpointKey("typesafe/jev-1.13.0", " ")).toBe("typesafe|");
    expect(decisionEndpointKey("openai/x", "https://Gateway.test/v1/")).toBe(
      "openai|https://gateway.test/v1",
    );
  });

  it("is kept across a model change within one provider", () => {
    const draft = schemaToDraft(stored, ["api_key"]);
    expect(storedKeyIsKept(draft)).toBe(true);
    expect(storedKeyIsKept({ ...draft, model: "cloudflare/clef-flash" })).toBe(
      true,
    );
  });

  it("is dropped when the provider or the URL changes, and the form asks again", () => {
    const draft = schemaToDraft(stored, ["api_key"]);
    const repointed = { ...draft, apiBase: "https://collector.example.test" };
    expect(storedKeyIsKept(repointed)).toBe(false);
    expect(problemsOf(repointed)).toContain("apiKeyMissing");
    expect(problemsOf({ ...repointed, apiKey: "cf-new" })).toEqual([]);

    const switched = withProvider(draft, "openai");
    expect(storedKeyIsKept(switched)).toBe(false);
    expect(problemsOf(switched)).toEqual(["apiKeyMissing"]);
  });
});

describe("decision detector validation", () => {
  const valid = () => schemaToDraft(stored, ["api_key"]);

  it("accepts a complete draft", () => {
    expect(problemsOf(valid())).toEqual([]);
  });

  it("requires what the chosen provider requires", () => {
    const fresh = schemaToDraft(undefined);
    // A hosted provider needs a key; the blank question needs a name and wording.
    expect(problemsOf(fresh)).toEqual([
      "apiKeyMissing",
      "questionName@0",
      "questionInstructions@0",
    ]);

    const selfHosted = withProvider(fresh, "self_hosted");
    expect(problemsOf(selfHosted)).toContain("apiBaseMissing");
    expect(problemsOf(selfHosted)).not.toContain("apiKeyMissing");

    const other = withProvider(fresh, "other");
    expect(problemsOf(other)).toContain("modelMissing");
  });

  it.each([
    ["jev-latest", "modelFormat"],
    ["typesafe/", "modelFormat"],
    ["typesafe/jev latest", "modelFormat"],
    ["", "modelMissing"],
  ])("refuses the model %p", (model, problem) => {
    expect(problemsOf({ ...valid(), model })).toContain(problem);
  });

  it("checks the endpoint, headers and content limit", () => {
    expect(problemsOf({ ...valid(), apiBase: "decider.internal" })).toContain(
      "apiBaseFormat",
    );
    expect(
      problemsOf({ ...valid(), headers: [{ name: "bad name", value: "x" }] }),
    ).toContain("headerName");
    expect(
      problemsOf({
        ...valid(),
        headers: [{ name: "Authorization", value: "Bearer x" }],
      }),
    ).toContain("headerName");
    // An untouched empty row is not a problem; it is simply not sent.
    expect(
      problemsOf({ ...valid(), headers: [{ name: "", value: "" }] }),
    ).toEqual([]);
    expect(problemsOf({ ...valid(), contentLimit: "0" })).toContain(
      "contentLimit",
    );
  });

  it("points each question problem at its question", () => {
    const draft = valid();
    draft.questions[0] = { ...draft.questions[0]!, threshold: "1.5" };
    draft.questions[1] = {
      ...draft.questions[1]!,
      name: "refund_request",
      options: [{ label: "only", description: "", finding: "default" }],
    };
    draft.questions[2] = {
      ...draft.questions[2]!,
      name: "has space",
      instructions: " ",
      options: [
        { label: "same", description: "", finding: "default" },
        { label: "same", description: "", finding: "default" },
      ],
    };
    expect(problemsOf(draft)).toEqual([
      "threshold@0",
      "duplicateQuestion@1",
      "optionCount@1",
      "questionName@2",
      "questionInstructions@2",
      "duplicateOption@2",
    ]);
  });

  it("holds a scale to ten levels and a detector to 64 questions", () => {
    const draft = valid();
    draft.questions[2] = {
      ...draft.questions[2]!,
      options: Array.from({ length: 11 }, (_, i) => ({
        label: `l${i}`,
        description: "",
        finding: "default" as const,
      })),
    };
    expect(problemsOf(draft)).toEqual(["optionCount@2"]);

    const many = {
      ...valid(),
      questions: Array.from({ length: 65 }, (_, i) => ({
        ...blankQuestion("yes_no"),
        name: `q${i}`,
        instructions: "Is it?",
      })),
    };
    expect(problemsOf(many)).toEqual(["tooManyQuestions"]);
  });
});

describe("what a question turns into", () => {
  it("lists the finding types an author will see", () => {
    const [yesNo, choice, score] = schemaToDraft(stored).questions;
    expect(questionFindingTypes(yesNo!)).toEqual(["refund_request"]);
    // "low" is set to No finding, so it never appears.
    expect(questionFindingTypes(choice!)).toEqual([
      "urgency:high",
      "urgency:unsure",
    ]);
    expect(questionFindingTypes(score!)).toEqual([
      "frustration:annoyed",
      "frustration:angry",
    ]);
    expect(questionFindingTypes(blankQuestion("yes_no"))).toEqual(["…"]);
  });

  it("suggests a finding name from the question", () => {
    expect(suggestQuestionName("Is the customer asking for a refund?")).toBe(
      "is_the_customer_asking",
    );
    expect(suggestQuestionName("3 Gründe?")).toBe("gr_nde");
    expect(suggestQuestionName("???")).toBe("");
  });
});
