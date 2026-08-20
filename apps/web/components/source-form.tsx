"use client";

import * as React from "react";
import type { JSONSchema7 } from "json-schema";
import { JsonSchemaForm, type JsonSchemaFormHandle } from "./json-schema-form";
import { getSourceSchema, type SourceType } from "@/lib/schema-loader";
import type { DetectorConfigInput } from "./source-scan-config";
import type { AutoScheduleStatus, ScheduleValue } from "./schedule-card";
import { useTranslation } from "@/hooks/use-translation";
import {
  CustomSourceConfig,
  draftToConfig,
  loadScaffold,
  type CustomSourceDraft,
} from "@/components/notebook/custom-source-config";
import {
  recordToEntries,
  secretKeysToEntries,
} from "@/components/key-value-field";
import type { NotebookCell } from "@/components/notebook/notebook-editor";

export type { SourceType } from "@/lib/schema-loader";

interface SourceFormProps {
  sourceType: SourceType;
  /** Present only once the source exists; a draft notebook cannot save or run. */
  sourceId?: string;
  defaultValues?: Record<string, unknown>;
  detectors?: DetectorConfigInput[];
  onSubmit: (data: Record<string, unknown>) => void;
  onTest?: (data: Record<string, unknown>) => void;
  onCancel?: () => void;
  mode?: "create" | "edit";
  disabled?: boolean;
  submitLabel?: string;
  testLabel?: string;
  cancelLabel?: string;
  showCancel?: boolean;
  schedule?: ScheduleValue;
  onScheduleChange?: (value: ScheduleValue) => void;
  autoScheduleStatus?: AutoScheduleStatus | null;
  onResumeSchedule?: () => Promise<void>;
  showActions?: boolean;
  afterNameContent?: React.ReactNode;
}

export interface SourceFormHandle extends JsonSchemaFormHandle {
  getSchema: () => JSONSchema7 | null;
}

