"use client";

import { FileText, Sparkles } from "lucide-react";
import { Badge, Card } from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { getDetectorExamples, type DetectorExample } from "@/lib/detector-examples-loader";
import { useTranslation } from "@/hooks/use-translation";
import { type TransformerPipelineType } from "@/components/transformer-detector-editor";

export function TransformerExampleSelector({
  pipelineType,
  onStartBlank,
  onSelectExample,
}: {
  pipelineType: TransformerPipelineType;
  onStartBlank: () => void;
  onSelectExample: (example: DetectorExample) => void;
}) {
  const { t } = useTranslation();
  const examples = getDetectorExamples("CUSTOM").filter((ex) => {
    const ps = (ex.config as Record<string, unknown>)?.pipeline_schema as
      | Record<string, unknown>
      | undefined;
    return ps?.type === pipelineType;
  });

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <button
        type="button"
        onClick={onStartBlank}
        data-testid="start-blank"
        className={cn(
          "group text-left rounded-[6px]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2",
        )}
      >
        <Card clickable className="h-full p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] border-2 border-black bg-card">
              <FileText className="h-4 w-4" />
            </div>
            <Badge className="rounded-[4px] border border-black bg-[#b7ff00] text-black">
              {t("ai.start")}
            </Badge>
          </div>
          <div className="mt-3">
            <div className="text-sm font-semibold">{t("detectors.startBlank")}</div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("detectors.startBlankDesc")}
            </div>
          </div>
        </Card>
      </button>

      {examples.map((example, index) => (
        <button
          key={`${example.name}-${index}`}
          type="button"
          onClick={() => onSelectExample(example)}
          className={cn(
            "group text-left rounded-[6px]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2",
          )}
        >
          <Card
            clickable
            className="h-full border-black bg-background p-4 shadow-[4px_4px_0_#000]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] border-2 border-black bg-card">
                <Sparkles className="h-4 w-4" />
              </div>
              <Badge
                variant="outline"
                className="rounded-[4px] border-black text-[10px]"
              >
                {t("detectors.templateBadge")}
              </Badge>
            </div>
            <div className="mt-3">
              <div className="text-sm font-semibold">{example.name}</div>
              <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {example.description || t("ai.startBlankDescription")}
              </div>
            </div>
          </Card>
        </button>
      ))}
    </div>
  );
}
