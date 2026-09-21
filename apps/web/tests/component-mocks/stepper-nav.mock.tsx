import * as React from "react";

export interface StepperNavItem<Id extends string = string> {
  id: Id;
  title: string;
  description?: string;
  disabled?: boolean;
}

interface StepperNavProps<Id extends string> {
  steps: StepperNavItem<Id>[];
  activeStepId: Id;
  onNavigate: (id: Id) => void;
  label: string;
}

/**
 * Component-test double for `@/components/stepper-nav`.
 *
 * The real module uses JSX without importing React, which the Next compiler
 * accepts but the CT vite build does not. Stepper navigation is irrelevant to
 * the tests that mount forms alongside it, so this renders plain buttons.
 */
function StepperNav<Id extends string>({
  steps,
  activeStepId,
  onNavigate,
  label,
}: StepperNavProps<Id>) {
  return (
    <nav aria-label={label}>
      {steps.map((step) => (
        <button
          key={step.id}
          type="button"
          disabled={step.disabled}
          aria-current={step.id === activeStepId ? "step" : undefined}
          onClick={() => onNavigate(step.id)}
        >
          {step.title}
        </button>
      ))}
    </nav>
  );
}

export function VerticalStepperNav<Id extends string>(
  props: StepperNavProps<Id>,
) {
  return <StepperNav {...props} />;
}

export function HorizontalStepperNav<Id extends string>(
  props: StepperNavProps<Id>,
) {
  return <StepperNav {...props} />;
}
