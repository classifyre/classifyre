// Re-export all types from generated models
export * from "./generated/src/models";

// Source configuration type (matches JSON schema structure)
export type SourceConfig = Record<string, unknown>;

// Training examples (not yet in generated client — added manually)
export interface TrainingExampleDto {
  id: string;
  customDetectorId: string;
  label: string;
  text: string;
  value?: string | null;
  accepted: boolean;
  source?: string | null;
  createdAt: string;
}

export interface TrainingExampleItem {
  label: string;
  text: string;
  value?: string;
  accepted: boolean;
  source?: string;
}

export interface TrainingExamplesStatsDto {
  total: number;
  byLabel: Record<string, { positive: number; negative: number }>;
}
