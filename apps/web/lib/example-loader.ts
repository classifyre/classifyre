import type { SourceType } from "@/components/source-form";
import all_input_examples from "@workspace/schemas/all_input_examples";

export interface SourceExampleSchedule {
  enabled: boolean;
  preset: string;
  cron: string;
  timezone: string;
}

export interface SourceExample {
  name: string;
  description: string;
  schedule?: SourceExampleSchedule;
  config: Record<string, unknown>;
}

export function getSourceExamples(sourceType: SourceType): SourceExample[] {
  const examplesByType = all_input_examples as Record<string, SourceExample[]>;
  return examplesByType[sourceType] || [];
}
