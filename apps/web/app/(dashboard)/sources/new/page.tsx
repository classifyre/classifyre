"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import {
  api,
  type AssistantOperation,
  type AssistantUiAction,
  type StartRunnerDto,
} from "@workspace/api-client";
import { useRegisterAssistantBridge } from "@/components/assistant-workflow-provider";
import { SourceTypeSelector } from "@/components/source-type-selector";
import {
  SourceForm,
  type SourceFormHandle,
  type SourceType,
} from "@/components/source-form";
import { SourceExampleSelector } from "@/components/source-example-selector";
import {
  SourceScanConfig,
  type DetectorConfigInput,
} from "@/components/source-scan-config";
import { SourceDetectorConfigCard } from "@/components/source-detector-config-card";
import {
  HorizontalStepperNav,
  VerticalStepperNav,
  type SourceStepId,
} from "@/components/source-stepper";
import {
  TestConnectionDialog,
  type TestConnectionStatus,
} from "@/components/test-connection-dialog";
import {
  defaultScheduleValue,
  type ScheduleValue,
} from "@/components/schedule-card";
import { toast } from "sonner";
import { getSourceExamples, type SourceExample } from "@/lib/example-loader";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import {
  flattenObjectToPatches,
  setValueAtPath,
} from "@/lib/assistant-form-utils";
import { sanitizeTemplateConfig } from "@/lib/template-example-sanitizer";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";

const normalizeDetectors = (detectors: DetectorConfigInput[]) =>
  detectors
    .filter((detector) => detector.type.toUpperCase() !== "CUSTOM")
    .filter((detector) => detector.type)
    .map((detector) => ({
      type: detector.type,
      enabled: detector.enabled,
      ...(detector.config && Object.keys(detector.config).length > 0
        ? { config: detector.config }
        : {}),
    }));

