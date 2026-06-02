"use client";

import Link from "next/link";
import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Check, FlaskConical, Pencil, Plus, Search, X } from "lucide-react";
import { api, type CustomDetectorResponseDto } from "@workspace/api-client";
import { useTranslation } from "@/hooks/use-translation";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Form } from "@workspace/ui/components/form";
import { Input } from "@workspace/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectPrimitive,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Toggle } from "@workspace/ui/components/toggle";
import {
  Collapsible,
  CollapsibleContent,
} from "@workspace/ui/components/collapsible";
import { cn } from "@workspace/ui/lib/utils";
import { JsonSchemaFields, buildFormDefaults } from "./json-schema-form";
import {
  getDetectorSchemas,
  type DetectorSchemaInfo,
} from "@/lib/detector-schema-loader";
import {
  getDetectorExamples,
  type DetectorExample,
} from "@/lib/detector-examples-loader";
import { DetectorCreatorForm } from "@/components/detector-creator-form";
import { DetectorEditorForm } from "@/components/detector-editor-form";
import type { DetectorEditorFormHandle } from "@/components/detector-editor-form";
import { CustomDetectorTypeBadge, VisualScanBadge } from "@/components/detector-type-badge";
import { isVisualDetector } from "@/lib/custom-detector-badge";
import { useDetectorVision } from "@/hooks/use-detector-vision";

export interface DetectorConfigInput {
  type: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}

interface DetectorConfigState {
  id: string;
  type: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface SourceScanConfigHandle {
  flushDetectorChanges: () => Promise<boolean>;
}

interface SourceScanConfigProps {
  defaultDetectors?: DetectorConfigInput[];
  onDetectorsChange?: (detectors: DetectorConfigInput[]) => void;
  onSummaryChange?: (summary: {
    visibleCount: number;
    enabledCount: number;
  }) => void;
  selectedCustomDetectorIds?: string[];
  onCustomDetectorsChange?: (ids: string[]) => void;
  mode?: "create" | "edit";
}

type DetectorPresetOption = DetectorExample & {
  id: string;
  normalizedConfig: Record<string, unknown>;
};

function formatDetectorName(title: string) {
  return title
    .replace(/DetectorConfig$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
}


function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (a && typeof a === "object" && b && typeof b === "object") {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) =>
      deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ),
    );
  }
  return false;
}

function matchesSearch(
  detector: DetectorSchemaInfo,
  presets: DetectorExample[],
  searchTerm: string,
): boolean {
  if (!searchTerm) {
    return true;
  }

  const displayName = formatDetectorName(detector.title);
  const terms = [
    detector.type,
    displayName,
    detector.description,
    detector.notes,
    detector.recommendedModel,
    detector.categories.join(" "),
    ...presets.map((preset) => preset.name),
    ...presets.map((preset) => preset.description),
  ]
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    )
    .join(" ")
    .toLowerCase();

  return terms.includes(searchTerm);
}

function matchesCustomDetectorSearch(
  detector: CustomDetectorResponseDto,
  searchTerm: string,
): boolean {
  if (!searchTerm) {
    return true;
  }

  const terms = [
    "custom detector",
    detector.name,
    detector.key,
    detector.method,
    detector.description ?? "",
    ...detector.recentSourceNames,
  ]
    .join(" ")
    .toLowerCase();

  return terms.includes(searchTerm);
}

