/**
 * Decision detectors: the custom-detector pipeline type `DECISION`.
 *
 * A decision model answers typed questions about content with probabilities
 * instead of text. Pure translation between the stored pipeline schema and the
 * editor's form state lives here, out of the component, so the rules (the
 * write-only API key patch, preserved API-authored keys, what each provider
 * needs) are testable on their own.
 *
 * The scan reaches every provider through LiteLLM, so the one thing a detector
 * must say is a LiteLLM model name. The presets below only pre-fill that name
 * and say which other fields a provider needs; any other model LiteLLM serves
 * works by typing it.
 */
import { preserveDetectorScope } from "./detector-scope";

export const DECISION_PIPELINE_TYPE = "DECISION";

export const DECISION_QUESTION_TYPES = ["yes_no", "choice", "score"] as const;
export type DecisionQuestionType = (typeof DECISION_QUESTION_TYPES)[number];

export const DECISION_SEVERITIES = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
] as const;
export type DecisionSeverity = (typeof DECISION_SEVERITIES)[number];

/** [min, max] answers a question type takes on every provider. */
export const DECISION_OPTION_BOUNDS: Record<
  Exclude<DecisionQuestionType, "yes_no">,
  readonly [number, number]
> = {
  choice: [2, 255],
  score: [2, 10],
};
export const DECISION_MAX_QUESTIONS = 64;

const QUESTION_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const HEADER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
const RESERVED_HEADERS = new Set(["authorization", "content-type"]);

// ── Provider presets ────────────────────────────────────────────────────────

export type DecisionProviderId =
  | "typesafe"
  | "openai"
  | "cloudflare"
  | "perplexity"
  | "openrouter"
  | "self_hosted"
  | "other";

export interface DecisionProviderPreset {
  id: DecisionProviderId;
  /** LiteLLM provider prefix; null when the model is typed in full. */
  prefix: string | null;
  /** Model names offered as suggestions; the field stays free text. */
  models: string[];
  apiKey: "required" | "optional";
  /**
   * "required" when the provider has no endpoint of its own (self-hosted, or
   * Cloudflare, where the URL carries the account id). "optional" providers
   * have a default and take a URL only to go through a gateway.
   */
  apiBase: "optional" | "required";
  apiBasePlaceholder: string;
}

export const DECISION_PROVIDER_PRESETS: DecisionProviderPreset[] = [
  {
    id: "typesafe",
    prefix: "typesafe",
    models: ["typesafe/jev-latest", "typesafe/jev-1.13.0", "typesafe/jev-preview"],
    apiKey: "required",
    apiBase: "optional",
    apiBasePlaceholder: "https://api.typesafe.ai",
  },
  {
    id: "openai",
    prefix: "openai",
    models: ["openai/gpt-6-luna"],
    apiKey: "required",
    apiBase: "optional",
    apiBasePlaceholder: "https://api.openai.com",
  },
  {
    id: "cloudflare",
    prefix: "cloudflare",
    models: ["cloudflare/clef", "cloudflare/clef-flash"],
    apiKey: "required",
    // The account id is part of the URL, so there is no default to fall back on.
    apiBase: "required",
    apiBasePlaceholder:
      "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/run",
  },
  {
    id: "perplexity",
    prefix: "perplexity",
    models: ["perplexity/pplx-decider-v1-27b"],
    apiKey: "required",
    apiBase: "optional",
    apiBasePlaceholder: "https://api.perplexity.ai",
  },
  {
    id: "openrouter",
    prefix: "openrouter",
    // One OpenRouter key reaches every decision model it serves.
    models: [
      "openrouter/typesafe/jev-1.13",
      "openrouter/openai/gpt-6-luna-decisions",
      "openrouter/cloudflare/clef-flash",
      "openrouter/perplexity/pplx-decider-v1.1-27b",
      "openrouter/inception/mercury-decide",
    ],
    apiKey: "required",
    apiBase: "optional",
    apiBasePlaceholder: "https://openrouter.ai/api",
  },
  {
    // LiteLLM's keyless System One route: POST <API base>/v1/systemone. It
    // fits any server that speaks that contract, not only Strands Decider.
    id: "self_hosted",
    prefix: "strands_decider",
    models: ["strands_decider/strands-decider-2B-hobson-v19"],
    apiKey: "optional",
    apiBase: "required",
    apiBasePlaceholder: "http://decider.internal:8080",
  },
  {
    id: "other",
    prefix: null,
    models: [],
    apiKey: "optional",
    apiBase: "optional",
    apiBasePlaceholder: "https://",
  },
];

