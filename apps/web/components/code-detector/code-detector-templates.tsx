"use client";

import * as React from "react";
import { api } from "@workspace/api-client";
import { Code2, Loader2 } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";
import { isCodeDetectorSchema } from "@/lib/code-detector";

export interface CodeDetectorTemplate {
  name: string;
  description: string;
  key?: string;
  /** The template's detector description (what a finding means). */
  detectorDescription?: string;
  pipelineSchema: Record<string, unknown>;
  testScenarios: Array<Record<string, unknown>>;
}

/**
 * The shipped code-detector templates: the starter plus the worked rules
 * (row integrity, list screening, co-occurrence, metadata threshold, bring
 * your own model). Served by the API from all_detectors_examples.json, the
 * same catalogue the MCP tools read, and each carries its test scenarios.
 */
export function CodeDetectorTemplates({
  onPick,
}: {
  onPick: (template: CodeDetectorTemplate) => void;
}) {
  const { t } = useTranslation();
  const [templates, setTemplates] = React.useState<CodeDetectorTemplate[] | null>(
    null,
  );

  React.useEffect(() => {
    let active = true;
    api.customDetectors
      .customDetectorsControllerListExamples()
      .then((examples) => {
        if (!active) return;
        setTemplates(
          examples
            .map((example) => {
              // The examples endpoint returns the whole detector config under
              // `pipelineSchema`; the engine schema sits one level down.
              const config = (example.pipelineSchema ?? {}) as Record<string, unknown>;
              const schema = (config.pipeline_schema ?? {}) as Record<string, unknown>;
              return {
                name: example.name,
                description: example.description,
                key: example.key,
                detectorDescription:
                  typeof config.description === "string" ? config.description : undefined,
                pipelineSchema: schema,
                testScenarios: (example.testScenarios ?? []) as Array<
                  Record<string, unknown>
                >,
              };
            })
            .filter((template) => isCodeDetectorSchema(template.pipelineSchema)),
        );
      })
      .catch(() => active && setTemplates([]));
    return () => {
      active = false;
    };
  }, []);

  if (templates === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("detectors.code.templatesLoading")}
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="code-detector-templates">
      <p className="text-sm text-muted-foreground">
        {t("detectors.code.templatesHint")}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <button
            key={template.key ?? template.name}
            type="button"
            onClick={() => onPick(template)}
            data-testid={`code-template-${template.key ?? template.name}`}
            className="flex flex-col items-start rounded-[6px] border-2 border-border bg-background p-4 text-left transition-all hover:-translate-y-0.5"
          >
            <div className="mb-2 flex items-center gap-2">
              <Code2 className="h-4 w-4 text-muted-foreground" />
              <span className="font-serif text-sm font-black uppercase tracking-[0.06em]">
                {template.name}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {template.description}
            </p>
            {template.testScenarios.length > 0 ? (
              <span className="mt-3 rounded-[3px] border border-border/30 bg-foreground/5 px-1.5 py-0.5 font-mono text-[10px]">
                {t("detectors.code.templatesScenarios", {
                  count: template.testScenarios.length,
                })}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
