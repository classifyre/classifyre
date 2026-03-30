import assistantKnowledge from "@workspace/schemas/assistant_knowledge";

export type KnowledgeSection = {
  title: string;
  summary?: string;
  suggestions?: string[];
  questions?: string[];
};

type SourceKnowledge = {
  sections: Record<string, KnowledgeSection>;
};

type DetectorKnowledge = KnowledgeSection;

type ScheduleKnowledge = KnowledgeSection & {
  presets?: Record<string, string>;
};

type KnowledgeRegistry = {
  sources: Record<string, SourceKnowledge>;
  detectors: Record<string, DetectorKnowledge>;
  schedule?: ScheduleKnowledge;
};

const registry = assistantKnowledge as KnowledgeRegistry;

export function getSourceSectionKnowledge(
  sourceType: string,
  sectionKey: string,
): KnowledgeSection | null {
  const source = registry.sources[sourceType];
  if (!source) return null;
  return source.sections[sectionKey] ?? null;
}

export function getDetectorKnowledge(
  detectorType: string,
): KnowledgeSection | null {
  return registry.detectors[detectorType] ?? null;
}

export function getScheduleKnowledge():
  | (KnowledgeSection & { presets?: Record<string, string> })
  | null {
  return registry.schedule ?? null;
}

export function buildSourcePrompt({
  sourceType,
  sectionKey,
  schema,
  summary,
  suggestions,
  questions,
}: {
  sourceType: string;
  sectionKey: string;
  schema: Record<string, unknown>;
  summary?: string;
  suggestions: string[];
  questions?: string[];
}) {
  const sectionLabel = sectionKey.toUpperCase();
  const schemaSnippet = JSON.stringify(schema, null, 2);
  return [
    `You are helping configure ${sourceType} sources.`,
    `Section: ${sectionLabel}.`,
    summary ? `Context: ${summary}` : "",
    suggestions.length > 0 ? `Suggestions: ${suggestions.join(" | ")}` : "",
    questions && questions.length > 0
      ? `Example questions: ${questions.join(" | ")}`
      : "",
    `Schema: ${schemaSnippet}`,
  ]
    .filter(Boolean)
    .join("\n");
}