export function decisionProviderPreset(
  id: DecisionProviderId,
): DecisionProviderPreset {
  return (
    DECISION_PROVIDER_PRESETS.find((preset) => preset.id === id) ??
    DECISION_PROVIDER_PRESETS[DECISION_PROVIDER_PRESETS.length - 1]!
  );
}

/** Which preset a stored model belongs to, read off its provider prefix. */
export function providerIdForModel(model: string): DecisionProviderId {
  const prefix = model.trim().split("/", 1)[0]?.toLowerCase() ?? "";
  const match = DECISION_PROVIDER_PRESETS.find(
    (preset) => preset.prefix !== null && preset.prefix === prefix,
  );
  return match?.id ?? "other";
}

// ── Draft ───────────────────────────────────────────────────────────────────

/** What an answer does: nothing, a finding at the question's severity, or its own. */
export type OptionFinding = "none" | "default" | DecisionSeverity;

export interface DecisionOptionDraft {
  label: string;
  description: string;
  finding: OptionFinding;
}

export interface DecisionQuestionDraft {
  name: string;
  type: DecisionQuestionType;
  instructions: string;
  /** "" inherits the detector's default severity. */
  severity: DecisionSeverity | "";
  /** "" uses the question type's default. */
  threshold: string;
  options: DecisionOptionDraft[];
}

export interface HeaderDraft {
  name: string;
  value: string;
}

