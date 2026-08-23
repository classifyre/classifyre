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

/**
 * The sections a source page is read as.
 *
 * Two for an ordinary source, because its whole configuration is one
 * schema-rendered form. A CUSTOM source is not a form — it is a notebook plus
 * the things the notebook reads — so it gets one entry per section of the page
 * instead of a single "Source details" that covers four screens of scrolling.
 */
export type SourceStepId =
  | "config"
  | "files"
  | "packages"
  | "variables"
  | "notebook"
  | "detectors";

export const CUSTOM_SOURCE_STEP_IDS: SourceStepId[] = [
  "config",
  "files",
  "packages",
  "variables",
  "notebook",
  "detectors",
];

export const DEFAULT_SOURCE_STEP_IDS: SourceStepId[] = ["config", "detectors"];

interface StepperNavProps {
  activeStepId: SourceStepId;
  configSaved: boolean;
  onNavigate: (id: SourceStepId) => void;
  /** Defaults to the two-step layout; CUSTOM passes its six. */
  stepIds?: SourceStepId[];
}

function useSteps(
  configSaved: boolean,
  stepIds: SourceStepId[],
): StepperNavItem<SourceStepId>[] {
  const { t } = useTranslation();
  const byId: Record<SourceStepId, StepperNavItem<SourceStepId>> = {
    config: {
      id: "config",
      title: t("sources.stepper.sourceDetails"),
      description: t("sources.stepper.sourceDetailsDesc"),
    },
    files: {
      id: "files",
      title: t("sources.stepper.files"),
      description: t("sources.stepper.filesDesc"),
    },
    packages: {
      id: "packages",
      title: t("sources.stepper.packages"),
      description: t("sources.stepper.packagesDesc"),
    },
    variables: {
      id: "variables",
      title: t("sources.stepper.variables"),
      description: t("sources.stepper.variablesDesc"),
    },
    notebook: {
      id: "notebook",
      title: t("sources.stepper.notebook"),
      description: t("sources.stepper.notebookDesc"),
    },
    detectors: {
      id: "detectors",
      title: t("sources.stepper.detectors"),
      description: t("sources.stepper.detectorsDesc"),
      disabled: !configSaved,
    },
  };
  return stepIds.map((id) => byId[id]);
}

/** Vertical stepper — desktop right sidebar */
export function VerticalStepperNav({
  activeStepId,
  configSaved,
  onNavigate,
  stepIds = DEFAULT_SOURCE_STEP_IDS,
}: StepperNavProps) {
  const { t } = useTranslation();
  return (
    <VerticalNav
      steps={useSteps(configSaved, stepIds)}
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
  stepIds = DEFAULT_SOURCE_STEP_IDS,
}: StepperNavProps) {
  const { t } = useTranslation();
  return (
    <HorizontalNav
      steps={useSteps(configSaved, stepIds)}
      activeStepId={activeStepId}
      onNavigate={onNavigate}
      label={t("sources.stepper.navLabel")}
    />
  );
}
