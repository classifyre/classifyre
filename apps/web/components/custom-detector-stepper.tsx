"use client";

import * as React from "react";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";

export type CustomDetectorStepId =
  | "identity"
  | "entities"
  | "classification"
  | "validation"
  | "model"
  | "training";

type AnyStepId = string;

interface StepItem {
  id: AnyStepId;
  title: string;
  description: string;
}

interface StepperNavProps<T extends AnyStepId = AnyStepId> {
  activeStepId: T;
  onNavigate: (id: T) => void;
  /** Override internal steps. Used by the full editor with its own step flow. */
  steps?: StepItem[];
}

function useSteps() {
  const { t } = useTranslation();
  return [
    {
      id: "identity" as CustomDetectorStepId,
      title: t("detectors.stepper.identity"),
      description: t("detectors.stepper.identityDesc"),
    },
    {
      id: "entities" as CustomDetectorStepId,
      title: t("detectors.stepper.entities"),
      description: t("detectors.stepper.entitiesDesc"),
    },
    {
      id: "classification" as CustomDetectorStepId,
      title: t("detectors.stepper.classification"),
      description: t("detectors.stepper.classificationDesc"),
    },
    {
      id: "validation" as CustomDetectorStepId,
      title: t("detectors.stepper.validation"),
      description: t("detectors.stepper.validationDesc"),
    },
    {
      id: "model" as CustomDetectorStepId,
      title: t("detectors.stepper.model"),
      description: t("detectors.stepper.modelDesc"),
    },
    {
      id: "training" as CustomDetectorStepId,
      title: t("detectors.stepper.training"),
      description: t("detectors.stepper.trainingDesc"),
    },
  ];
}

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

export function VerticalCustomDetectorStepperNav<T extends AnyStepId>({
  activeStepId,
  onNavigate,
  steps: externalSteps,
}: StepperNavProps<T>) {
  const internalSteps = useSteps();
  const steps = externalSteps ?? internalSteps;
  const activeIndex = steps.findIndex((s) => s.id === activeStepId);

  return (
    <nav aria-label="Detector setup steps">
      <ol>
        {steps.map((step, index) => {
          const isActive = step.id === activeStepId;
          const isComplete = index < activeIndex;
          const isLast = index === steps.length - 1;
          const status = isComplete ? "done" : isActive ? "active" : "upcoming";

          return (
            <li key={step.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  onClick={() => onNavigate(step.id as T)}
                  className="mt-2"
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
                      isComplete ? "bg-black dark:bg-white" : "bg-border",
                    )}
                  />
                )}
              </div>

              <button
                type="button"
                onClick={() => onNavigate(step.id as T)}
                className={cn(
                  "group mb-1 flex-1 rounded-[4px] px-2 py-2 text-left transition-colors",
                  !isLast && "pb-6",
                  !isActive && "hover:bg-accent/10",
                )}
              >
                <span
                  className={cn(
                    "block text-[11px] font-semibold uppercase leading-tight tracking-[0.04em] transition-colors",
                    isActive ? "text-foreground" : "text-muted-foreground",
                    !isActive && "group-hover:text-foreground",
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

export function HorizontalCustomDetectorStepperNav<T extends AnyStepId>({
  activeStepId,
  onNavigate,
  steps: externalSteps,
}: StepperNavProps<T>) {
  const internalSteps = useSteps();
  const steps = externalSteps ?? internalSteps;
  const activeIndex = steps.findIndex((s) => s.id === activeStepId);

  return (
    <nav aria-label="Detector setup steps">
      <ol className="flex items-center gap-2">
        {steps.map((step, index) => {
          const isActive = step.id === activeStepId;
          const isComplete = index < activeIndex;
          const isLast = index === steps.length - 1;
          const status = isComplete ? "done" : isActive ? "active" : "upcoming";

          return (
            <li key={step.id} className="flex min-w-0 flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => onNavigate(step.id as T)}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-[4px] px-2 py-1.5 text-left transition-colors",
                  !isActive && "hover:bg-accent/10",
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
