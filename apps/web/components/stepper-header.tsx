"use client";

import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { aiAccentBase, aiAccentHoverYellow } from "@/lib/ai-styles";

interface StepItem<TStepId extends string = string> {
  id: TStepId;
  title: string;
  description: string;
}

interface StepperHeaderProps<TStepId extends string> {
  steps: StepItem<TStepId>[];
  currentIndex: number;
  canNavigateToDetectors: boolean;
  onNavigate: (stepId: TStepId) => void;
}

export function StepperHeader<TStepId extends string>({
  steps,
  currentIndex,
  canNavigateToDetectors,
  onNavigate,
}: StepperHeaderProps<TStepId>) {
  return (
    <ol className="grid gap-3 md:grid-cols-2">
      {steps.map((step, index) => {
        const isActive = currentIndex === index;
        const isComplete = currentIndex > index;
        const status = isComplete ? "done" : isActive ? "active" : "locked";
        const canNavigate =
          step.id === "detectors" ? canNavigateToDetectors || isActive : true;

        return (
          <li key={step.id}>
            <Button
              type="button"
              variant="ghost"
              disabled={!canNavigate}
              onClick={() => onNavigate(step.id)}
              className={cn(
                "h-auto w-full items-start justify-start gap-4 rounded-[4px] border-2 border-black px-4 py-3 text-left shadow-[4px_4px_0_#000]",
                status === "active" && cn(aiAccentBase, aiAccentHoverYellow),
                status === "done" && "bg-black text-white",
                status === "locked" && "bg-muted/20",
                !canNavigate && "opacity-60",
              )}
            >
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-semibold uppercase tracking-[0.04em]">
                  {step.title}
                </div>
                <div className="text-xs opacity-70">{step.description}</div>
              </div>
            </Button>
          </li>
        );
      })}
    </ol>
  );
}