export default function NewSourcePage() {
  const router = useRouter();
  const { t } = useTranslation();
  const sourceFormRef = useRef<SourceFormHandle | null>(null);
  const [selectedSourceType, setSelectedSourceType] =
    useState<SourceType | null>(null);
  const [showExamples, setShowExamples] = useState(true);
  const [formDefaultValues, setFormDefaultValues] = useState<
    Record<string, unknown> | undefined
  >(undefined);
  const [detectors, setDetectors] = useState<DetectorConfigInput[]>([]);
  const [selectedCustomDetectorIds, setSelectedCustomDetectorIds] = useState<
    string[]
  >([]);
  const [detectorDefaults, setDetectorDefaults] = useState<
    DetectorConfigInput[]
  >([]);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [configDraft, setConfigDraft] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [configSaved, setConfigSaved] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isTestingConfig, setIsTestingConfig] = useState(false);
  const [isSavingDetectors, setIsSavingDetectors] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleValue>(
    defaultScheduleValue(),
  );
  const [testConnectionDialog, setTestConnectionDialog] = useState<{
    open: boolean;
    status: TestConnectionStatus;
    message: string;
  }>({
    open: false,
    status: "loading",
    message: "Testing connection...",
  });

  const handleSelectExample = (example: SourceExample) => {
    const {
      type: _type,
      detectors: exampleDetectors,
      custom_detectors: exampleCustomDetectors,
      ...configData
    } = example.config as Record<string, unknown>;
    setFormDefaultValues(sanitizeTemplateConfig(configData));
    setSelectedCustomDetectorIds(
      Array.isArray(exampleCustomDetectors)
        ? exampleCustomDetectors
            .map((entry) => String(entry).trim())
            .filter((entry) => entry.length > 0)
        : [],
    );
    if (Array.isArray(exampleDetectors)) {
      const normalized = exampleDetectors.map((detector) => ({
        type: String((detector as { type?: unknown }).type ?? ""),
        enabled: Boolean((detector as { enabled?: unknown }).enabled ?? true),
        config: (detector as { config?: Record<string, unknown> }).config ?? {},
      }));
      setDetectors(normalized);
      setDetectorDefaults(normalized);
    } else {
      setDetectors([]);
      setDetectorDefaults([]);
    }
    setSchedule(defaultScheduleValue(example.schedule));
    setSourceId(null);
    setConfigDraft(null);
    setConfigSaved(false);
    setShowExamples(false);
  };

  const handleStartBlank = () => {
    setShowExamples(false);
    setFormDefaultValues(undefined);
    setDetectors([]);
    setSelectedCustomDetectorIds([]);
    setDetectorDefaults([]);
    setSchedule(defaultScheduleValue());
    setSourceId(null);
    setConfigDraft(null);
    setConfigSaved(false);
  };

  const resetSourceFlowState = () => {
    setShowExamples(true);
    setFormDefaultValues(undefined);
    setDetectors([]);
    setSelectedCustomDetectorIds([]);
    setDetectorDefaults([]);
    setSchedule(defaultScheduleValue());
    setSourceId(null);
    setConfigDraft(null);
    setConfigSaved(false);
  };

  const handleSelectSourceType = (type: SourceType) => {
    if (selectedSourceType === type) return;
    setSelectedSourceType(type);
    resetSourceFlowState();
  };

  const saveSourceConfig = async (data: Record<string, unknown>) => {
    if (!selectedSourceType) {
      toast.error(t("sources.typeRequired"));
      return null;
    }

    const { name, type: _type, detectors: _detectors, ...configFields } = data;

    if (!name) {
      toast.error(t("sources.nameRequired"));
      return null;
    }

    const detectorPayload = normalizeDetectors(detectors);
    const config = {
      type: selectedSourceType,
      ...configFields,
      ...(selectedCustomDetectorIds.length > 0
        ? { custom_detectors: selectedCustomDetectorIds }
        : {}),
      ...(detectorPayload.length > 0 ? { detectors: detectorPayload } : {}),
    };

    const scheduleFields =
      schedule.enabled && schedule.cron
        ? {
            scheduleEnabled: true,
            scheduleCron: schedule.cron,
            scheduleTimezone: schedule.timezone,
          }
        : { scheduleEnabled: false };

    if (sourceId) {
      const updated = await api.sources.sourcesControllerUpdateSource({
        id: sourceId,
        updateSourceDto: {
          name: String(name),
          config,
          ...scheduleFields,
        },
      });
      return updated?.id || sourceId;
    }

    const createPayload = {
      name: String(name),
      type: selectedSourceType,
      config,
      ...scheduleFields,
    };

    const created = await api.sources.sourcesControllerCreateSource({
      createSourceDto: createPayload,
    });
    return created?.id || null;
  };

  const handleSaveConfig = async (
    data: Record<string, unknown>,
    onSuccess: () => void,
  ) => {
    try {
      setIsSavingConfig(true);
      const savedId = await saveSourceConfig(data);
      if (!savedId) return;

      setSourceId(savedId);
      setConfigDraft(data);
      setConfigSaved(true);

      toast.success(t("sources.saved"));
      onSuccess();
    } catch (error) {
      console.error("Failed to save source:", error);
      toast.error(
        error instanceof Error
          ? `Failed to save source: ${error.message}`
          : "Failed to save source. Please try again.",
      );
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleTestConfig = async (data: Record<string, unknown>) => {
    try {
      setTestConnectionDialog({
        open: true,
        status: "loading",
        message: t("sources.new.testingConnection"),
      });
      setIsTestingConfig(true);
      const savedId = await saveSourceConfig(data);
      if (!savedId) {
        setTestConnectionDialog({
          open: true,
          status: "error",
          message: t("sources.new.incompleteSettings"),
        });
        return;
      }

      setSourceId(savedId);
      setConfigDraft(data);
      setConfigSaved(true);

      const result = await api.sources.sourcesControllerTestConnection({
        id: savedId,
      });
      if (result?.status === "SUCCESS") {
        setTestConnectionDialog({
          open: true,
          status: "success",
          message: result?.message || t("sources.new.connectionOk"),
        });
      } else {
        setTestConnectionDialog({
          open: true,
          status: "error",
          message: result?.message || t("sources.new.connectionFailed"),
        });
      }
    } catch (error) {
      console.error("Failed to test connection:", error);
      const errorMessage = await extractApiErrorMessage(
        error,
        "Failed to test connection. Please try again.",
      );
      setTestConnectionDialog({
        open: true,
        status: "error",
        message: errorMessage,
      });
    } finally {
      setIsTestingConfig(false);
    }
  };

  const handleSaveDetectors = async (action: "scan" | "view") => {
    try {
      if (!selectedSourceType) {
        toast.error(t("sources.typeRequired"));
        return;
      }

      const sourceToUpdate = sourceId;
      if (!sourceToUpdate) {
        toast.error(t("sources.saveFirst"));
        return;
      }

      setIsSavingDetectors(true);

      const draft = configDraft ?? {};
      const {
        name,
        type: _type,
        detectors: _detectors,
        ...configFields
      } = draft;
      const detectorPayload = normalizeDetectors(detectors);
      const config = {
        type: selectedSourceType,
        ...configFields,
        ...(selectedCustomDetectorIds.length > 0
          ? { custom_detectors: selectedCustomDetectorIds }
          : {}),
        ...(detectorPayload.length > 0 ? { detectors: detectorPayload } : {}),
      };

      await api.sources.sourcesControllerUpdateSource({
        id: sourceToUpdate,
        updateSourceDto: {
          name: typeof name === "string" ? name : undefined,
          config,
        },
      });

      toast.success(t("sources.new.detectorsSaved"));

      if (action === "scan") {
        const startRunnerDto: StartRunnerDto = { triggerType: "MANUAL" };
        const runner = await api.runners.cliRunnerControllerStartRunner({
          sourceId: sourceToUpdate,
          startRunnerDto,
        });
        if (runner?.id) {
          router.push(`/scans/${runner.id}`);
        } else {
          router.push("/scans");
        }
        return;
      }

      router.push(`/sources/${sourceToUpdate}`);
    } catch (error) {
      console.error("Failed to save detectors:", error);
      toast.error(
        error instanceof Error
          ? `Failed to save detectors: ${error.message}`
          : "Failed to save detectors. Please try again.",
      );
    } finally {
      setIsSavingDetectors(false);
    }
  };

  const examples = selectedSourceType
    ? getSourceExamples(selectedSourceType)
    : [];

  const assistantBridge = useMemo(() => {
    if (!selectedSourceType || showExamples) {
      return null;
    }

    return {
      contextKey: "source.create" as const,
      canOpen: true,
      getContext: async () => {
        const formValues = sourceFormRef.current?.getValues() ?? {
          type: selectedSourceType,
        };
        const validation = (await sourceFormRef.current?.validate()) ?? {
          isValid: false,
          missingFields: [],
          errors: ["Source form is not mounted"],
        };

        return {
          key: "source.create" as const,
          route: "/sources/new",
          title: t("sources.new.setupAssistant"),
          entityId: sourceId,
          values: formValues,
          schema: sourceFormRef.current?.getSchema() as Record<
            string,
            unknown
          > | null,
          validation,
          metadata: {
            sourceType: selectedSourceType,
            schedule,
            detectors: normalizeDetectors(detectors),
            customDetectorIds: selectedCustomDetectorIds,
          },
          supportedOperations: sourceId
            ? ([
                "update_source",
                "test_source_connection",
              ] satisfies AssistantOperation[])
            : (["create_source"] satisfies AssistantOperation[]),
        };
      },
      applyAction: async (action: AssistantUiAction) => {
        if (action.type === "patch_fields") {
          const formPatches = action.patches.filter(
            (patch) => !patch.path.startsWith("schedule."),
          );
          const schedulePatches = action.patches.filter((patch) =>
            patch.path.startsWith("schedule."),
          );

          if (formPatches.length > 0) {
            await sourceFormRef.current?.applyPatches(formPatches);
            setConfigDraft(sourceFormRef.current?.getValues() ?? null);
          }

          if (schedulePatches.length > 0) {
            setSchedule((current) =>
              schedulePatches.reduce<ScheduleValue>((nextSchedule, patch) => {
                const path = patch.path.replace(/^schedule\./, "");
                return setValueAtPath(
                  nextSchedule as Record<string, unknown>,
                  path,
                  patch.value,
                ) as ScheduleValue;
              }, current),
            );
          }
          return;
        }

        if (action.type === "sync_source") {
          await sourceFormRef.current?.applyPatches(
            flattenObjectToPatches(action.values),
          );
          setSourceId(action.sourceId);
          setConfigDraft(action.values);
          setConfigSaved(true);
          if (action.schedule) {
            setSchedule((current) => ({
              ...current,
              enabled: action.schedule?.enabled ?? current.enabled,
              cron: action.schedule?.cron ?? current.cron,
              timezone: action.schedule?.timezone ?? current.timezone,
            }));
          }
        }
      },
    };
  }, [
    detectors,
    schedule,
    selectedCustomDetectorIds,
    selectedSourceType,
    showExamples,
    sourceId,
  ]);

  useRegisterAssistantBridge(assistantBridge);

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <div>
        <Button
          variant="outline"
          onClick={() => router.push("/sources")}
          className="mb-4 rounded-[4px] border-2 border-black shadow-[3px_3px_0_#000]"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("sources.new.backToSources")}
        </Button>
        <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
          {t("sources.new.title")}
        </h1>
        <p className="text-muted-foreground mt-2">
          {t("sources.new.description")}
        </p>
      </div>

      {!selectedSourceType ? (
        <SourceTypeSelector onSelect={handleSelectSourceType} />
      ) : showExamples && !formDefaultValues ? (
        <SourceExampleSelector
          selectedSourceType={selectedSourceType}
          examples={examples}
          onSelectExample={handleSelectExample}
          onStartBlank={handleStartBlank}
        />
      ) : (
        <SourceStepperContent
          selectedSourceType={selectedSourceType}
          formDefaultValues={formDefaultValues}
          detectorDefaults={detectorDefaults}
          schedule={schedule}
          configSaved={configSaved}
          isSavingConfig={isSavingConfig}
          isTestingConfig={isTestingConfig}
          isSavingDetectors={isSavingDetectors}
          sourceFormRef={sourceFormRef}
          onSaveConfig={handleSaveConfig}
          onTestConfig={handleTestConfig}
          onSaveDetectors={handleSaveDetectors}
          onDetectorsChange={setDetectors}
          selectedCustomDetectorIds={selectedCustomDetectorIds}
          onCustomDetectorsChange={setSelectedCustomDetectorIds}
          onScheduleChange={setSchedule}
        />
      )}

      <TestConnectionDialog
        open={testConnectionDialog.open}
        status={testConnectionDialog.status}
        message={testConnectionDialog.message}
        onOpenChange={(open) => {
          setTestConnectionDialog((current) => ({
            ...current,
            open,
          }));
        }}
      />
    </div>
  );
}

