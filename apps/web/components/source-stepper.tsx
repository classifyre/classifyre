"use client";

import { defineStepper } from "@stepperize/react";
import { useTranslation } from "@/hooks/use-translation";
import { cn } from "@workspace/ui/lib/utils";

export const sourceStepper = defineStepper(
  { id: "config" },
  { id: "detectors" },
);

export type SourceStepId = "config" | "detectors";

interface StepperNavProps {
  activeStepId: SourceStepId;
  configSaved: boolean;
  onNavigate: (id: SourceStepId) => void;
}

function useSteps() {
  const { t } = useTranslation();
  return [
    {
      id: "config" as SourceStepId,
      title: t("sources.stepper.sourceDetails"),
      description: t("sources.stepper.sourceDetailsDesc"),
    },
    {
      id: "detectors" as SourceStepId,
      title: t("sources.stepper.detectors"),
      description: t("sources.stepper.detectorsDesc"),
    },
  ];
}

/** Indicator dot — shared between both nav orientations */
function StepIndicator({
  status,
  label,
}: {
  status: "active" | "done" | "upcoming";
  label: string | number;
}) {
  return (
    <span
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] border-2 text-[10px] font-bold transition-colors",
        status === "active" &&
          "border-black bg-[#b7ff00] text-black shadow-[2px_2px_0_#000]",
        status === "done" &&
          "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black",
        status === "upcoming" &&
          "border-border bg-background text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

/** Vertical stepper — desktop right sidebar */
export function VerticalStepperNav({
  activeStepId,
  configSaved,
  onNavigate,
}: StepperNavProps) {
  const steps = useSteps();
  const activeIndex = steps.findIndex((s) => s.id === activeStepId);

  return (
    <nav aria-label="Setup steps">
      <ol>
        {steps.map((step, index) => {
          const isActive = step.id === activeStepId;
          const isComplete = index < activeIndex;
          const isLast = index === steps.length - 1;
          const canNavigate = step.id === "detectors" ? configSaved : true;
          const status = isComplete ? "done" : isActive ? "active" : "upcoming";

          return (
            <li key={step.id} className="flex gap-3">
              {/* Left column: indicator + connector line */}
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  disabled={!canNavigate}
                  onClick={() => canNavigate && onNavigate(step.id)}
                  className="mt-2 disabled:cursor-not-allowed"
                >
                  <StepIndicator
                    status={status}
                    label={isComplete ? "✓" : index + 1}
                  />
                </button>
                {!isLast && (
                  <div
                    className={cn(
                      "mt-1 w-px grow",
                      isComplete
                        ? "bg-black dark:bg-white"
                        : "bg-border",
                    )}
                  />
                )}
              </div>

              {/* Right column: clickable text */}
              <button
                type="button"
                disabled={!canNavigate}
                onClick={() => onNavigate(step.id)}
                className={cn(
                  "group mb-1 flex-1 rounded-[4px] px-2 py-2 text-left transition-colors",
                  !isLast && "pb-6",
                  canNavigate && !isActive && "hover:bg-accent/10",
                  !canNavigate && "cursor-not-allowed opacity-50",
                )}
              >
                <span
                  className={cn(
                    "block text-[11px] font-semibold uppercase leading-tight tracking-[0.04em] transition-colors",
                    isActive ? "text-foreground" : "text-muted-foreground",
                    canNavigate &&
                      !isActive &&
                      "group-hover:text-foreground",
                  )}
                >
                  {step.title}
                </span>
                <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                  {step.description}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Horizontal stepper — mobile sticky top strip */
export function HorizontalStepperNav({
  activeStepId,
  configSaved,
  onNavigate,
}: StepperNavProps) {
  const steps = useSteps();
  const activeIndex = steps.findIndex((s) => s.id === activeStepId);

  return (
    <nav aria-label="Setup steps">
      <ol className="flex items-center gap-2">
        {steps.map((step, index) => {
          const isActive = step.id === activeStepId;
          const isComplete = index < activeIndex;
          const isLast = index === steps.length - 1;
          const canNavigate = step.id === "detectors" ? configSaved : true;
          const status = isComplete ? "done" : isActive ? "active" : "upcoming";

          return (
            <li key={step.id} className="flex min-w-0 flex-1 items-center gap-2">
              <button
                type="button"
                disabled={!canNavigate}
                onClick={() => onNavigate(step.id)}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-[4px] px-2 py-1.5 text-left transition-colors",
                  canNavigate && !isActive && "hover:bg-accent/10",
                  !canNavigate && "cursor-not-allowed opacity-50",
                )}
              >
                <StepIndicator
                  status={status}
                  label={isComplete ? "✓" : index + 1}
                />
                <span
                  className={cn(
                    "truncate text-[11px] font-semibold uppercase tracking-[0.04em]",
                    isActive ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {step.title}
                </span>
              </button>
              {!isLast && (
                <div
                  className={cn(
                    "h-px w-6 shrink-0",
                    isComplete ? "bg-black dark:bg-white" : "bg-border",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
