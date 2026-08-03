"use client";

import { defineStepper } from "@stepperize/react";
import { useTranslation } from "@/hooks/use-translation";
import {
  HorizontalStepperNav as HorizontalNav,
  VerticalStepperNav as VerticalNav,
  type StepperNavItem,
} from "@/components/stepper-nav";

export const sourceStepper = defineStepper([
  { id: "config" },
  { id: "detectors" },
]);

export type SourceStepId = "config" | "detectors";

interface StepperNavProps {
  activeStepId: SourceStepId;
  configSaved: boolean;
  onNavigate: (id: SourceStepId) => void;
}

function useSteps(configSaved: boolean): StepperNavItem<SourceStepId>[] {
  const { t } = useTranslation();
  return [
    {
      id: "config",
      title: t("sources.stepper.sourceDetails"),
      description: t("sources.stepper.sourceDetailsDesc"),
    },
    {
      id: "detectors",
      title: t("sources.stepper.detectors"),
      description: t("sources.stepper.detectorsDesc"),
      disabled: !configSaved,
    },
  ];
}

/** Vertical stepper — desktop right sidebar */
export function VerticalStepperNav({
  activeStepId,
  configSaved,
  onNavigate,
}: StepperNavProps) {
  const { t } = useTranslation();
  return (
    <VerticalNav
      steps={useSteps(configSaved)}
      activeStepId={activeStepId}
      onNavigate={onNavigate}
      label={t("sources.stepper.navLabel")}
    />
  );
}

/** Horizontal stepper — mobile sticky top strip */
export function HorizontalStepperNav({
  activeStepId,
  configSaved,
  onNavigate,
}: StepperNavProps) {
  const { t } = useTranslation();
  return (
    <HorizontalNav
      steps={useSteps(configSaved)}
      activeStepId={activeStepId}
      onNavigate={onNavigate}
      label={t("sources.stepper.navLabel")}
    />
  );
}
