"use client";

import * as React from "react";
import type { JSONSchema7 } from "json-schema";
import { JsonSchemaForm, type JsonSchemaFormHandle } from "./json-schema-form";
import { getSourceSchema, type SourceType } from "@/lib/schema-loader";
import type { DetectorConfigInput } from "./source-scan-config";
import type { ScheduleValue } from "./schedule-card";
import { useTranslation } from "@/hooks/use-translation";

export type { SourceType } from "@/lib/schema-loader";

interface SourceFormProps {
  sourceType: SourceType;
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
}

export interface SourceFormHandle extends JsonSchemaFormHandle {
  getSchema: () => JSONSchema7 | null;
}

export const SourceForm = React.forwardRef<SourceFormHandle, SourceFormProps>(
  function SourceForm(
    {
      sourceType,
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
    },
    ref,
  ) {
    const { t } = useTranslation();
    const formRef = React.useRef<JsonSchemaFormHandle | null>(null);
    const schema = getSourceSchema(sourceType);

    if (!schema) {
      return (
        <div className="p-4 text-sm text-muted-foreground">
          Schema not found for source type: {sourceType}
        </div>
      );
    }

    const enhancedSchema = React.useMemo(() => {
      const {
        name: existingName,
        detectors: _detectors,
        custom_detectors: _customDetectors,
        ...restProperties
      } = schema.properties || {};

      return {
        ...schema,
        properties: {
          name: {
            type: "string" as const,
            title: "Source name",
            description: "Give your source a memorable name to identify it",
            ...(existingName as JSONSchema7 | undefined),
          },
          ...restProperties,
        },
        required: Array.from(
          new Set(["name", ...(schema.required || [])]),
        ) as string[],
      };
    }, [schema]);

    const formDefaultValues = React.useMemo(
      () => ({
        type: sourceType,
        ...(defaultValues || {}),
      }),
      [sourceType, defaultValues],
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
        ...(detectorPayload.length > 0 ? { detectors: detectorPayload } : {}),
      });
    };

    React.useImperativeHandle(
      ref,
      () => ({
        getSchema: () => enhancedSchema,
        getValues: () => formRef.current?.getValues() ?? {},
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
      [enhancedSchema],
    );

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
          submitLabel ?? (mode === "create" ? t("forms.createSource") : t("forms.saveChanges"))
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
      />
    );
  },
);
