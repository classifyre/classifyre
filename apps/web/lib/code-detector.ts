/**
 * Code detectors: the custom-detector pipeline type `CODE_DETECTOR`.
 *
 * Pure translation between the stored pipeline schema and the editor's form
 * state, kept out of the component so the rules (secret patches, preserved
 * API-authored keys, the detect() contract) are testable on their own.
 */
import type { KeyValueEntry } from "./key-value";
import {
  entriesToRecord,
  recordToEntries,
  secretEntriesToPatch,
  secretKeysToEntries,
} from "./key-value";
import { definesFunction, type NotebookCell } from "./notebook-cells";
import { packagesToConfig, type NotebookPackage } from "./notebook-packages";

export const CODE_DETECTOR_PIPELINE_TYPE = "CODE_DETECTOR";

export const CODE_DETECTOR_FIELD_TYPES = [
  "string",
  "number",
  "boolean",
  "date",
  "list[string]",
  "list[number]",
] as const;
export type CodeDetectorFieldType = (typeof CODE_DETECTOR_FIELD_TYPES)[number];

export const CODE_DETECTOR_CATEGORIES = [
  "QUALITY",
  "COMPLIANCE",
  "PRIVACY",
  "SECURITY",
  "CONTENT",
  "CLASSIFICATION",
  "THREAT",
  "FAIRNESS",
] as const;

export const SEVERITY_CEILINGS = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
] as const;
export type SeverityCeiling = (typeof SEVERITY_CEILINGS)[number];

export const ASSET_KINDS = [
  "record",
  "document",
  "page",
  "file",
  "table",
] as const;

export interface OutputFieldDraft {
  name: string;
  type: CodeDetectorFieldType;
  description: string;
}