export interface DecisionDraft {
  providerId: DecisionProviderId;
  model: string;
  apiBase: string;
  /** A newly typed key. Blank leaves the stored one alone. */
  apiKey: string;
  hasStoredKey: boolean;
  /**
   * The endpoint the stored key was entered for. The API drops a stored key
   * when the endpoint changes, so the form has to know when that will happen.
   */
  storedEndpoint: string | null;
  /** Delete the stored key on save (only meaningful when apiKey is blank). */
  removeStoredKey: boolean;
  headers: HeaderDraft[];
  severity: DecisionSeverity;
  contentLimit: string;
  questions: DecisionQuestionDraft[];
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asSeverity(value: unknown): DecisionSeverity | "" {
  return (DECISION_SEVERITIES as readonly string[]).includes(String(value))
    ? (value as DecisionSeverity)
    : "";
}

export function isDecisionSchema(schema: unknown): boolean {
  return (
    isRecord(schema) &&
    typeof schema.type === "string" &&
    schema.type.toUpperCase() === DECISION_PIPELINE_TYPE
  );
}

/**
 * What a key is bound to: the provider and the URL it is sent to. Mirrors
 * decisionEndpointKey in the API, which drops a stored key when this changes
 * so that pointing a detector somewhere else can never ship an old key there.
 */
export function decisionEndpointKey(model: string, apiBase: string): string {
  const provider = model.trim().split("/", 1)[0]?.toLowerCase() ?? "";
  const base = apiBase.trim().replace(/\/+$/, "").toLowerCase();
  return `${provider}|${base}`;
}

/** Whether the stored key survives this save. */
export function storedKeyIsKept(draft: DecisionDraft): boolean {
  return (
    draft.hasStoredKey &&
    !draft.removeStoredKey &&
    draft.storedEndpoint === decisionEndpointKey(draft.model, draft.apiBase)
  );
}

export function blankOption(finding: OptionFinding = "default"): DecisionOptionDraft {
  return { label: "", description: "", finding };
}

/**
 * A new question of a type, shaped so it is nearly valid as it stands: a
 * choice gets two answers, a score gets a three-step scale whose lowest step
 * is the quiet one.
 */
export function blankQuestion(type: DecisionQuestionType): DecisionQuestionDraft {
  const options =
    type === "choice"
      ? [blankOption(), blankOption()]
      : type === "score"
        ? [blankOption("none"), blankOption(), blankOption()]
        : [];
  return { name: "", type, instructions: "", severity: "", threshold: "", options };
}

function optionToDraft(raw: unknown): DecisionOptionDraft {
  const option = isRecord(raw) ? raw : {};
  const severity = asSeverity(option.severity);
  return {
    label: typeof option.label === "string" ? option.label : "",
    description: typeof option.description === "string" ? option.description : "",
    finding: option.report === false ? "none" : severity || "default",
  };
}

function questionToDraft(raw: unknown): DecisionQuestionDraft {
  const question = isRecord(raw) ? raw : {};
  const type = (DECISION_QUESTION_TYPES as readonly string[]).includes(
    String(question.type),
  )
    ? (question.type as DecisionQuestionType)
    : "yes_no";
  return {
    name: typeof question.name === "string" ? question.name : "",
    type,
    instructions:
      typeof question.instructions === "string" ? question.instructions : "",
    severity: asSeverity(question.severity),
    threshold:
      typeof question.threshold === "number" ? String(question.threshold) : "",
    options:
      type !== "yes_no" && Array.isArray(question.options)
        ? question.options.map(optionToDraft)
        : [],
  };
}

export function schemaToDraft(
  schema: Json | null | undefined,
  secretKeys: string[] = [],
): DecisionDraft {
  const source = isRecord(schema) ? schema : {};
  const model = typeof source.model === "string" ? source.model : "";
  const headers = isRecord(source.extra_headers)
    ? Object.entries(source.extra_headers).map(([name, value]) => ({
        name,
        value: typeof value === "string" ? value : "",
      }))
    : [];
  const questions = Array.isArray(source.questions)
    ? source.questions.map(questionToDraft)
    : [];
  const apiBase = typeof source.api_base === "string" ? source.api_base : "";
  const hasStoredKey = secretKeys.includes("api_key");
  return {
    // A brand-new detector starts on the first preset; a stored one shows the
    // preset its model belongs to.
    providerId: model
      ? providerIdForModel(model)
      : DECISION_PROVIDER_PRESETS[0]!.id,
    model: model || DECISION_PROVIDER_PRESETS[0]!.models[0]!,
    apiBase,
    apiKey: "",
    hasStoredKey,
    storedEndpoint: hasStoredKey ? decisionEndpointKey(model, apiBase) : null,
    removeStoredKey: false,
    headers,
    severity: asSeverity(source.severity) || "medium",
    contentLimit:
      typeof source.content_limit === "number" ? String(source.content_limit) : "",
    questions: questions.length > 0 ? questions : [blankQuestion("yes_no")],
  };
}

/**
 * Switch provider: move to the preset's first model and clear the endpoint
 * URL, which belonged to the provider being left.
 */
export function withProvider(
  draft: DecisionDraft,
  providerId: DecisionProviderId,
): DecisionDraft {
  if (providerId === draft.providerId) return draft;
  const preset = decisionProviderPreset(providerId);
  return {
    ...draft,
    providerId,
    model: preset.models[0] ?? "",
    apiBase: "",
  };
}

/** Change a question's type, keeping its wording and giving it fitting answers. */
export function withQuestionType(
  question: DecisionQuestionDraft,
  type: DecisionQuestionType,
): DecisionQuestionDraft {
  if (type === question.type) return question;
  const fresh = blankQuestion(type);
  const kept =
    type !== "yes_no" && question.options.length > 0
      ? question.options.slice(0, DECISION_OPTION_BOUNDS[type][1])
      : fresh.options;
  return { ...question, type, threshold: "", options: type === "yes_no" ? [] : kept };
}

function optionToSchema(option: DecisionOptionDraft): Json {
  const out: Json = { label: option.label.trim() };
  if (option.description.trim()) out.description = option.description.trim();
  if (option.finding === "none") out.report = false;
  else if (option.finding !== "default") out.severity = option.finding;
  return out;
}

function questionToSchema(question: DecisionQuestionDraft): Json {
  const out: Json = {
    name: question.name.trim(),
    type: question.type,
    instructions: question.instructions.trim(),
  };
  if (question.type !== "yes_no") {
    out.options = question.options.map(optionToSchema);
  }
  if (question.severity) out.severity = question.severity;
  const threshold = parseThreshold(question.threshold);
  if (threshold !== undefined && threshold !== null) out.threshold = threshold;
  return out;
}

/** undefined when blank, null when not a number in [0, 1]. */
function parseThreshold(value: string): number | null | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function parseContentLimit(value: string): number | null | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

/**
 * The pipeline schema to send. `existing` supplies what this form does not
 * edit (scope, budget), so saving never drops what an API client set.
 *
 * The API key goes as a patch: a typed key sets it, "remove" sends null, and
 * leaving the field alone omits `secrets` so the stored key is kept.
 */
export function draftToSchema(draft: DecisionDraft, existing?: Json | null): Json {
  const schema: Json = {
    type: DECISION_PIPELINE_TYPE,
    model: draft.model.trim(),
    severity: draft.severity,
    questions: draft.questions.map(questionToSchema),
  };
  const apiBase = draft.apiBase.trim();
  if (apiBase) schema.api_base = apiBase;

  const headers: Record<string, string> = {};
  for (const header of draft.headers) {
    if (header.name.trim()) headers[header.name.trim()] = header.value;
  }
  if (Object.keys(headers).length > 0) schema.extra_headers = headers;

  const contentLimit = parseContentLimit(draft.contentLimit);
  if (contentLimit) schema.content_limit = contentLimit;

  if (draft.apiKey) schema.secrets = { api_key: draft.apiKey };
  else if (draft.removeStoredKey && draft.hasStoredKey) {
    schema.secrets = { api_key: null };
  }
  return preserveDetectorScope(isRecord(existing) ? existing : undefined, schema);
}

// ── Validation ──────────────────────────────────────────────────────────────

export type DecisionProblem =
  | "modelMissing"
  | "modelFormat"
  | "apiKeyMissing"
  | "apiBaseMissing"
  | "apiBaseFormat"
  | "headerName"
  | "contentLimit"
  | "noQuestions"
  | "tooManyQuestions"
  | "questionName"
  | "duplicateQuestion"
  | "questionInstructions"
  | "optionCount"
  | "optionLabel"
  | "duplicateOption"
  | "threshold";

export interface DecisionProblemAt {
  problem: DecisionProblem;
  /** Index of the question it belongs to; absent for detector-level problems. */
  question?: number;
}

/** What stops a save, in the order the author meets the fields. */
export function draftProblems(draft: DecisionDraft): DecisionProblemAt[] {
  const problems: DecisionProblemAt[] = [];
  const preset = decisionProviderPreset(draft.providerId);

  const model = draft.model.trim();
  const slash = model.indexOf("/");
  if (!model) problems.push({ problem: "modelMissing" });
  else if (slash <= 0 || slash === model.length - 1 || /\s/.test(model)) {
    problems.push({ problem: "modelFormat" });
  }

  const keyWillExist = draft.apiKey.length > 0 || storedKeyIsKept(draft);
  if (preset.apiKey === "required" && !keyWillExist) {
    problems.push({ problem: "apiKeyMissing" });
  }

  const apiBase = draft.apiBase.trim();
  if (preset.apiBase === "required" && !apiBase) {
    problems.push({ problem: "apiBaseMissing" });
  } else if (apiBase && !/^https?:\/\/[^\s/]+\S*$/i.test(apiBase)) {
    problems.push({ problem: "apiBaseFormat" });
  }

  if (
    draft.headers.some(
      (header) =>
        (header.name.trim() || header.value.trim()) &&
        (!HEADER_NAME_PATTERN.test(header.name.trim()) ||
          RESERVED_HEADERS.has(header.name.trim().toLowerCase())),
    )
  ) {
    problems.push({ problem: "headerName" });
  }
  if (parseContentLimit(draft.contentLimit) === null) {
    problems.push({ problem: "contentLimit" });
  }

  if (draft.questions.length === 0) problems.push({ problem: "noQuestions" });
  if (draft.questions.length > DECISION_MAX_QUESTIONS) {
    problems.push({ problem: "tooManyQuestions" });
  }

  const names = draft.questions.map((question) => question.name.trim());
  draft.questions.forEach((question, index) => {
    const at = (problem: DecisionProblem) => problems.push({ problem, question: index });
    const name = names[index]!;
    if (!QUESTION_NAME_PATTERN.test(name)) at("questionName");
    else if (names.indexOf(name) !== index) at("duplicateQuestion");
    if (!question.instructions.trim()) at("questionInstructions");
    if (parseThreshold(question.threshold) === null) at("threshold");

    if (question.type === "yes_no") return;
    const [min, max] = DECISION_OPTION_BOUNDS[question.type];
    if (question.options.length < min || question.options.length > max) {
      at("optionCount");
    }
    const labels = question.options.map((option) => option.label.trim());
    if (labels.some((label) => !label)) at("optionLabel");
    else if (new Set(labels).size !== labels.length) at("duplicateOption");
  });
  return problems;
}

/**
 * The finding types a question can produce, so the form can show an author
 * exactly what will appear in the findings list before anything is scanned.
 */
export function questionFindingTypes(question: DecisionQuestionDraft): string[] {
  const name = question.name.trim() || "…";
  if (question.type === "yes_no") return [name];
  return question.options
    .filter((option) => option.finding !== "none" && option.label.trim())
    .map((option) => `${name}:${option.label.trim()}`);
}

/** A question name suggested from its instructions, for when none is typed. */
export function suggestQuestionName(instructions: string): string {
  const slug = instructions
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "");
  return slug.split("_").slice(0, 4).join("_").slice(0, 64);
}
