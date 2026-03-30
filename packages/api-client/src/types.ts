// Re-export all types from generated models
export * from "./generated/src/models";

// Source configuration type (matches JSON schema structure)
export type SourceConfig = Record<string, unknown>;
