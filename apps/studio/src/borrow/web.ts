import type { ComponentType, ReactNode } from "react";

/*
 * Components of the web app that take everything they need as props, filmed
 * where they live (README.md here says how and why `require.context`). What
 * each one takes is restated, and only as much of it as a video uses. Add to
 * this list rather than to a video: the next video wants them too.
 */

export interface SamplingValue {
  strategy: "AUTOMATIC" | "RANDOM" | "LATEST" | "ALL";
}
export interface ScheduleValue {
  mode: "OFF" | "CRON" | "AUTO";
  [key: string]: unknown;
}

const webCards = require.context(
  "../../../web/components",
  false,
  /(sampling-card|schedule-card)\.tsx$/,
);
/** The source form's sampling card. */
export const { SamplingCard } = webCards<{
  SamplingCard: ComponentType<{
    value: SamplingValue;
    onChange: (value: SamplingValue) => void;
    className?: string;
  }>;
}>("./sampling-card.tsx");
/** The source form's ingestion-schedule card. */
export const { ScheduleCard, defaultScheduleValue } = webCards<{
  ScheduleCard: ComponentType<{
    value: ScheduleValue;
    onChange: (value: ScheduleValue) => void;
    className?: string;
  }>;
  defaultScheduleValue: (schedule?: {
    enabled?: boolean;
    mode?: string | null;
  }) => ScheduleValue;
}>("./schedule-card.tsx");

const webPieces = require.context(
  "../../../web/components",
  false,
  /(page-title|sticky-action-toolbar|stepper-nav|source-detector-config-card|case-details-form|matched-content-block|runner-status-badge)\.tsx$/,
);

/** A page's serif title and the line under it. */
export const { PageTitle } = webPieces<{
  PageTitle: ComponentType<{
    title: string;
    description?: string;
    className?: string;
  }>;
}>("./page-title.tsx");

/** The bar a form ends in: Save, Test, and the action that also runs. */
export const { StickyActionToolbar } = webPieces<{
  StickyActionToolbar: ComponentType<{
    onSave?: () => void;
    onTest?: () => void;
    onSaveAndRun: () => void;
    onCancel?: () => void;
    saveLabel?: string;
    testLabel?: string;
    cancelLabel?: string;
    saveAndRunLabel: string;
    hint?: ReactNode;
    className?: string;
  }>;
}>("./sticky-action-toolbar.tsx");

export interface Step {
  id: string;
  title: string;
  description?: string;
  disabled?: boolean;
}
/** The numbered steps down the right of a long form. */
export const { VerticalStepperNav } = webPieces<{
  VerticalStepperNav: ComponentType<{
    steps: Step[];
    activeStepId: string;
    onNavigate: (id: string) => void;
    label: string;
  }>;
}>("./stepper-nav.tsx");

/** The card the source form's detectors sit in. */
export const { SourceDetectorConfigCard } = webPieces<{
  SourceDetectorConfigCard: ComponentType<{
    children: ReactNode;
    visibleCount: number;
    enabledCount: number;
    isSaving: boolean;
    onBack: () => void;
    onSave: () => void;
    onSaveAndScan: () => void;
    showActions?: boolean;
  }>;
}>("./source-detector-config-card.tsx");

export interface CaseDetails {
  title: string;
  description: string;
  severity: string;
  assignee: string;
}
/** Title, description, priority and assignee of a case. */
export const { CaseDetailsForm } = webPieces<{
  CaseDetailsForm: ComponentType<{
    values: CaseDetails;
    onChange: (next: CaseDetails) => void;
  }>;
}>("./case-details-form.tsx");

/** What a detector matched, with the text round it. */
export const { MatchedContentBlock } = webPieces<{
  MatchedContentBlock: ComponentType<{
    severity?: "critical" | "high" | "medium" | "low" | "info";
    matchedContent?: string | null;
    contextBefore?: string | null;
    contextAfter?: string | null;
  }>;
}>("./matched-content-block.tsx");

/** A scan's status as the tables show it. */
export const { RunnerStatusBadge } = webPieces<{
  RunnerStatusBadge: ComponentType<{
    status?: string | null;
    className?: string;
  }>;
}>("./runner-status-badge.tsx");
