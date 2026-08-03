"use client";

import { cn } from "@workspace/ui/lib/utils";

export interface StepperNavItem<Id extends string = string> {
  id: Id;
  title: string;
  description?: string;
  /** Steps that cannot be reached yet render dimmed and ignore clicks. */
  disabled?: boolean;
}

interface StepperNavProps<Id extends string> {
  steps: StepperNavItem<Id>[];
  activeStepId: Id;
  onNavigate: (id: Id) => void;
  /** Accessible name for the surrounding <nav>. */
  label: string;
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
          "border-border bg-accent text-accent-foreground shadow-[2px_2px_0_var(--color-border)]",
        status === "done" &&
          "border-border bg-black text-white dark:border-white dark:bg-white dark:text-accent-foreground",
        status === "upcoming" &&
          "border-border bg-background text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

/** Vertical stepper — desktop right sidebar */
export function VerticalStepperNav<Id extends string>({
  steps,
  activeStepId,
  onNavigate,
  label,
}: StepperNavProps<Id>) {
  const activeIndex = steps.findIndex((step) => step.id === activeStepId);

  return (
    <nav aria-label={label}>
      <ol>
        {steps.map((step, index) => {
          const isActive = step.id === activeStepId;
          const isComplete = index < activeIndex;
          const isLast = index === steps.length - 1;
          const canNavigate = !step.disabled;
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
                      isComplete ? "bg-black dark:bg-white" : "bg-border",
                    )}
                  />
                )}
              </div>

              {/* Right column: clickable text */}
              <button
                type="button"
                disabled={!canNavigate}
                onClick={() => onNavigate(step.id)}
                data-testid={`stepper-step-${step.id}`}
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
                    canNavigate && !isActive && "group-hover:text-foreground",
                  )}
                >
                  {step.title}
                </span>
                {step.description && (
                  <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                    {step.description}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Horizontal stepper — mobile sticky top strip */
export function HorizontalStepperNav<Id extends string>({
  steps,
  activeStepId,
  onNavigate,
  label,
}: StepperNavProps<Id>) {
  const activeIndex = steps.findIndex((step) => step.id === activeStepId);

  return (
    <nav aria-label={label}>
      <ol className="flex items-center gap-1 sm:gap-2">
        {steps.map((step, index) => {
          const isActive = step.id === activeStepId;
          const isComplete = index < activeIndex;
          const isLast = index === steps.length - 1;
          const canNavigate = !step.disabled;
          const status = isComplete ? "done" : isActive ? "active" : "upcoming";

          return (
            <li
              key={step.id}
              className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2"
            >
              <button
                type="button"
                disabled={!canNavigate}
                onClick={() => onNavigate(step.id)}
                data-testid={`stepper-step-${step.id}`}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-1.5 rounded-[4px] px-1 py-1.5 text-left transition-colors sm:gap-2 sm:px-2",
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
                    "h-px w-3 shrink-0 sm:w-6",
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