function SourceStepperContent({
  selectedSourceType,
  formDefaultValues,
  detectorDefaults,
  schedule,
  configSaved,
  isSavingConfig,
  isTestingConfig,
  isSavingDetectors,
  sourceFormRef,
  onSaveConfig,
  onTestConfig,
  onSaveDetectors,
  onDetectorsChange,
  selectedCustomDetectorIds,
  onCustomDetectorsChange,
  onScheduleChange,
}: {
  selectedSourceType: SourceType;
  formDefaultValues: Record<string, unknown> | undefined;
  detectorDefaults: DetectorConfigInput[];
  schedule: ScheduleValue;
  configSaved: boolean;
  isSavingConfig: boolean;
  isTestingConfig: boolean;
  isSavingDetectors: boolean;
  sourceFormRef: RefObject<SourceFormHandle | null>;
  onSaveConfig: (data: Record<string, unknown>, onSuccess: () => void) => void;
  onTestConfig: (data: Record<string, unknown>) => void;
  onSaveDetectors: (action: "scan" | "view") => void;
  onDetectorsChange: (detectors: DetectorConfigInput[]) => void;
  selectedCustomDetectorIds: string[];
  onCustomDetectorsChange: (ids: string[]) => void;
  onScheduleChange: (schedule: ScheduleValue) => void;
}) {
  const { t } = useTranslation();
  const configRef = useRef<HTMLDivElement>(null);
  const detectorsRef = useRef<HTMLDivElement>(null);
  const [activeStepId, setActiveStepId] = useState<SourceStepId>("config");
  const [scanSummary, setScanSummary] = useState({
    visibleCount: 0,
    enabledCount: 0,
  });

  // IntersectionObserver: highlight whichever section is in the top half of the viewport.
  // Works correctly regardless of which DOM element is the actual scroll container.
  useEffect(() => {
    const els = [
      { id: "config" as SourceStepId, el: configRef.current },
      { id: "detectors" as SourceStepId, el: detectorsRef.current },
    ].filter((x): x is { id: SourceStepId; el: HTMLDivElement } => x.el !== null);

    const map = new Map<Element, SourceStepId>(els.map(({ id, el }) => [el, id]));

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = map.get(entry.target);
            if (id) setActiveStepId(id);
          }
        }
      },
      // Trigger when a section's top edge crosses 40% from top of viewport
      { rootMargin: "0px 0px -60% 0px", threshold: 0 },
    );

    els.forEach(({ el }) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const scrollToSection = (id: SourceStepId) => {
    const el = id === "config" ? configRef.current : detectorsRef.current;
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleSaveAndContinue = (data: Record<string, unknown>) => {
    onSaveConfig(data, () => {
      setTimeout(() => scrollToSection("detectors"), 150);
    });
  };

  return (
    <div>
      {/* Mobile sticky horizontal nav */}
      <div className="sticky top-0 z-20 -mx-4 mb-6 border-b-2 border-black bg-background/95 px-4 py-2 backdrop-blur-sm md:hidden">
        <HorizontalStepperNav
          activeStepId={activeStepId}
          configSaved={configSaved}
          onNavigate={scrollToSection}
        />
      </div>

      {/* Desktop: content + right sticky sidebar */}
      <div className="flex gap-8 lg:gap-12">
        {/* Scrollable content */}
        <div className="min-w-0 flex-1 space-y-16 pb-32">
          <section ref={configRef}>
            <SourceForm
              ref={sourceFormRef}
              sourceType={selectedSourceType}
              defaultValues={formDefaultValues}
              onSubmit={handleSaveAndContinue}
              onTest={onTestConfig}
              mode="create"
              disabled={isSavingConfig || isTestingConfig}
              submitLabel={t("sources.edit.saveAndContinue")}
              testLabel={t("sources.edit.testSource")}
              showCancel={false}
              schedule={schedule}
              onScheduleChange={onScheduleChange}
            />
          </section>

          <section ref={detectorsRef}>
            {!configSaved && (
              <p
                className={cn(
                  "mb-4 rounded-[4px] border-2 border-black px-4 py-3 text-sm text-muted-foreground",
                  "bg-muted/30 shadow-[3px_3px_0_#000]",
                )}
              >
                {t("sources.saveFirst")}
              </p>
            )}
            <SourceDetectorConfigCard
              visibleCount={scanSummary.visibleCount}
              enabledCount={scanSummary.enabledCount}
              isSaving={isSavingDetectors}
              onBack={() => scrollToSection("config")}
              onSave={() => onSaveDetectors("view")}
              onSaveAndScan={() => onSaveDetectors("scan")}
              saveAndScanTestId="btn-save-and-scan"
            >
              <SourceScanConfig
                defaultDetectors={detectorDefaults}
                onDetectorsChange={onDetectorsChange}
                onSummaryChange={setScanSummary}
                selectedCustomDetectorIds={selectedCustomDetectorIds}
                onCustomDetectorsChange={onCustomDetectorsChange}
                mode="create"
              />
            </SourceDetectorConfigCard>
          </section>
        </div>

        {/* Right sticky sidebar — desktop only */}
        <aside className="hidden self-start md:sticky md:top-6 md:block md:w-44 lg:w-52">
          <VerticalStepperNav
            activeStepId={activeStepId}
            configSaved={configSaved}
            onNavigate={scrollToSection}
          />
        </aside>
      </div>
    </div>
  );
}