export interface CodeDetectorDraft {
  cells: NotebookCell[];
  revision: number;
  packages: NotebookPackage[];
  variables: KeyValueEntry[];
  secrets: KeyValueEntry[];
  originalSecretKeys: string[];
  fields: OutputFieldDraft[];
  severity: SeverityCeiling;
  category: string;
  deterministic: boolean;
  needsFindings: boolean;
  perAssetTimeoutSeconds: string;
  maxFindingsPerAsset: string;
  assetKinds: string[];
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isCodeDetectorSchema(schema: unknown): boolean {
  return (
    isRecord(schema) &&
    typeof schema.type === "string" &&
    schema.type.toUpperCase() === CODE_DETECTOR_PIPELINE_TYPE
  );
}

export function schemaToDraft(
  schema: Json | null | undefined,
  secretKeys: string[] = [],
  fallbackCells: NotebookCell[] = [],
): CodeDetectorDraft {
  const source = isRecord(schema) ? schema : {};
  const notebook = isRecord(source.notebook) ? source.notebook : {};
  const cells = Array.isArray(notebook.cells)
    ? (notebook.cells as NotebookCell[])
    : fallbackCells;
  const limits = isRecord(source.limits) ? source.limits : {};
  const scope = isRecord(source.scope) ? source.scope : {};
  const severity = (SEVERITY_CEILINGS as readonly string[]).includes(
    String(source.severity),
  )
    ? (source.severity as SeverityCeiling)
    : "medium";
  return {
    cells,
    revision: Number.isInteger(notebook.revision)
      ? (notebook.revision as number)
      : 1,
    packages: Array.isArray(source.packages)
      ? (source.packages as NotebookPackage[])
      : [],
    variables: recordToEntries(
      isRecord(source.variables)
        ? (source.variables as Record<string, string>)
        : undefined,
    ),
    secrets: secretKeysToEntries(secretKeys),
    originalSecretKeys: secretKeys,
    fields: Array.isArray(source.fields)
      ? (source.fields as Json[]).map((field) => ({
          name: String(field.name ?? ""),
          type: (CODE_DETECTOR_FIELD_TYPES as readonly string[]).includes(
            String(field.type),
          )
            ? (field.type as CodeDetectorFieldType)
            : "string",
          description: String(field.description ?? ""),
        }))
      : [],
    severity,
    category:
      typeof source.category === "string" ? source.category : "QUALITY",
    deterministic: source.deterministic !== false,
    needsFindings: source.needs_findings === true,
    perAssetTimeoutSeconds:
      typeof limits.per_asset_timeout_seconds === "number"
        ? String(limits.per_asset_timeout_seconds)
        : "",
    maxFindingsPerAsset:
      typeof limits.max_findings_per_asset === "number"
        ? String(limits.max_findings_per_asset)
        : "",
    assetKinds: Array.isArray(scope.asset_kinds)
      ? (scope.asset_kinds as string[])
      : [],
  };
}

function positiveInt(value: string): number | undefined {
  const parsed = Number(value.trim());
  return value.trim() && Number.isInteger(parsed) && parsed > 0
    ? parsed
    : undefined;
}

/**
 * The pipeline schema to send. `existing` supplies what this form does not
 * edit (budget, the scope's content types and metadata predicate, other
 * limits), so saving never drops what an API client or the assistant set.
 * Secrets go as a patch: untouched ones are omitted, removed ones are null.
 */
export function draftToSchema(
  draft: CodeDetectorDraft,
  existing?: Json | null,
): Json {
  const previous = isRecord(existing) ? existing : {};
  const limits: Json = isRecord(previous.limits) ? { ...previous.limits } : {};
  const timeout = positiveInt(draft.perAssetTimeoutSeconds);
  const maxFindings = positiveInt(draft.maxFindingsPerAsset);
  if (timeout) limits.per_asset_timeout_seconds = timeout;
  else delete limits.per_asset_timeout_seconds;
  if (maxFindings) limits.max_findings_per_asset = maxFindings;
  else delete limits.max_findings_per_asset;

  const scope: Json = isRecord(previous.scope) ? { ...previous.scope } : {};
  if (draft.assetKinds.length > 0) scope.asset_kinds = draft.assetKinds;
  else delete scope.asset_kinds;

  const schema: Json = {
    type: CODE_DETECTOR_PIPELINE_TYPE,
    notebook: { revision: draft.revision, cells: draft.cells },
    packages: packagesToConfig(draft.packages),
    variables: entriesToRecord(draft.variables),
    fields: draft.fields
      .filter((field) => field.name.trim())
      .map((field) => ({
        name: field.name.trim(),
        type: field.type,
        ...(field.description.trim()
          ? { description: field.description.trim() }
          : {}),
      })),
    severity: draft.severity,
    category: draft.category,
    deterministic: draft.deterministic,
    needs_findings: draft.needsFindings,
  };
  const secrets = secretEntriesToPatch(draft.secrets, draft.originalSecretKeys);
  if (Object.keys(secrets).length > 0) schema.secrets = secrets;
  if (Object.keys(limits).length > 0) schema.limits = limits;
  schema.scope = Object.keys(scope).length > 0 ? scope : null;
  if (previous.budget !== undefined) schema.budget = previous.budget;
  return schema;
}

export type DraftProblem =
  | "missingDetect"
  | "fieldName"
  | "duplicateField";

/** What stops a save, in the order the author should fix it. */
export function draftProblems(draft: CodeDetectorDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (
    !draft.cells.some(
      (cell) => cell.type === "code" && definesFunction(cell.source, "detect"),
    )
  ) {
    problems.push("missingDetect");
  }
  const names = draft.fields.map((field) => field.name.trim()).filter(Boolean);
  if (names.some((name) => !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name))) {
    problems.push("fieldName");
  }
  if (new Set(names).size !== names.length) problems.push("duplicateField");
  return problems;
}

/** A starter fixture for a scenario, so the author edits instead of types. */
export const SAMPLE_ASSET_FIXTURE = {
  name: "sample.csv",
  kind: "table",
  mime_type: "text/csv",
  metadata: {},
  rows: [{ id: 1, a: 1, b: 2, total: 3 }],
};
