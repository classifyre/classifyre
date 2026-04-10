"use client";

import { defineStepper } from "@stepperize/react";
import { StepperHeader } from "@/components/stepper-header";
import { useTranslation } from "@/hooks/use-translation";

export const sourceStepper = defineStepper(
  { id: "config" },
  { id: "detectors" },
);

export function SourceStepperHeader({
  canNavigateToDetectors,
}: {
  canNavigateToDetectors: boolean;
}) {
  const { t } = useTranslation();
  const stepper = sourceStepper.useStepper();

  const steps = sourceStepper.steps.map((step) => ({
    id: step.id,
    title:
      step.id === "config"
        ? t("sources.stepper.sourceDetails")
        : t("sources.stepper.detectors"),
    description:
      step.id === "config"
        ? t("sources.stepper.sourceDetailsDesc")
        : t("sources.stepper.detectorsDesc"),
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