export const SourceForm = React.forwardRef<SourceFormHandle, SourceFormProps>(
  function SourceForm(
    {
      sourceType,
      sourceId,
      defaultValues,
      detectors,
      onSubmit,
      onTest,
      onCancel,
      mode = "create",
      disabled = false,
      submitLabel,
      testLabel,
      cancelLabel,
      showCancel,
      schedule,
      onScheduleChange,
      autoScheduleStatus,
      onResumeSchedule,
      showActions = true,
      afterNameContent,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const formRef = React.useRef<JsonSchemaFormHandle | null>(null);
    const schema = getSourceSchema(sourceType);
    const isCustom = sourceType === "CUSTOM";

    // A CUSTOM source's config is a notebook plus two key/value maps, none of
    // which the schema-driven renderer can express, so those sections are
    // stripped here and rendered by CustomSourceConfig instead. SANDBOX does
    // the same for its uploaded files.
    const isSectionless = isCustom || sourceType === "SANDBOX";

    const [customDraft, setCustomDraft] = React.useState<CustomSourceDraft>(
      () => {
        // The stored config is opaque JSON here; only the notebook block
        // and the two key/value maps are read out of it.
        const config = (defaultValues ?? {}) as {
          required?: {
            notebook?: { cells?: NotebookCell[]; revision?: number };
          };
          optional?: {
            variables?: Record<string, string>;
            packages?: Array<{ name: string; version?: string }>;
          };
          masked?: { secrets?: Record<string, string> };
        };
        const notebook = config?.required?.notebook;
        const secretKeys = Object.keys(config?.masked?.secrets ?? {});
        return {
          // No cells yet means a new source: the scaffold is fetched below.
          // Everything else still comes from the config, so a template that
          // supplies packages or variables is not thrown away.
          cells: notebook?.cells ?? [],
          revision: notebook?.revision ?? 1,
          packages: config?.optional?.packages ?? [],
          variables: recordToEntries(config?.optional?.variables),
          secrets: secretKeysToEntries(secretKeys),
          originalSecretKeys: secretKeys,
        };
      },
    );

    // A new notebook opens on the scaffold rather than on an empty page: the
    // starter cells already satisfy the contract, so the first edit is a change
    // to working code instead of a guess at what is required.
    React.useEffect(() => {
      if (!isCustom || customDraft.cells.length > 0) return;
      let cancelled = false;
      void loadScaffold()
        .then((cells) => {
          if (!cancelled) setCustomDraft((draft) => ({ ...draft, cells }));
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [isCustom, customDraft.cells.length]);

    const enhancedSchema = React.useMemo(() => {
      if (!schema) return null;
      const {
        name: existingName,
        description: existingDescription,
        detectors: _detectors,
        custom_detectors: _customDetectors,
        ...restProperties
      } = schema.properties || {};

      const sourceProperties = isSectionless
        ? Object.fromEntries(
            Object.entries(restProperties).filter(
              ([key]) => !["required", "masked", "optional"].includes(key),
            ),
          )
        : restProperties;

      return {
        ...schema,
        properties: {
          name: {
            type: "string" as const,
            title: t("sources.form.nameLabel"),
            description: t("sources.form.nameHelp"),
            ...(existingName as JSONSchema7 | undefined),
          },
          description: {
            type: "string" as const,
            title: t("sources.form.descriptionLabel"),
            description: t("sources.form.descriptionHelp"),
            maxLength: 500,
            ...(existingDescription as JSONSchema7 | undefined),
          },
          ...sourceProperties,
        },
        required: Array.from(
          new Set([
            "name",
            ...(schema.required || []).filter(
              (key) =>
                !isSectionless ||
                !["required", "masked", "optional"].includes(key),
            ),
          ]),
        ) as string[],
      };
    }, [schema, isSectionless, t]);

    const formDefaultValues = React.useMemo(
      () => ({
        type: sourceType,
        ...(isSectionless ? { required: {}, masked: {}, optional: {} } : {}),
        ...(defaultValues || {}),
      }),
      [sourceType, isSectionless, defaultValues],
    );

    const sectionPayload = React.useCallback(
      () =>
        isCustom
          ? draftToConfig(customDraft)
          : sourceType === "SANDBOX"
            ? { required: {}, masked: {}, optional: {} }
            : {},
      [isCustom, customDraft, sourceType],
    );

    const handleSubmit = (data: Record<string, unknown>) => {
      const detectorPayload =
        detectors
          ?.filter((detector) => detector.type)
          .map((detector) => ({
            type: detector.type,
            enabled: detector.enabled,
            ...(detector.config && Object.keys(detector.config).length > 0
              ? { config: detector.config }
              : {}),
          })) ?? [];

      onSubmit({
        ...data,
        type: sourceType,
        ...sectionPayload(),
        ...(detectorPayload.length > 0 ? { detectors: detectorPayload } : {}),
      });
    };

    const handleTest = (data: Record<string, unknown>) => {
      if (!onTest) {
        return;
      }

      const detectorPayload =
        detectors
          ?.filter((detector) => detector.type)
          .map((detector) => ({
            type: detector.type,
            enabled: detector.enabled,
            ...(detector.config && Object.keys(detector.config).length > 0
              ? { config: detector.config }
              : {}),
          })) ?? [];

      onTest({
        ...data,
        type: sourceType,
        ...sectionPayload(),
        ...(detectorPayload.length > 0 ? { detectors: detectorPayload } : {}),
      });
    };

    React.useImperativeHandle(
      ref,
      () => ({
        getSchema: () => enhancedSchema,
        // Must return the same shape handleSubmit builds. Both source pages
        // render with showActions={false} and read this handle directly, so a
        // section rendered outside the schema form -- a CUSTOM notebook, a
        // SANDBOX file list -- reaches the API through here or not at all.
        getValues: () => ({
          ...(formRef.current?.getValues() ?? {}),
          type: sourceType,
          ...sectionPayload(),
        }),
        applyPatches: async (patches) => {
          await formRef.current?.applyPatches(patches);
        },
        validate: async () =>
          (await formRef.current?.validate()) ?? {
            isValid: false,
            missingFields: [],
            errors: ["Source form is not mounted"],
          },
      }),
      [enhancedSchema, sourceType, sectionPayload],
    );

    if (!schema || !enhancedSchema) {
      return (
        <div className="p-4 text-sm text-muted-foreground">
          Schema not found for source type: {sourceType}
        </div>
      );
    }

    return (
      <JsonSchemaForm
        ref={formRef}
        schema={enhancedSchema}
        defaultValues={formDefaultValues}
        includeSchemaDefaults={mode === "create"}
        onSubmit={handleSubmit}
        onSecondarySubmit={onTest ? handleTest : undefined}
        onCancel={onCancel}
        submitLabel={
          submitLabel ??
          (mode === "create" ? t("forms.createSource") : t("forms.saveChanges"))
        }
        secondarySubmitLabel={
          onTest ? (testLabel ?? t("forms.testConnection")) : undefined
        }
        cancelLabel={cancelLabel}
        showCancel={showCancel ?? !!onCancel}
        disabled={disabled}
        assistantSourceType={sourceType}
        schedule={schedule}
        onScheduleChange={onScheduleChange}
        autoScheduleStatus={autoScheduleStatus}
        onResumeSchedule={onResumeSchedule}
        showActions={showActions}
        afterNameContent={
          isCustom ? (
            <>
              {afterNameContent}
              <CustomSourceConfig
                sourceId={sourceId}
                draft={customDraft}
                onChange={setCustomDraft}
                disabled={disabled}
              />
            </>
          ) : (
            afterNameContent
          )
        }
      />
    );
  },
);
