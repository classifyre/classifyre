"use client";

import { defineStepper } from "@stepperize/react";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { aiAccentBase, aiAccentHoverYellow } from "@/lib/ai-styles";
import { useTranslation } from "@/hooks/use-translation";

export const sandboxStepper = defineStepper(
  {
    id: "upload",
    title: "sandbox.uploadFiles",
    description: "sandbox.uploadFilesDesc",
  },
  {
    id: "detectors",
    title: "sandbox.detectors",
    description: "sandbox.detectorsDesc",
  },
);

export function SandboxStepperHeader({
  canNavigateToDetectors,
}: {
  canNavigateToDetectors: boolean;
}) {
  const { t } = useTranslation();
  const stepper = sandboxStepper.useStepper();
  const currentIndex = stepper.state.current.index;

  return (
    <ol className="grid gap-3 md:grid-cols-2">
      {sandboxStepper.steps.map((step, index) => {
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
              onClick={() => stepper.navigation.goTo(step.id)}
              className={cn(
                "h-auto w-full items-start justify-between gap-4 rounded-[4px] border-2 border-black px-4 py-3 text-left shadow-[4px_4px_0_#000]",
                status === "active" && cn(aiAccentBase, aiAccentHoverYellow),
                status === "done" && "bg-black text-white",
                status === "locked" && "bg-muted/20",
                !canNavigate && "opacity-60",
              )}
            >
              <div className="min-w-0 space-y-1">
                <div className="text-[11px] font-mono uppercase tracking-[0.18em]">
                  {t("sandbox.stepper.step", { index: index + 1 })}
                </div>
                <div className="text-sm font-semibold uppercase tracking-[0.04em]">
                  {t(step.title)}
                </div>
                <div
                  className={cn(
                    "text-xs",
                    status === "done"
                      ? "text-white/70"
                      : "text-muted-foreground",
                  )}
                >
                  {t(step.description)}
                </div>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "rounded-[4px] border text-[10px] uppercase tracking-[0.16em]",
                  status === "active" && "bg-[#b7ff00] text-black border-black",
                  status === "done" && "bg-white text-black border-white",
                  status === "locked" && "bg-transparent",
                )}
              >
                {t(`sandbox.stepper.${status}`)}
              </Badge>
            </Button>
          </li>
        );
      })}
    </ol>
  );
}
