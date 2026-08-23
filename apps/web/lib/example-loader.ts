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

/**
 * True for an example that only works on the machine running the app.
 *
 * Detected from the config it ships rather than by name: an example that
 * configures `local_folders` points at an absolute path on local disk, which a
 * browser tab talking to a Kubernetes cluster does not have — and the API
 * refuses to store those paths there anyway.
 */
export function isDesktopOnlyExample(example: SourceExample): boolean {
  const optional = (example.config as { optional?: unknown })?.optional as
    | { local_folders?: unknown }
    | undefined;
  return (
    Array.isArray(optional?.local_folders) && optional.local_folders.length > 0
  );
}
