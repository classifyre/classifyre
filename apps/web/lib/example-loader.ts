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

export interface AugmentationTemplate {
  name: string;
  description: string;
  notebook: {
    revision?: number;
    cells: Array<{ id: string; type: string; source: string }>;
  };
}

export function getSourceExamples(sourceType: SourceType): SourceExample[] {
  // AUGMENTATION templates are notebook fragments, not source configs — they
  // are read by getAugmentationTemplates, not here.
  const examplesByType = {
    ...(all_input_examples as unknown as Record<string, SourceExample[]>),
  };
  delete (examplesByType as Record<string, unknown>)["AUGMENTATION"];
  return examplesByType[sourceType] || [];
}

export function getAugmentationTemplates(): AugmentationTemplate[] {
  const examples = all_input_examples as unknown as {
    AUGMENTATION?: AugmentationTemplate[];
  };
  return examples.AUGMENTATION ?? [];
}
