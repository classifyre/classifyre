"use client";

import { defineStepper } from "@stepperize/react";
import { StepperHeader } from "@/components/stepper-header";
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

  const steps = sandboxStepper.steps.map((step) => ({
    id: step.id,
    title: t(step.title),
    description: t(step.description),
  }));

  return (
    <StepperHeader
      steps={steps}
      currentIndex={stepper.state.current.index}
      canNavigateToDetectors={canNavigateToDetectors}
      onNavigate={(id) => stepper.navigation.goTo(id)}
    />
  );
}
