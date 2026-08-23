"use client";

import { nsPath } from "@/lib/ns-path";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { useRouteId } from "@/lib/use-route-id";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  useRegisterAssistantBridge,
  type AssistantPageBridge,
} from "@/components/assistant-workflow-provider";
import { buildSourceMentions } from "@/lib/assistant-source-mentions";
import {
  SourceForm,
  type SourceFormHandle,
  type SourceType,
} from "@/components/source-form";
import {
  SourceScanConfig,
  type DetectorConfigInput,
  type SourceScanConfigHandle,
} from "@/components/source-scan-config";
import { SourceDetectorConfigCard } from "@/components/source-detector-config-card";
import {
  CUSTOM_SOURCE_STEP_IDS,
  DEFAULT_SOURCE_STEP_IDS,
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
  scheduleFieldsFor,
  type AutoScheduleStatus,
  type ScheduleValue,
} from "@/components/schedule-card";
import { toast } from "sonner";
import {
  api,
  type AssistantUiAction,
  type StartRunnerDto,
} from "@workspace/api-client";
import {
  flattenObjectToPatches,
  setValueAtPath,
} from "@/lib/assistant-form-utils";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import { useTranslation } from "@/hooks/use-translation";
import {
  UploadedFiles,
  type UploadedFileMetadata,
} from "@/components/uploaded-files";
import {
  deleteSourceFile,
  listSourceFiles,
  uploadSourceFile,
} from "@/lib/source-files-api";
import { Eye, Play } from "lucide-react";
import { Button } from "@workspace/ui/components/button";

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
  const sourceId = useRouteId();
  const sourceFormRef = useRef<SourceFormHandle | null>(null);
  const lastSaveError = useRef<string | null>(null);
  const [source, setSource] = useState<{
    id: string;
    name: string;
    description: string;
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
  const [autoStatus, setAutoStatus] = useState<AutoScheduleStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isTestingConfig, setIsTestingConfig] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileMetadata[]>(
    [],
  );
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingRemovalIds, setPendingRemovalIds] = useState<Set<string>>(
    new Set(),
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
          description: data.description ?? "",
          type: (data.type as SourceType) || "WORDPRESS",
          config: data.config as Record<string, unknown> | undefined,
        });
        if (data.type === "SANDBOX") {
          setUploadedFiles(await listSourceFiles(sourceId));
        }
        // Read schedule fields from source response. `scheduleMode` is the
        // authoritative one — an AUTO source has no cron and scheduleEnabled
        // false, so reading the old pair alone would show it as unscheduled.
        const mode =
          typeof data.scheduleMode === "string" ? data.scheduleMode : undefined;
        if (mode === "AUTO") {
          setSchedule(defaultScheduleValue({ mode: "AUTO" }));
          setAutoStatus({
            phase:
              (data.autoPhase as AutoScheduleStatus["phase"]) ?? "CATCH_UP",
            nextRunAt: data.scheduleNextAt ?? null,
            reason: (data.autoReason as string | null) ?? null,
          });
        } else if (data.scheduleEnabled) {
          setSchedule({
            enabled: true,
            mode: "CRON",
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
        router.push(nsPath("/sources"));
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
    return {
      ...configFields,
      name: source?.name || "",
      description: source?.description || "",
    };
  }, [source?.config, source?.name, source?.description]);

  const configuredDetectors = useMemo(() => {
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

  // What the detector card seeds its switches from. It starts as whatever the
  // source was saved with, but the assistant can replace it -- which is why it
  // is state here rather than the memo it is derived from.
  const [defaultDetectors, setDetectorDefaults] = useState<
    DetectorConfigInput[]
  >([]);

  useEffect(() => {
    setDetectors(configuredDetectors);
    setDetectorDefaults(configuredDetectors);
  }, [configuredDetectors]);

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

  const assistantBridge = useMemo<AssistantPageBridge | null>(() => {
    if (!source) {
      return null;
    }

    // CUSTOM only, for the same reason as the create page: the assistant is
    // here to write the notebook, and no other source type has one. Registered
    // but closed rather than absent -- with no bridge at all the global
    // assistant would take over the page.
    if (source.type !== "CUSTOM") {
      return {
        contextKey: "source.edit" as const,
        canOpen: false,
        getContext: () => ({
          key: "source.edit" as const,
          route: `/sources/${sourceId}/edit`,
          title: t("sources.new.editAssistant"),
          entityId: source.id,
          values: {},
          schema: null,
          validation: { isValid: true, missingFields: [], errors: [] },
          metadata: { sourceType: source.type },
        }),
        applyAction: () => undefined,
      };
    }

    return {
      contextKey: "source.edit" as const,
      canOpen: true,
      // The assistant checks its own work: it proposes a run, the user confirms,
      // and this saves the source and hands back what happened — stdout, or the
      // traceback with the failing line — for the assistant to fix.
      runNotebook: async ({ mode, cellId }) => {
        const validation = await sourceFormRef.current?.validate();
        if (!validation?.isValid) {
          return [
            "The run did not start: the source form is not valid yet.",
            validation?.missingFields?.length
              ? `Missing: ${validation.missingFields.join(", ")}`
              : "",
            validation?.errors?.length
              ? `Errors: ${validation.errors.join("; ")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n");
        }
        const values = sourceFormRef.current?.getValues() ?? {};
        const persisted = await persistSource(values);
        if (!persisted) {
          return "The run did not start: saving the source failed.";
        }
        return (
          (await sourceFormRef.current?.runNotebookAndSummarize(
            mode,
            cellId,
          )) ?? "The notebook could not be run."
        );
      },
      getMentions: () =>
        buildSourceMentions({
          cells: sourceFormRef.current?.getNotebookContext()?.cells ?? null,
          files: [
            ...uploadedFiles.map((file) => ({
              name: file.fileName,
              detail: "uploaded",
            })),
            ...pendingFiles.map((file) => ({
              name: file.name,
              detail: "pending upload — saved with the source",
            })),
          ],
          localFolders:
            sourceFormRef.current?.getNotebookContext()?.localFolders ?? [],
          detectors,
        }),
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
            notebookConfig: sourceFormRef.current?.getNotebookContext() ?? null,
            attachedFiles: [
              ...uploadedFiles.map((file) => file.fileName),
              ...pendingFiles.map((file) => file.name),
            ],
          },
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

        if (action.type === "notebook_edit") {
          const touched = sourceFormRef.current?.applyNotebookOperations(
            action.operations,
          );
          if (touched && touched.length > 0) {
            toast.success(t("sources.new.notebookUpdated"), {
              description: action.summary ?? touched.join(", "),
            });
          }
          return;
        }

        if (action.type === "set_detectors") {
          const next = action.detectors.map((detector) => ({
            type: detector.type,
            enabled: detector.enabled ?? true,
            config: detector.config ?? {},
          }));
          // Both, on purpose: the selection the page submits AND the defaults
          // the detector card seeds itself from. Setting only the first leaves
          // every switch showing the old answer.
          setDetectors(next);
          setDetectorDefaults(next);
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
    pendingFiles,
    schedule,
    selectedCustomDetectorIds,
    source,
    sourceId,
    t,
    uploadedFiles,
  ]);

  useRegisterAssistantBridge(assistantBridge);

  const persistUploadedFiles = async () => {
    if (source?.type !== "SANDBOX") return true;
    const retained = uploadedFiles.filter(
      (file) => !pendingRemovalIds.has(file.id),
    );
    const uploadResults = await Promise.allSettled(
      pendingFiles.map((file) => uploadSourceFile(sourceId, file)),
    );
    const additions = uploadResults
      .filter(
        (result): result is PromiseFulfilledResult<UploadedFileMetadata> =>
          result.status === "fulfilled",
      )
      .map((result) => result.value);
    if (retained.length + additions.length === 0) {
      toast.error(t("sources.uploadedFiles.keepOne"));
      return false;
    }

    const removalIds = [...pendingRemovalIds];
    const deletionResults = await Promise.allSettled(
      removalIds.map((fileId) => deleteSourceFile(sourceId, fileId)),
    );
    const failedDeletionIds = new Set(
      removalIds.filter(
        (_, index) => deletionResults[index]?.status === "rejected",
      ),
    );
    setUploadedFiles([
      ...uploadedFiles.filter(
        (file) =>
          !pendingRemovalIds.has(file.id) || failedDeletionIds.has(file.id),
      ),
      ...additions,
    ]);
    setPendingFiles(
      pendingFiles.filter(
        (_, index) => uploadResults[index]?.status === "rejected",
      ),
    );
    setPendingRemovalIds(failedDeletionIds);

    const uploadFailures = uploadResults.filter(
      (result) => result.status === "rejected",
    ).length;
    if (uploadFailures > 0)
      toast.error(
        t("sources.uploadedFiles.uploadFailures", { count: uploadFailures }),
      );
    if (failedDeletionIds.size > 0)
      toast.error(
        t("sources.uploadedFiles.deletionFailures", {
          count: failedDeletionIds.size,
        }),
      );
    return true;
  };

  const persistSource = async (data: Record<string, unknown>) => {
    if (!source) return;

    try {
      setIsSavingConfig(true);

      if (
        source.type === "SANDBOX" &&
        uploadedFiles.filter((file) => !pendingRemovalIds.has(file.id)).length +
          pendingFiles.length ===
          0
      ) {
        toast.error(t("sources.uploadedFiles.keepOne"));
        return false;
      }

      const {
        name,
        description,
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

      const scheduleFields = scheduleFieldsFor(schedule);

      const updated = await api.sources.sourcesControllerUpdateSource({
        id: sourceId,
        updateSourceDto: {
          name: name ? String(name) : undefined,
          description:
            typeof description === "string" ? description : undefined,
          config,
          ...scheduleFields,
        },
      });

      if (!(await persistUploadedFiles())) return false;

      if (updated) {
        setSource({
          id: updated.id || sourceId,
          name: updated.name || source.name,
          description: updated.description ?? "",
          type: (updated.type as SourceType) || source.type,
          config: updated.config as Record<string, unknown> | undefined,
        });
      }

      lastSaveError.current = null;
      return true;
    } catch (error) {
      console.error("Failed to update source:", error);
      const message = await extractApiErrorMessage(
        error,
        "Failed to update source",
      );
      lastSaveError.current = message;
      toast.error(message);
      return false;
    } finally {
      setIsSavingConfig(false);
    }
  };

  /** Clear the circuit breaker on a source whose automatic scanning was paused. */
  const handleResumeSchedule = async () => {
    try {
      await api.sources.sourcesControllerResumeSchedule({ id: sourceId });
      setAutoStatus({
        phase: "CATCH_UP",
        nextRunAt: new Date(),
        reason: "Resumed by an operator.",
      });
      toast.success(t("sources.schedule.resumed"));
    } catch (error) {
      toast.error(
        extractApiErrorMessage(error, "Failed to resume automatic scanning"),
      );
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
      if (!didPersist) {
        // Saving the config failed (e.g. the update request was rejected). Move
        // the dialog out of the locked "loading" state and show why, instead of
        // leaving it stuck on the spinner with no way to close.
        setTestConnectionDialog({
          open: true,
          status: "error",
          message: lastSaveError.current ?? t("sources.new.connectionFailed"),
        });
        return;
      }

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
        router.push(nsPath(`/scans/${runner.id}`));
      } else {
        router.push(nsPath("/scans"));
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
        autoStatus={autoStatus}
        onResumeSchedule={handleResumeSchedule}
        uploadedFiles={uploadedFiles}
        pendingFiles={pendingFiles}
        pendingRemovalIds={pendingRemovalIds}
        onPendingFilesChange={setPendingFiles}
        onPendingRemovalIdsChange={setPendingRemovalIds}
        onUploadedFilesChange={setUploadedFiles}
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
  sourceId,
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
  autoStatus,
  onResumeSchedule,
  uploadedFiles,
  pendingFiles,
  pendingRemovalIds,
  onPendingFilesChange,
  onPendingRemovalIdsChange,
  onUploadedFilesChange,
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
  autoStatus: AutoScheduleStatus | null;
  onResumeSchedule: () => Promise<void>;
  uploadedFiles: UploadedFileMetadata[];
  pendingFiles: File[];
  pendingRemovalIds: Set<string>;
  onPendingFilesChange: (files: File[]) => void;
  onPendingRemovalIdsChange: (ids: Set<string>) => void;
  onUploadedFilesChange: (files: UploadedFileMetadata[]) => void;
}) {
  const { t } = useTranslation();
  const isCustom = sourceType === "CUSTOM";
  const configRef = useRef<HTMLDivElement>(null);
  const detectorsRef = useRef<HTMLDivElement>(null);
  // A CUSTOM source registers one anchor per section of its config, so the
  // stepper walks the page the way it actually reads instead of calling four
  // screens of scrolling "Source details".
  const customSectionsRef = useRef(new Map<SourceStepId, HTMLElement>());
  const [activeStepId, setActiveStepId] = useState<SourceStepId>("config");
  const [notebookBusy, setNotebookBusy] = useState(false);
  const [scanSummary, setScanSummary] = useState({
    visibleCount: 0,
    enabledCount: 0,
  });
  const stepIds = isCustom ? CUSTOM_SOURCE_STEP_IDS : DEFAULT_SOURCE_STEP_IDS;

  const sectionElement = (id: SourceStepId): HTMLElement | null => {
    if (id === "config") return configRef.current;
    if (id === "detectors") return detectorsRef.current;
    return customSectionsRef.current.get(id) ?? null;
  };

  // IntersectionObserver: highlight whichever section is in the top half of the viewport.
  // Works correctly regardless of which DOM element is the actual scroll container.
  useEffect(() => {
    const els = stepIds
      .map((id) => ({ id, el: sectionElement(id) }))
      .filter((x): x is { id: SourceStepId; el: HTMLElement } => x.el !== null);

    const map = new Map<Element, SourceStepId>(
      els.map(({ id, el }) => [el, id]),
    );

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIds.join(",")]);

  const scrollToSection = (id: SourceStepId) => {
    sectionElement(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const scanConfigRef = useRef<SourceScanConfigHandle>(null);
  const hasRequiredFiles =
    sourceType !== "SANDBOX" ||
    uploadedFiles.filter((file) => !pendingRemovalIds.has(file.id)).length +
      pendingFiles.length >
      0;

  const withValidFormData = async (
    handler: (data: Record<string, unknown>) => void | Promise<void>,
  ) => {
    if (!hasRequiredFiles) {
      toast.error(t("sources.uploadedFiles.requiredBeforeContinue"));
      scrollToSection("config");
      return;
    }
    const validation = await sourceFormRef.current?.validate();
    if (!validation?.isValid) {
      const errorMsg = validation?.errors?.length
        ? `${t("sources.new.incompleteSettings")}: ${validation.errors.slice(0, 3).join(", ")}`
        : t("sources.new.incompleteSettings");
      toast.error(errorMsg);
      scrollToSection("config");
      return;
    }
    const flushed = await scanConfigRef.current?.flushDetectorChanges();
    if (flushed === false) return;
    await handler(sourceFormRef.current?.getValues() ?? {});
  };

  /**
   * Save the source, then execute the notebook.
   *
   * Every way of running goes through here — the toolbar's Run all and Preview,
   * and a cell's own play button — because an execution names a stored revision
   * of a stored source. Running before saving would execute the previous
   * version, which is worse than refusing.
   */
  const saveThenRun = (
    mode: "cell" | "all" | "test_connection" | "preview_extract",
    targetCellId?: string,
  ) =>
    withValidFormData(async (data) => {
      await onSave(data);
      await sourceFormRef.current?.runNotebook(mode, targetCellId);
    });

  return (
    <div>
      {/* Mobile sticky horizontal nav */}
      <div className="sticky top-0 z-20 -mx-4 mb-6 border-b-2 border-border bg-background/95 px-4 py-2 backdrop-blur-sm md:hidden">
        <HorizontalStepperNav
          activeStepId={activeStepId}
          configSaved={true}
          onNavigate={scrollToSection}
          stepIds={stepIds}
        />
      </div>

      {/* Desktop: content + right sticky sidebar */}
      <div className="flex gap-8 lg:gap-12">
        {/* Scrollable content */}
        <div className="min-w-0 flex-1 space-y-16 pb-32">
          <section ref={configRef}>
            <Card className="rounded-[6px] border-2 border-border shadow-[6px_6px_0_var(--color-border)]">
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
                  sourceId={sourceId}
                  defaultValues={formDefaults}
                  onSubmit={() => undefined}
                  onTest={onTestConfig}
                  mode="edit"
                  disabled={isSavingConfig || isTestingConfig}
                  showActions={false}
                  schedule={schedule}
                  onScheduleChange={onScheduleChange}
                  autoScheduleStatus={autoStatus}
                  onResumeSchedule={onResumeSchedule}
                  files={uploadedFiles}
                  onFilesChange={onUploadedFilesChange}
                  onNotebookBusyChange={setNotebookBusy}
                  onRunCell={(cellId) => void saveThenRun("cell", cellId)}
                  customSectionRef={(id, element) => {
                    if (element) customSectionsRef.current.set(id, element);
                    else customSectionsRef.current.delete(id);
                  }}
                  afterNameContent={
                    sourceType === "SANDBOX" ? (
                      // SANDBOX keeps its own card: its files are the source,
                      // not one input among several.
                      <Card className="rounded-[6px] border-2 border-border">
                        <CardHeader>
                          <CardTitle className="uppercase tracking-[0.06em]">
                            {t("sources.uploadedFiles.title")}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <UploadedFiles
                            existingFiles={uploadedFiles}
                            sourceId={sourceId}
                            onFilesChange={onUploadedFilesChange}
                            requireAtLeastOne
                            disabled={isSavingConfig || isTestingConfig}
                          />
                        </CardContent>
                      </Card>
                    ) : undefined
                  }
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
                ref={scanConfigRef}
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
            disabled={!hasRequiredFiles}
            className="mt-0"
            extraActions={
              isCustom ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void saveThenRun("all")}
                    disabled={isSavingConfig || isTestingConfig || notebookBusy}
                    data-testid="notebook-run-all"
                  >
                    <Play className="mr-2 h-4 w-4" />
                    {t("notebook.runAll")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void saveThenRun("preview_extract")}
                    disabled={isSavingConfig || isTestingConfig || notebookBusy}
                    data-testid="notebook-preview"
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    {t("notebook.previewExtract")}
                  </Button>
                </>
              ) : null
            }
          />
        </div>

        {/* Right sticky sidebar — desktop only */}
        <aside className="hidden self-start md:sticky md:top-6 md:block md:w-44 lg:w-52">
          <VerticalStepperNav
            activeStepId={activeStepId}
            configSaved={true}
            onNavigate={scrollToSection}
            stepIds={stepIds}
          />
        </aside>
      </div>
    </div>
  );
}