function DetectorConfigRow({
  detector,
  enabled,
  defaultConfig,
  presets,
  onStateChange,
}: {
  detector: DetectorSchemaInfo;
  enabled: boolean;
  defaultConfig: Record<string, unknown>;
  presets: DetectorExample[];
  onStateChange: (next: {
    enabled?: boolean;
    config?: Record<string, unknown>;
  }) => void;
}) {
  const { t } = useTranslation();
  const normalizedCurrentConfig = useMemo(
    () => buildFormDefaults(detector.schema, defaultConfig),
    [detector.schema, defaultConfig],
  );

  const form = useForm({
    defaultValues: normalizedCurrentConfig,
  });

  useEffect(() => {
    form.reset(normalizedCurrentConfig);
  }, [form, normalizedCurrentConfig]);

  useEffect(() => {
    const subscription = form.watch((value) => {
      onStateChange({ config: value as Record<string, unknown> });
    });
    return () => subscription.unsubscribe();
  }, [form, onStateChange]);

  const displayName = formatDetectorName(detector.title);

  const presetOptions = useMemo<DetectorPresetOption[]>(
    () =>
      presets.map((preset) => ({
        id: preset.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        normalizedConfig: buildFormDefaults(detector.schema, preset.config),
        ...preset,
      })),
    [presets, detector.schema],
  );

  const matchingPresetId = useMemo(() => {
    if (!enabled) return null;
    const match = presetOptions.find((preset) =>
      deepEqual(normalizedCurrentConfig, preset.normalizedConfig),
    );
    return match ? match.id : null;
  }, [enabled, normalizedCurrentConfig, presetOptions]);

  const [selectedPreset, setSelectedPreset] = useState<string | null>(() => {
    if (!enabled) return null;
    return matchingPresetId ?? "custom";
  });

  const [isEditOpen, setIsEditOpen] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setSelectedPreset(null);
      setIsEditOpen(false);
      return;
    }
    if (matchingPresetId) {
      setSelectedPreset(matchingPresetId);
    } else {
      setSelectedPreset("custom");
    }
  }, [enabled, matchingPresetId]);

  const handlePresetSelect = (presetId: string) => {
    if (presetId === "custom") {
      setSelectedPreset("custom");
      return;
    }
    const preset = presetOptions.find((option) => option.id === presetId);
    if (!preset) return;
    const nextConfig = preset.normalizedConfig;
    setSelectedPreset(presetId);
    form.reset(nextConfig);
    onStateChange({ enabled: true, config: nextConfig });
  };

  const handleResetDefaults = () => {
    const nextConfig = buildFormDefaults(detector.schema, {});
    form.reset(nextConfig);
    onStateChange({ config: nextConfig });
  };

  const selectedPresetLabel =
    selectedPreset && selectedPreset !== "custom"
      ? presetOptions.find((preset) => preset.id === selectedPreset)?.name
      : null;

  return (
    <div
      className={cn(
        "border-b-2 border-border last:border-b-0 border-l-4 transition-colors",
        enabled ? "border-l-[#b7ff00]" : "border-l-transparent",
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <CustomDetectorTypeBadge
          method={detector.type}
          className="shrink-0"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-sm truncate",
                enabled ? "font-semibold" : "font-medium text-muted-foreground",
              )}
            >
              {displayName}
            </span>
            {selectedPresetLabel && (
              <Badge variant="outline" className="border-2 border-border shrink-0 text-[10px]">
                {selectedPresetLabel}
              </Badge>
            )}
          </div>
          {detector.description && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {detector.description}
            </p>
          )}
          {detector.categories.length > 0 && (
            <p className="text-[10px] font-mono text-muted-foreground/60 mt-0.5">
              {detector.categories.join(" • ")} • {t("detectors.prebuilt")}
            </p>
          )}
        </div>

        {enabled && (
          <Button
            type="button"
            size="sm"
            variant={isEditOpen ? "default" : "outline"}
            className="shrink-0 rounded-[4px] border-2 border-border"
            onClick={() => setIsEditOpen((prev) => !prev)}
            data-testid={`btn-edit-${detector.type}`}
          >
            {isEditOpen ? (
              <>
                <X className="h-3.5 w-3.5 mr-1" />
                {t("common.close")}
              </>
            ) : (
              <>
                <Pencil className="h-3.5 w-3.5 mr-1" />
                {t("sources.scanConfig.edit")}
              </>
            )}
          </Button>
        )}

        <Toggle
          variant="outline"
          size="sm"
          pressed={enabled}
          onPressedChange={(pressed) => {
            if (!pressed) {
              setIsEditOpen(false);
            }
            onStateChange({ enabled: pressed });
          }}
          className="shrink-0 cursor-pointer"
          data-testid={`detector-toggle-${detector.type}`}
        >
          {enabled ? t("common.on") : t("common.off")}
        </Toggle>
      </div>

      <Collapsible open={isEditOpen && enabled} onOpenChange={setIsEditOpen}>
        <CollapsibleContent>
          <div className="border-t-2 border-border bg-muted/20 px-4 py-4 space-y-4">
            {presetOptions.length > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground whitespace-nowrap shrink-0">
                  {t("sources.scanConfig.presets")}
                </span>
                <Select
                  value={selectedPreset ?? undefined}
                  onValueChange={handlePresetSelect}
                >
                  <SelectTrigger className="h-8 w-[260px] rounded-[4px] border-2 border-border text-xs">
                    <SelectValue placeholder={t("sources.scanConfig.presets")} />
                  </SelectTrigger>
                  <SelectContent>
                    {presetOptions.map((preset) => (
                      <SelectPrimitive.Item
                        key={preset.id}
                        value={preset.id}
                        className="relative flex w-full cursor-default select-none flex-col rounded-sm py-2 pr-8 pl-2 text-sm outline-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                      >
                        <span className="absolute right-2 top-2 flex size-3.5 items-center justify-center">
                          <SelectPrimitive.ItemIndicator>
                            <Check className="size-3.5" />
                          </SelectPrimitive.ItemIndicator>
                        </span>
                        <SelectPrimitive.ItemText>
                          <span className="text-xs font-medium">{preset.name}</span>
                        </SelectPrimitive.ItemText>
                        {preset.description && (
                          <span className="text-[10px] text-muted-foreground leading-tight mt-0.5 whitespace-normal max-w-[280px]">
                            {preset.description}
                          </span>
                        )}
                      </SelectPrimitive.Item>
                    ))}
                    <SelectPrimitive.Item
                      value="custom"
                      className="relative flex w-full cursor-default select-none rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                    >
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 flex size-3.5 items-center justify-center">
                        <SelectPrimitive.ItemIndicator>
                          <Check className="size-3.5" />
                        </SelectPrimitive.ItemIndicator>
                      </span>
                      <SelectPrimitive.ItemText>
                        <span className="text-xs font-medium">{t("sources.scanConfig.customize")}</span>
                      </SelectPrimitive.ItemText>
                    </SelectPrimitive.Item>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="rounded-[6px] border-2 border-border bg-background p-3">
              <Form {...form}>
                <div className="space-y-4">
                  <JsonSchemaFields
                    schema={detector.schema}
                    control={form.control}
                  />
                </div>
              </Form>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-[4px] border-2 border-border"
                onClick={handleResetDefaults}
                data-testid={`btn-reset-${detector.type}`}
              >
                {t("sources.scanConfig.reset")}
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function CustomDetectorRow({
  detector,
  enabled,
  isEditing,
  onToggle,
  onStartEdit,
  onCancelEdit,
  onEditorRef,
}: {
  detector: CustomDetectorResponseDto;
  enabled: boolean;
  isEditing: boolean;
  onToggle: (enabled: boolean) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onEditorRef?: (ref: DetectorEditorFormHandle | null) => void;
}) {
  const { t } = useTranslation();
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const { supportsVision } = useDetectorVision();

  const editorCallbackRef = useCallback(
    (node: DetectorEditorFormHandle | null) => {
      onEditorRef?.(node);
    },
    [onEditorRef],
  );

  return (
    <div
      className={cn(
        "border-b-2 border-border last:border-b-0 border-l-4 transition-colors",
        enabled ? "border-l-[#b7ff00]" : "border-l-transparent",
      )}
    >
        <div className="flex items-center gap-3 px-4 py-3">
        <CustomDetectorTypeBadge
          method={detector.method}
          pipelineType={(detector as any).pipelineSchema?.type as string | undefined}
          className="shrink-0"
        />
        {isVisualDetector(
          (detector as any).pipelineSchema?.type as string | undefined,
          supportsVision(detector.aiProviderConfigId),
        ) ? (
          <VisualScanBadge />
        ) : null}

        <div className="min-w-0 flex-1">
          <span
            className={cn(
              "text-sm truncate",
              enabled ? "font-semibold" : "font-medium text-muted-foreground",
            )}
          >
            {detector.name}
          </span>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {detector.description?.trim() || t("sources.scanConfig.fallbackDesc")}
          </p>
        </div>

        {enabled && (
          <Button
            type="button"
            size="sm"
            variant={isEditing ? "default" : "outline"}
            className="shrink-0 rounded-[4px] border-2 border-border"
            onClick={() => {
              if (isEditing) {
                onCancelEdit();
              } else {
                onStartEdit();
              }
              setIsDetailOpen((prev) => !prev);
            }}
            data-testid={`btn-edit-custom-${detector.key}`}
          >
            {isEditing ? (
              <>
                <X className="h-3.5 w-3.5 mr-1" />
                {t("common.close")}
              </>
            ) : (
              <>
                <Pencil className="h-3.5 w-3.5 mr-1" />
                {t("sources.scanConfig.edit")}
              </>
            )}
          </Button>
        )}

        <Toggle
          variant="outline"
          size="sm"
          pressed={enabled}
          onPressedChange={(pressed) => {
            if (!pressed) {
              onCancelEdit();
              setIsDetailOpen(false);
            }
            onToggle(pressed);
          }}
          className="shrink-0 cursor-pointer"
          data-testid={`toggle-custom-detector-${detector.key}`}
        >
          {enabled ? t("common.on") : t("common.off")}
        </Toggle>
      </div>

      <Collapsible open={isDetailOpen && isEditing} onOpenChange={setIsDetailOpen}>
        <CollapsibleContent>
          <div className="border-t-2 border-border bg-muted/20 px-4 py-4">
            <DetectorEditorForm
              ref={editorCallbackRef}
              detector={detector}
              embedded
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export const SourceScanConfig = React.forwardRef<
  SourceScanConfigHandle,
  SourceScanConfigProps
>(function SourceScanConfig({
  defaultDetectors,
  onDetectorsChange,
  onSummaryChange,
  selectedCustomDetectorIds = [],
  onCustomDetectorsChange,
  mode = "create",
}, ref) {
  const { t } = useTranslation();
  const detectors = useMemo(
    () => getDetectorSchemas({ includeCustom: false }),
    [],
  );
  const stableDefaults = useMemo(
    () => defaultDetectors ?? [],
    [defaultDetectors],
  );
  const defaultMap = useMemo(() => {
    return new Map(
      stableDefaults
        .filter((detector) => detector.type.toUpperCase() !== "CUSTOM")
        .map((detector) => [detector.type, detector]),
    );
  }, [stableDefaults]);

  const initialState = useMemo(() => {
    const initial: Record<string, DetectorConfigState> = {};
    detectors.forEach((detector) => {
      const defaults = defaultMap.get(detector.type);
      initial[detector.id] = {
        id: detector.id,
        type: detector.type,
        enabled: defaults?.enabled ?? false,
        config: defaults?.config ?? {},
      };
    });
    return initial;
  }, [detectors, defaultMap]);

  const [detectorState, setDetectorState] =
    useState<Record<string, DetectorConfigState>>(initialState);
  const [customDetectors, setCustomDetectors] = useState<
    CustomDetectorResponseDto[]
  >([]);
  const [customDetectorsLoading, setCustomDetectorsLoading] = useState(true);
  const [customDetectorsError, setCustomDetectorsError] = useState<
    string | null
  >(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | "BUILT_IN" | "CUSTOM">("ALL");
  const [displayOrder, setDisplayOrder] = useState<string[]>([]);
  const [isCreatingDetector, setIsCreatingDetector] = useState(false);
  const [editingDetectorId, setEditingDetectorId] = useState<string | null>(null);
  const [createFormKey, setCreateFormKey] = useState(0);
  const activeEditorRef = useRef<DetectorEditorFormHandle | null>(null);
  const loadTicketRef = useRef<object | null>(null);

  const presetMap = useMemo(
    () =>
      new Map(
        detectors.map((detector) => [
          detector.type,
          getDetectorExamples(detector.type),
        ]),
      ),
    [detectors],
  );

  useEffect(() => {
    setDetectorState(initialState);
  }, [initialState]);

  const loadCustomDetectors = useCallback(async () => {
    const ticket = {};
    loadTicketRef.current = ticket;
    try {
      setCustomDetectorsLoading(true);
      setCustomDetectorsError(null);
      const payload = await api.listCustomDetectors({
        includeInactive: true,
      });
      if (loadTicketRef.current === ticket) {
        setCustomDetectors(payload ?? []);
      }
    } catch (error) {
      if (loadTicketRef.current === ticket) {
        setCustomDetectors([]);
        setCustomDetectorsError(
          error instanceof Error
            ? error.message
            : "Failed to load custom detectors.",
        );
      }
    } finally {
      if (loadTicketRef.current === ticket) {
        setCustomDetectorsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadCustomDetectors();
  }, [loadCustomDetectors]);

  useEffect(() => {
    const ranked = detectors
      .map((detector, index) => ({
        id: detector.id,
        index,
        enabled: initialState[detector.id]?.enabled ?? false,
      }))
      .sort((left, right) => {
        if (mode === "edit" && left.enabled !== right.enabled) {
          return left.enabled ? -1 : 1;
        }
        return left.index - right.index;
      })
      .map((entry) => entry.id);

    setDisplayOrder(ranked);
  }, [detectors, initialState, mode]);

  useEffect(() => {
    onDetectorsChange?.(
      Object.values(detectorState).map((detector) => ({
        type: detector.type,
        enabled: detector.enabled,
        config: detector.config,
      })),
    );
  }, [detectorState, onDetectorsChange]);

  const orderedDetectors = useMemo(() => {
    const order =
      displayOrder.length > 0
        ? displayOrder
        : detectors.map((detector) => detector.id);
    const byId = new Map(detectors.map((detector) => [detector.id, detector]));
    return order
      .map((id) => byId.get(id))
      .filter((detector): detector is DetectorSchemaInfo => Boolean(detector));
  }, [detectors, displayOrder]);

  const searchTerm = searchQuery.trim().toLowerCase();

  const visibleBuiltInDetectors = useMemo(
    () =>
      typeFilter !== "CUSTOM"
        ? orderedDetectors.filter((detector) =>
            matchesSearch(detector, presetMap.get(detector.type) ?? [], searchTerm),
          )
        : [],
    [orderedDetectors, presetMap, searchTerm, typeFilter],
  );

  const selectedCustomDetectorSet = useMemo(
    () => new Set(selectedCustomDetectorIds),
    [selectedCustomDetectorIds],
  );
  const selectableCustomDetectors = useMemo(
    () =>
      customDetectors.filter(
        (detector) =>
          detector.isActive !== false ||
          selectedCustomDetectorSet.has(detector.id),
      ),
    [customDetectors, selectedCustomDetectorSet],
  );
  const visibleCustomDetectors = useMemo(
    () =>
      typeFilter !== "BUILT_IN"
        ? selectableCustomDetectors.filter((detector) =>
            matchesCustomDetectorSearch(detector, searchTerm),
          )
        : [],
    [searchTerm, selectableCustomDetectors, typeFilter],
  );

  const enabledCount =
    Object.values(detectorState).filter((detector) => detector.enabled).length +
    selectedCustomDetectorIds.length;
  const visibleCount =
    visibleBuiltInDetectors.length + visibleCustomDetectors.length;

  useEffect(() => {
    onSummaryChange?.({ visibleCount, enabledCount });
  }, [enabledCount, onSummaryChange, visibleCount]);

  const hasAnyVisibleResults =
    visibleBuiltInDetectors.length > 0 || visibleCustomDetectors.length > 0;

  const handleOpenCreator = () => {
    setCreateFormKey((k) => k + 1);
    setIsCreatingDetector(true);
  };

  const handleCloseCreator = () => {
    setIsCreatingDetector(false);
  };

  const handleDetectorCreated = useCallback(
    (detector: { id: string; name: string }) => {
      setIsCreatingDetector(false);
      void loadCustomDetectors();
      const nextIds = Array.from(
        new Set([...selectedCustomDetectorIds, detector.id]),
      );
      onCustomDetectorsChange?.(nextIds);
    },
    [loadCustomDetectors, onCustomDetectorsChange, selectedCustomDetectorIds],
  );

  React.useImperativeHandle(
    ref,
    () => ({
      flushDetectorChanges: async () => {
        if (!editingDetectorId || !activeEditorRef.current) return true;
        try {
          await activeEditorRef.current.submit();
          return true;
        } catch {
          return false;
        }
      },
    }),
    [editingDetectorId],
  );

  return (
    <div className="space-y-4" data-testid="scan-config-section">
      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              {t("sources.stepper.detectors")}
            </div>
            <div className="text-sm font-semibold uppercase tracking-[0.06em]">
              {t("sources.scanConfig.browseTitle")}
            </div>
            <p className="text-sm text-muted-foreground">
              {t("sources.scanConfig.browseDesc")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {t("sources.edit.visible", { count: visibleCount })}
            </Badge>
            <Badge className="rounded-[4px] border border-border bg-accent text-accent-foreground">
              {t("sources.edit.enabled", { count: enabledCount })}
            </Badge>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("sources.scanConfig.searchPlaceholder")}
              className="h-10 rounded-[4px] border-2 border-border bg-background pl-9 text-sm shadow-[3px_3px_0_var(--color-border)] focus-visible:ring-0"
            />
            {searchQuery ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSearchQuery("")}
                className="absolute right-1 top-1/2 h-7 -translate-y-1/2 rounded-[4px] px-2 text-xs"
              >
                Clear
              </Button>
            ) : null}
          </div>

          <Select
            value={typeFilter}
            onValueChange={(value) => setTypeFilter(value as typeof typeFilter)}
          >
            <SelectTrigger className="h-10 w-[150px] rounded-[4px] border-2 border-border shadow-[3px_3px_0_var(--color-border)] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("sources.scanConfig.filterAll")}</SelectItem>
              <SelectItem value="BUILT_IN">{t("sources.scanConfig.filterPrebuilt")}</SelectItem>
              <SelectItem value="CUSTOM">{t("sources.scanConfig.filterCustom")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {!hasAnyVisibleResults && searchTerm ? (
        <Card className="border-dashed border-border bg-muted/30 px-6 py-8 text-center shadow-[4px_4px_0_var(--color-border)]">
          <p className="text-sm font-semibold uppercase tracking-[0.08em]">
            {t("sources.scanConfig.noResults")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("sources.scanConfig.noDetectorsHint")}
          </p>
        </Card>
      ) : (
        <Card className="bg-background p-0 overflow-hidden">
          <div className="flex items-center justify-between border-b-2 border-border bg-foreground px-4 py-3">
            <div>
              <h3 className="text-xs font-mono font-bold uppercase tracking-[0.12em] text-primary-foreground">
                {t("sources.stepper.detectors")}
              </h3>
              <p className="text-[10px] font-mono text-primary-foreground/60">
                {t("sources.scanConfig.browseDesc")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selectableCustomDetectors.length > 0 && (
                <Button type="button" variant="outline" size="sm" asChild>
                  <Link href="/detectors">
                    <FlaskConical className="mr-1 h-3.5 w-3.5" />
                    {t("sources.scanConfig.manage")}
                  </Link>
                </Button>
              )}
              <Badge className="w-fit rounded-[4px] border-2 border-border bg-accent text-[10px] uppercase tracking-[0.16em] text-accent-foreground shadow-[3px_3px_0_var(--color-border)]">
                {t("sources.edit.enabled", { count: enabledCount })}
              </Badge>
            </div>
          </div>

          <CardContent className="p-0">
            {visibleBuiltInDetectors.map((detector) => {
              const state = detectorState[detector.id];
              const config = state?.config ?? {};
              const enabled = state?.enabled ?? false;

              return (
                <DetectorConfigRow
                  key={detector.id}
                  detector={detector}
                  enabled={enabled}
                  defaultConfig={config}
                  presets={presetMap.get(detector.type) ?? []}
                  onStateChange={(next) => {
                    setDetectorState((prev) => {
                      const current = prev[detector.id]!;
                      return {
                        ...prev,
                        [detector.id]: {
                          ...current,
                          enabled: next.enabled ?? current.enabled,
                          config: next.config ?? current.config,
                        } satisfies DetectorConfigState,
                      };
                    });
                  }}
                />
              );
            })}

            {customDetectorsError && (
              <div className="border-b-2 border-border p-4 text-center">
                <p className="text-sm font-medium">
                  {t("sources.scanConfig.loadError")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {customDetectorsError}
                </p>
              </div>
            )}

            {customDetectorsLoading && (
              <div className="border-b-2 border-border p-4 text-center">
                <p className="text-sm font-medium">
                  {t("sources.scanConfig.loading")}
                </p>
              </div>
            )}

            {!customDetectorsLoading &&
              !customDetectorsError &&
              visibleCustomDetectors.map((detector) => (
                <CustomDetectorRow
                  key={detector.id}
                  detector={detector}
                  enabled={selectedCustomDetectorSet.has(detector.id)}
                  isEditing={editingDetectorId === detector.id}
                  onToggle={(enabled) => {
                    const nextIds = enabled
                      ? Array.from(
                          new Set([...selectedCustomDetectorIds, detector.id]),
                        )
                      : selectedCustomDetectorIds.filter(
                          (id) => id !== detector.id,
                        );
                    onCustomDetectorsChange?.(nextIds);
                  }}
                  onStartEdit={() => {
                    setEditingDetectorId(detector.id);
                    activeEditorRef.current = null;
                  }}
                  onCancelEdit={() => setEditingDetectorId(null)}
                  onEditorRef={(ref) => {
                    if (editingDetectorId === detector.id) {
                      activeEditorRef.current = ref;
                    }
                  }}
                />
              ))}

            {visibleCount === 0 && !searchTerm && (
              <div className="p-6 text-center">
                <p className="text-sm font-medium">
                  {t("sources.scanConfig.noSchemas")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("sources.scanConfig.noSchemasHint")}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add new detector */}
      {!isCreatingDetector ? (
        <Button
          type="button"
          variant="outline"
          className="w-full rounded-[4px] border-2 border-border shadow-[3px_3px_0_var(--color-border)]"
          onClick={handleOpenCreator}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t("detectors.addNew")}
        </Button>
      ) : (
        <Card className="border-2 border-border shadow-[4px_4px_0_var(--color-border)]">
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-serif text-lg font-black uppercase tracking-[0.06em]">
                {t("detectors.addNew")}
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCloseCreator}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <DetectorCreatorForm
              key={createFormKey}
              embedded
              onCreated={handleDetectorCreated}
              onCancel={handleCloseCreator}
            />
          </div>
        </Card>
      )}
    </div>
  );
});
