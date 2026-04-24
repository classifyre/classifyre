"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { useRegisterAssistantBridge } from "@/components/assistant-workflow-provider";
import {
  SourceForm,
  type SourceFormHandle,
  type SourceType,
} from "@/components/source-form";
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
import { StickyActionToolbar } from "@/components/sticky-action-toolbar";
import { DetailBackButton } from "@/components/detail-back-button";
import {
  TestConnectionDialog,
  type TestConnectionStatus,
} from "@/components/test-connection-dialog";
import {
  defaultScheduleValue,
  type ScheduleValue,
} from "@/components/schedule-card";
import { toast } from "sonner";
import {
  api,
  type AssistantOperation,
  type AssistantUiAction,
  type StartRunnerDto,
} from "@workspace/api-client";
import {
  flattenObjectToPatches,
  setValueAtPath,
} from "@/lib/assistant-form-utils";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
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

export default function EditSourcePage() {
  const router = useRouter();
  const { t } = useTranslation();
  const params = useParams();
  const sourceId = params.id as string;
  const sourceFormRef = useRef<SourceFormHandle | null>(null);
  const [source, setSource] = useState<{
    id: string;
    name: string;
    type: SourceType;
    config?: Record<string, unknown>;
  } | null>(null);
  const [detectors, setDetectors] = useState<DetectorConfigInput[]>([]);
  const [selectedCustomDetectorIds, setSelectedCustomDetectorIds] = useState<
    string[]
  >([]);
  const [schedule, setSchedule] = useState<ScheduleValue>(
    defaultScheduleValue(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isTestingConfig, setIsTestingConfig] = useState(false);
  const [testConnectionDialog, setTestConnectionDialog] = useState<{
    open: boolean;
    status: TestConnectionStatus;
    message: string;
  }>({
    open: false,
    status: "loading",
    message: "Testing connection...",
  });

  useEffect(() => {
    const fetchSource = async () => {
      try {
        setIsLoading(true);
        const data = await api.sources.sourcesControllerGetSource({
          id: sourceId,
        });
        if (!data) {
          throw new Error("Source not found");
        }
        setSource({
          id: data.id || sourceId,
          name: data.name || "",
          type: (data.type as SourceType) || "WORDPRESS",
          config: data.config as Record<string, unknown> | undefined,
        });
        // Read schedule fields from source response
        if (data.scheduleEnabled) {
          setSchedule({
            enabled: true,
            preset: "custom",
            cron:
              typeof data.scheduleCron === "string" ? data.scheduleCron : "",
            timezone:
              typeof data.scheduleTimezone === "string"
                ? data.scheduleTimezone
                : "UTC",
          });
        }
      } catch (error) {
        console.error("Failed to fetch source:", error);
        toast.error(
          error instanceof Error
            ? `Failed to load source: ${error.message}`
            : "Failed to load source",
        );
        router.push("/sources");
      } finally {
        setIsLoading(false);
      }
    };

    if (sourceId) {
      fetchSource();
    }
  }, [sourceId, router]);

  const formDefaults = useMemo(() => {
    const {
      detectors: _detectors,
      custom_detectors: _customDetectors,
      ...configFields
    } = (source?.config || {}) as Record<string, unknown>;
    return { ...configFields, name: source?.name || "" };
  }, [source?.config, source?.name]);

  const defaultDetectors = useMemo(() => {
    const configDetectors = (source?.config as { detectors?: unknown })
      ?.detectors;
    if (!Array.isArray(configDetectors)) {
      return [] as DetectorConfigInput[];
    }
    return configDetectors.map((detector) => ({
      type: String((detector as { type?: unknown }).type ?? ""),
      enabled: Boolean((detector as { enabled?: unknown }).enabled ?? true),
      config: (detector as { config?: Record<string, unknown> }).config ?? {},
    }));
  }, [source?.config]);

  useEffect(() => {
    setDetectors(defaultDetectors);
  }, [defaultDetectors]);

  useEffect(() => {
    const configured = (source?.config as { custom_detectors?: unknown })
      ?.custom_detectors;
    if (!Array.isArray(configured)) {
      setSelectedCustomDetectorIds([]);
      return;
    }
    setSelectedCustomDetectorIds(
      configured
        .map((entry) => String(entry).trim())
        .filter((entry) => entry.length > 0),
    );
  }, [source?.config]);

  const assistantBridge = useMemo(() => {
    if (!source) {
      return null;
    }

    return {
      contextKey: "source.edit" as const,
      canOpen: true,
      getContext: async () => {
        const formValues = sourceFormRef.current?.getValues() ?? formDefaults;
        const validation = (await sourceFormRef.current?.validate()) ?? {
          isValid: false,
          missingFields: [],
          errors: ["Source form is not mounted"],
        };

        return {
          key: "source.edit" as const,
          route: `/sources/${sourceId}/edit`,
          title: t("sources.new.editAssistant"),
          entityId: source.id,
          values: formValues,
          schema: sourceFormRef.current?.getSchema() as Record<
            string,
            unknown
          > | null,
          validation,
          metadata: {
            sourceType: source.type,
            schedule,
            detectors: normalizeDetectors(detectors),
            customDetectorIds: selectedCustomDetectorIds,
          },
          supportedOperations: [
            "update_source",
            "test_source_connection",
          ] satisfies AssistantOperation[],
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
          setSource((current) =>
            current
              ? {
                  ...current,
                  id: action.sourceId,
                  name:
                    typeof action.values.name === "string"
                      ? action.values.name
                      : current.name,
                  config: action.values,
                }
              : current,
          );
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
    formDefaults,
    schedule,
    selectedCustomDetectorIds,
    source,
    sourceId,
  ]);

  useRegisterAssistantBridge(assistantBridge);

  const persistSource = async (data: Record<string, unknown>) => {
    if (!source) return;

    try {
      setIsSavingConfig(true);

      const {
        name,
        type: _type,
        detectors: _detectors,
        ...configFields
      } = data;
      const detectorPayload = normalizeDetectors(detectors);
      const config = {
        type: source.type,
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

      const updated = await api.sources.sourcesControllerUpdateSource({
        id: sourceId,
        updateSourceDto: {
          name: name ? String(name) : undefined,
          config,
          ...scheduleFields,
        },
      });

      if (updated) {
        setSource({
          id: updated.id || sourceId,
          name: updated.name || source.name,
          type: (updated.type as SourceType) || source.type,
          config: updated.config as Record<string, unknown> | undefined,
        });
      }

      return true;
    } catch (error) {
      console.error("Failed to update source:", error);
      toast.error(
        error instanceof Error
          ? `Failed to update source: ${error.message}`
          : "Failed to update source",
      );
      return false;
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleTestConfig = async (data: Record<string, unknown>) => {
    if (!source) return;

    try {
      setTestConnectionDialog({
        open: true,
        status: "loading",
        message: t("sources.new.testingConnection"),
      });
      setIsTestingConfig(true);

      const didPersist = await persistSource(data);
      if (!didPersist) return;

      const result = await api.sources.sourcesControllerTestConnection({
        id: sourceId,
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
        "Failed to test connection",
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

  const handleSaveAndRun = async (data: Record<string, unknown>) => {
    if (!source) return;

    try {
      const didPersist = await persistSource(data);
      if (!didPersist) return;

      toast.success(t("sources.updated", { name: source.name }));
      const startRunnerDto: StartRunnerDto = { triggerType: "MANUAL" };
      const runner = await api.runners.cliRunnerControllerStartRunner({
        sourceId,
        startRunnerDto,
      });
      if (runner?.id) {
        router.push(`/scans/${runner.id}`);
      } else {
        router.push("/scans");
      }
    } catch (error) {
      console.error("Failed to save and run source:", error);
      toast.error(
        error instanceof Error
          ? `Failed to update source: ${error.message}`
          : "Failed to update source",
      );
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <DetailBackButton fallbackHref="/sources" />
          <div>
            <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
              {t("sources.editSource")}
            </h1>
            <p className="text-muted-foreground">{t("sources.edit.loading")}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!source) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <DetailBackButton fallbackHref="/sources" />
        <div>
          <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
            {t("sources.editSource")}
          </h1>
          <p className="text-muted-foreground">
            {t("sources.edit.configure", { name: source.name })}
          </p>
        </div>
      </div>

      <SourceEditStepperContent
        sourceType={source.type}
        sourceId={sourceId}
        sourceFormRef={sourceFormRef}
        formDefaults={formDefaults}
        defaultDetectors={defaultDetectors}
        schedule={schedule}
        isSavingConfig={isSavingConfig}
        isTestingConfig={isTestingConfig}
        onSave={async (data) => {
          const didPersist = await persistSource(data);
          if (!didPersist) return;
          toast.success(t("sources.updated", { name: source.name }));
        }}
        onTestConfig={handleTestConfig}
        onSaveAndRun={handleSaveAndRun}
        onDetectorsChange={setDetectors}
        selectedCustomDetectorIds={selectedCustomDetectorIds}
        onCustomDetectorsChange={setSelectedCustomDetectorIds}
        onScheduleChange={setSchedule}
      />

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

function SourceEditStepperContent({
  sourceType,
  sourceId: _sourceId,
  sourceFormRef,
  formDefaults,
  defaultDetectors,
  schedule,
  isSavingConfig,
  isTestingConfig,
  onSave,
  onTestConfig,
  onSaveAndRun,
  onDetectorsChange,
  selectedCustomDetectorIds,
  onCustomDetectorsChange,
  onScheduleChange,
}: {
  sourceType: SourceType;
  sourceId: string;
  sourceFormRef: RefObject<SourceFormHandle | null>;
  formDefaults: Record<string, unknown>;
  defaultDetectors: DetectorConfigInput[];
  schedule: ScheduleValue;
  isSavingConfig: boolean;
  isTestingConfig: boolean;
  onSave: (data: Record<string, unknown>) => void | Promise<void>;
  onTestConfig: (data: Record<string, unknown>) => void;
  onSaveAndRun: (data: Record<string, unknown>) => void;
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

  const withValidFormData = async (
    handler: (data: Record<string, unknown>) => void | Promise<void>,
  ) => {
    const validation = await sourceFormRef.current?.validate();
    if (!validation?.isValid) {
      const errorMsg = validation?.errors?.length 
        ? `${t("sources.new.incompleteSettings")}: ${validation.errors.slice(0, 3).join(", ")}`
        : t("sources.new.incompleteSettings");
      toast.error(errorMsg);
      scrollToSection("config");
      return;
    }
    await handler(sourceFormRef.current?.getValues() ?? {});
  };

  return (
    <div>
      {/* Mobile sticky horizontal nav */}
      <div className="sticky top-0 z-20 -mx-4 mb-6 border-b-2 border-black bg-background/95 px-4 py-2 backdrop-blur-sm md:hidden">
        <HorizontalStepperNav
          activeStepId={activeStepId}
          configSaved={true}
          onNavigate={scrollToSection}
        />
      </div>

      {/* Desktop: content + right sticky sidebar */}
      <div className="flex gap-8 lg:gap-12">
        {/* Scrollable content */}
        <div className="min-w-0 flex-1 space-y-16 pb-32">
          <section ref={configRef}>
            <Card className="rounded-[6px] border-2 border-black shadow-[6px_6px_0_#000]">
              <CardHeader>
                <CardTitle className="uppercase tracking-[0.06em]">
                  {t("sources.edit.configuration")}
                </CardTitle>
                <CardDescription>
                  {t("sources.edit.updateSettings")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SourceForm
                  ref={sourceFormRef}
                  sourceType={sourceType}
                  defaultValues={formDefaults}
                  onSubmit={() => undefined}
                  onTest={onTestConfig}
                  mode="edit"
                  disabled={isSavingConfig || isTestingConfig}
                  showActions={false}
                  schedule={schedule}
                  onScheduleChange={onScheduleChange}
                />
              </CardContent>
            </Card>
          </section>

          <section ref={detectorsRef}>
            <SourceDetectorConfigCard
              visibleCount={scanSummary.visibleCount}
              enabledCount={scanSummary.enabledCount}
              isSaving={isSavingConfig || isTestingConfig}
              onBack={() => scrollToSection("config")}
              onSave={() => undefined}
              onSaveAndScan={() => undefined}
              showActions={false}
            >
              <SourceScanConfig
                defaultDetectors={defaultDetectors}
                onDetectorsChange={onDetectorsChange}
                onSummaryChange={setScanSummary}
                selectedCustomDetectorIds={selectedCustomDetectorIds}
                onCustomDetectorsChange={onCustomDetectorsChange}
                mode="edit"
              />
            </SourceDetectorConfigCard>
          </section>
          <StickyActionToolbar
            onSave={() => void withValidFormData(onSave)}
            onTest={() => void withValidFormData(onTestConfig)}
            onSaveAndRun={() => void withValidFormData(onSaveAndRun)}
            saveLabel={t("common.save")}
            testLabel={t("sources.edit.testSource")}
            saveAndRunLabel={t("sources.edit.saveAndScan")}
            isBusy={isSavingConfig || isTestingConfig}
            className="mt-0"
          />
        </div>

        {/* Right sticky sidebar — desktop only */}
        <aside className="hidden self-start md:sticky md:top-6 md:block md:w-44 lg:w-52">
          <VerticalStepperNav
            activeStepId={activeStepId}
            configSaved={true}
            onNavigate={scrollToSection}
          />
        </aside>
      </div>

    </div>
  );
}
