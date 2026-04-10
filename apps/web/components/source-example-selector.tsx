"use client";

import { Badge, Card } from "@workspace/ui/components";
import { FileText, Sparkles } from "lucide-react";
import { AiAssistedCard } from "@/components/ai-assisted-card";
import type { SourceType } from "@/components/source-form";
import { cn } from "@workspace/ui/lib/utils";
import type { SourceExample } from "@/lib/example-loader";
import { useTranslation } from "@/hooks/use-translation";

interface SourceExampleSelectorProps {
  selectedSourceType: SourceType;
  examples: SourceExample[];
  onSelectExample: (example: SourceExample) => void;
  onStartBlank: () => void;
}

export function SourceExampleSelector({
  selectedSourceType,
  examples,
  onSelectExample,
  onStartBlank,
}: SourceExampleSelectorProps) {
  const { t } = useTranslation();
  return (
    <AiAssistedCard
      title={t("ai.assistantQuickStart")}
      description={t("ai.assistantQuickStartDesc")}
    >
      <div className="space-y-4">
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
                <div className="text-sm font-semibold">{t("ai.startBlank")}</div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {t("ai.startBlankDescription")}
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
                    {t("ai.template")}
                  </Badge>
                </div>
                <div className="mt-3">
                  <div className="text-sm font-semibold">{example.name}</div>
                  <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {example.description || "Suggested starter configuration"}
                  </div>
                </div>
              </Card>
            </button>
          ))}
        </div>

        {examples.length === 0 ? (
          <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
            {t("ai.noTemplatesAvailable")}
          </p>
        ) : null}
      </div>
    </AiAssistedCard>
  );
}
