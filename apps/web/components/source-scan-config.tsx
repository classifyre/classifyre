"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import type { JSONSchema7 } from "json-schema";
import { FlaskConical, Search, SlidersHorizontal } from "lucide-react";
import { api, type CustomDetectorResponseDto } from "@workspace/api-client";
import { useTranslation } from "@/hooks/use-translation";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Form } from "@workspace/ui/components/form";
import { Input } from "@workspace/ui/components/input";
import { Toggle } from "@workspace/ui/components/toggle";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { cn } from "@workspace/ui/lib/utils";
import { JsonSchemaFields, buildFormDefaults } from "./json-schema-form";
import { AiAssistedCard } from "@/components/ai-assisted-card";
import {
  detectorUiGroups,
  getDetectorGroupId,
} from "@/lib/detector-ui-config";
import {
  getDetectorSchemas,
  type DetectorSchemaInfo,
} from "@/lib/detector-schema-loader";
import {
  getDetectorExamples,
  type DetectorExample,
} from "@/lib/detector-examples-loader";

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

function getPatternCount(schema: JSONSchema7): number | null {
  const patterns = schema.properties?.enabled_patterns as
    | JSONSchema7
    | undefined;
  if (!patterns) return null;
  const items = patterns.items as JSONSchema7 | undefined;
  if (!items || Array.isArray(items)) return null;
  if (Array.isArray(items.enum)) {
    return items.enum.length;
  }
  return null;
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

function DetectorAiConfigurator({
  detector: _detector,
  presetOptions: _presetOptions,
  currentConfig: _currentConfig,
  enabled: _enabled,
  onApplySuggestion: _onApplySuggestion,
}: {
  detector: DetectorSchemaInfo;
  presetOptions: DetectorPresetOption[];
  currentConfig: Record<string, unknown>;
  enabled: boolean;
  onApplySuggestion: (next: {
    enabled: boolean;
    config: Record<string, unknown>;
    presetId: string | null;
  }) => void;
}) {
  return null;
}

function DetectorConfigCard({
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
  const patternCount = getPatternCount(detector.schema);

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

  const [isAdvancedOpen, setIsAdvancedOpen] = useState(
    () => enabled && !matchingPresetId,
  );

  useEffect(() => {
    if (!enabled) {
      setSelectedPreset(null);
      setIsAdvancedOpen(false);
      return;
    }
    if (matchingPresetId) {
      setSelectedPreset(matchingPresetId);
      setIsAdvancedOpen(false);
    } else {
      setSelectedPreset("custom");
      setIsAdvancedOpen(true);
    }
  }, [enabled, matchingPresetId]);

  const handlePresetSelect = (presetId: string) => {
    const preset = presetOptions.find((option) => option.id === presetId);
    if (!preset) {
      return;
    }
    const nextConfig = preset.normalizedConfig;
    setSelectedPreset(presetId);
    form.reset(nextConfig);
    setIsAdvancedOpen(false);
    onStateChange({ enabled: true, config: nextConfig });
  };

  const handleEnableCustom = () => {
    if (!enabled) {
      onStateChange({ enabled: true });
    }
    setSelectedPreset("custom");
    setIsAdvancedOpen(true);
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
    <AiAssistedCard
      title={displayName}
      description={detector.type.replace(/_/g, " ")}
      active={enabled}
      withShadow={false}
      headerActions={
        <div className="flex items-center gap-2">
          <DetectorAiConfigurator
            detector={detector}
            presetOptions={presetOptions}
            currentConfig={normalizedCurrentConfig}
            enabled={enabled}
            onApplySuggestion={(next) => {
              form.reset(next.config);
              setSelectedPreset(next.presetId ?? "custom");
              setIsAdvancedOpen(next.presetId ? false : true);
              onStateChange({ enabled: next.enabled, config: next.config });
            }}
          />
          <Toggle
            variant="outline"
            size="sm"
            pressed={enabled}
            onPressedChange={(pressed) => onStateChange({ enabled: pressed })}
            className="cursor-pointer"
            data-testid={`detector-toggle-${detector.type}`}
          >
            {enabled ? t("sources.scanConfig.on") : t("sources.scanConfig.off")}
          </Toggle>
        </div>
      }
    >
      <div className="space-y-4">
        {detector.description && (
          <p className="text-sm text-muted-foreground">
            {detector.description}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {detector.categories.map((category) => (
            <Badge
              key={`${detector.type}-${category}`}
              variant="outline"
              className="border-2 border-border"
            >
              {category}
            </Badge>
          ))}
          {detector.priority && (
            <Badge variant="outline" className="border-2 border-border">
              {detector.priority}
            </Badge>
          )}
          {detector.lifecycleStatus && (
            <Badge variant="outline" className="border-2 border-border">
              {detector.lifecycleStatus}
            </Badge>
          )}
          {patternCount !== null && (
            <Badge variant="outline" className="border-2 border-border">
              {t("sources.scanConfig.patterns", { count: patternCount })}
            </Badge>
          )}
          {enabled && (
            <Badge variant="outline" className="border-2 border-border">
              {selectedPresetLabel
                ? t("sources.scanConfig.presetLabel", {
                    label: selectedPresetLabel,
                  })
                : t("sources.scanConfig.customPreset")}
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-[4px] border-2 border-black"
              onClick={handleEnableCustom}
            >
              {t("sources.scanConfig.customize")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-[4px] border-2 border-black"
              onClick={handleResetDefaults}
            >
              {t("sources.scanConfig.reset")}
            </Button>
          </div>
        </div>

        {presetOptions.length > 0 && (
          <div className="space-y-2 rounded-[6px] border-2 border-border bg-muted/30 p-3">
            <div>
              <p className="text-[11px] font-mono uppercase tracking-[0.16em]">
                {t("sources.scanConfig.presets")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("sources.scanConfig.presetsDesc")}
              </p>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {presetOptions.map((preset) => {
                const isSelected = selectedPreset === preset.id;
                return (
                  <Button
                    key={preset.id}
                    type="button"
                    variant="outline"
                    className={cn(
                      "h-auto w-full items-start justify-start whitespace-normal rounded-[4px] border-2 border-border px-3 py-2 text-left",
                      isSelected && "border-black bg-accent/30",
                    )}
                    onClick={() => handlePresetSelect(preset.id)}
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-semibold">{preset.name}</p>
                      {preset.description && (
                        <p className="text-xs text-muted-foreground">
                          {preset.description}
                        </p>
                      )}
                    </div>
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        <Collapsible
          open={isAdvancedOpen}
          onOpenChange={(open) => {
            if (open) {
              handleEnableCustom();
              return;
            }
            setIsAdvancedOpen(false);
          }}
        >
          <div className="flex items-center justify-between gap-2 rounded-[6px] border-2 border-border p-3">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              <div>
                <p className="text-sm font-semibold">
                  {t("sources.scanConfig.advancedSettings")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("sources.scanConfig.advancedSettingsDesc")}
                </p>
              </div>
            </div>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-[4px] border-2 border-black"
              >
                {isAdvancedOpen
                  ? t("sources.scanConfig.hide")
                  : t("sources.scanConfig.show")}
              </Button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent className="pt-3">
            <div className="rounded-[6px] border-2 border-border p-3">
              <Form {...form}>
                <div className="space-y-4">
                  <JsonSchemaFields
                    schema={detector.schema}
                    control={form.control}
                  />
                </div>
              </Form>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </AiAssistedCard>
  );
}

function formatCustomDetectorMethod(method: string): string {
  return method
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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

function CustomDetectorCatalogCard({
  detector,
  enabled,
  onToggle,
}: {
  detector: CustomDetectorResponseDto;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <AiAssistedCard
      title={detector.name}
      description={detector.key}
      active={enabled}
      withShadow={false}
      headerActions={
        <Toggle
          variant="outline"
          size="sm"
          pressed={enabled}
          onPressedChange={onToggle}
          className="cursor-pointer"
        >
          {enabled ? t("sources.scanConfig.on") : t("sources.scanConfig.off")}
        </Toggle>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {detector.description?.trim() || t("sources.scanConfig.fallbackDesc")}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-2 border-border">
            {formatCustomDetectorMethod(detector.method)}
          </Badge>
          <Badge variant="outline" className="border-2 border-border">
            {detector.isActive
              ? t("sources.scanConfig.catalogActive")
              : t("sources.scanConfig.catalogInactive")}
          </Badge>
          <Badge variant="outline" className="border-2 border-border">
            {t("sources.scanConfig.findingsCount", {
              count: detector.findingsCount,
            })}
          </Badge>
        </div>

        <div className="grid gap-3 rounded-[6px] border-2 border-border bg-muted/30 p-3 sm:grid-cols-3">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
              {t("sources.scanConfig.usedBy")}
            </p>
            <p className="text-sm font-semibold">
              {t("sources.scanConfig.sourcesCount", {
                count: detector.sourcesUsingCount,
              })}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
              {t("sources.scanConfig.withFindings")}
            </p>
            <p className="text-sm font-semibold">
              {t("sources.scanConfig.sourcesCount", {
                count: detector.sourcesWithFindingsCount,
              })}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
              {t("sources.scanConfig.version")}
            </p>
            <p className="text-sm font-semibold">v{detector.version}</p>
          </div>
        </div>

        {detector.recentSourceNames.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("sources.scanConfig.recentSources", {
              names: detector.recentSourceNames.slice(0, 3).join(", "),
            })}
          </p>
        ) : null}
      </div>
    </AiAssistedCard>
  );
}

function CatalogSection({
  title,
  description,
  countLabel,
  action,
  children,
}: {
  title: string;
  description: string;
  countLabel: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="bg-background p-0">
      <section>
        <div className="flex flex-col gap-2 border-b-2 border-border bg-foreground px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-xs font-mono font-bold uppercase tracking-[0.12em] text-primary-foreground">
              {title}
            </h3>
            <p className="text-[10px] font-mono text-primary-foreground/60">
              {description}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {action}
            <Badge className="w-fit rounded-[4px] border-2 border-black bg-[#b7ff00] text-[10px] uppercase tracking-[0.16em] text-black shadow-[3px_3px_0_#000]">
              {countLabel}
            </Badge>
          </div>
        </div>
        <CardContent className="p-4">{children}</CardContent>
      </section>
    </Card>
  );
}

export function SourceScanConfig({
  defaultDetectors,
  onDetectorsChange,
  onSummaryChange,
  selectedCustomDetectorIds = [],
  onCustomDetectorsChange,
  mode = "create",
}: SourceScanConfigProps) {
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
  const [displayOrder, setDisplayOrder] = useState<string[]>([]);

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

  useEffect(() => {
    let cancelled = false;

    async function loadCustomDetectors() {
      try {
        setCustomDetectorsLoading(true);
        setCustomDetectorsError(null);
        const payload = await api.listCustomDetectors({
          includeInactive: true,
        });
        if (!cancelled) {
          setCustomDetectors(payload ?? []);
        }
      } catch (error) {
        if (!cancelled) {
          setCustomDetectors([]);
          setCustomDetectorsError(
            error instanceof Error
              ? error.message
              : "Failed to load custom detectors.",
          );
        }
      } finally {
        if (!cancelled) {
          setCustomDetectorsLoading(false);
        }
      }
    }

    void loadCustomDetectors();

    return () => {
      cancelled = true;
    };
  }, []);

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

  const groupSummary = useMemo(() => {
    return detectorUiGroups
      .map((group) => {
        const groupDetectors = orderedDetectors.filter(
          (detector) =>
            getDetectorGroupId(detector.type, detector.categories) === group.id,
        );
        const visibleDetectors = groupDetectors.filter((detector) =>
          matchesSearch(
            detector,
            presetMap.get(detector.type) ?? [],
            searchTerm,
          ),
        );
        const enabledCount = groupDetectors.filter(
          (detector) => detectorState[detector.id]?.enabled,
        ).length;

        return {
          ...group,
          totalCount: groupDetectors.length,
          enabledCount,
          visibleDetectors,
        };
      })
      .filter((group) => group.totalCount > 0);
  }, [orderedDetectors, presetMap, searchTerm, detectorState]);

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
      selectableCustomDetectors.filter((detector) =>
        matchesCustomDetectorSearch(detector, searchTerm),
      ),
    [searchTerm, selectableCustomDetectors],
  );
  const visibleGroupSummary = useMemo(
    () => groupSummary.filter((group) => group.visibleDetectors.length > 0),
    [groupSummary],
  );
  const hasCustomDetectorCatalog = customDetectors.length > 0;
  const hasSelectableCustomDetectors = selectableCustomDetectors.length > 0;

  const enabledCount =
    Object.values(detectorState).filter((detector) => detector.enabled).length +
    selectedCustomDetectorIds.length;
  const visibleBuiltInCount = groupSummary.reduce(
    (total, group) => total + group.visibleDetectors.length,
    0,
  );
  const visibleCustomCount = visibleCustomDetectors.length;
  const visibleCount = visibleBuiltInCount + visibleCustomCount;
  useEffect(() => {
    onSummaryChange?.({ visibleCount, enabledCount });
  }, [enabledCount, onSummaryChange, visibleCount]);

  const hasAnyVisibleResults =
    visibleGroupSummary.length > 0 || visibleCustomDetectors.length > 0;

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
            <Badge className="rounded-[4px] border border-black bg-[#b7ff00] text-black">
              {t("sources.edit.enabled", { count: enabledCount })}
            </Badge>
          </div>
        </div>

        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t("sources.scanConfig.searchPlaceholder")}
            className="h-10 rounded-[4px] border-2 border-black bg-background pl-9 text-sm shadow-[3px_3px_0_#000] focus-visible:ring-0"
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
      </Card>

      {!hasAnyVisibleResults && searchTerm ? (
        <Card className="border-dashed border-black bg-muted/30 px-6 py-8 text-center shadow-[4px_4px_0_#000]">
          <p className="text-sm font-semibold uppercase tracking-[0.08em]">
            {t("sources.scanConfig.noResults")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("sources.scanConfig.noDetectorsHint")}
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {visibleGroupSummary.length > 0 ? (
            visibleGroupSummary.map((group) => (
              <CatalogSection
                key={group.id}
                title={group.label}
                description={group.description}
                countLabel={t("sources.edit.visible", {
                  count: group.visibleDetectors.length,
                })}
              >
                <div className="grid gap-4 md:grid-cols-2">
                  {group.visibleDetectors.map((detector) => {
                    const state = detectorState[detector.id];
                    const config = state?.config ?? {};
                    const enabled = state?.enabled ?? false;

                    return (
                      <DetectorConfigCard
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
                </div>
              </CatalogSection>
            ))
          ) : !searchTerm && groupSummary.length === 0 ? (
            <Card className="border-dashed border-black bg-muted/30 px-6 py-8 text-center shadow-[4px_4px_0_#000]">
              <p className="text-sm font-semibold uppercase tracking-[0.08em]">
                {t("sources.scanConfig.noSchemas")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("sources.scanConfig.noSchemasHint")}
              </p>
            </Card>
          ) : null}

          {(!searchTerm || visibleCustomDetectors.length > 0 || customDetectorsLoading || customDetectorsError) && (
          <CatalogSection
            title={t("sources.scanConfig.customDetectors")}
            description={t("sources.scanConfig.customDetectorsDesc")}
            countLabel={t("sources.edit.enabled", {
              count: selectedCustomDetectorIds.length,
            })}
            action={
              <Button type="button" variant="outline" size="sm" asChild>
                <Link
                  href={
                    hasCustomDetectorCatalog ? "/detectors" : "/detectors/new"
                  }
                >
                  <FlaskConical className="mr-1 h-3.5 w-3.5" />
                  {hasCustomDetectorCatalog
                    ? t("sources.scanConfig.manage")
                    : t("detectors.newDetector")}
                </Link>
              </Button>
            }
          >
            {customDetectorsError ? (
              <div className="rounded-[6px] border-2 border-dashed border-border p-6 text-center">
                <p className="text-sm font-medium">
                  {t("sources.scanConfig.loadError")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {customDetectorsError}
                </p>
              </div>
            ) : customDetectorsLoading ? (
              <div className="rounded-[6px] border-2 border-dashed border-border p-6 text-center">
                <p className="text-sm font-medium">
                  {t("sources.scanConfig.loading")}
                </p>
              </div>
            ) : !hasCustomDetectorCatalog ? (
              <div className="rounded-[6px] border-2 border-dashed border-border p-6 text-center">
                <p className="text-sm font-medium">
                  {t("sources.scanConfig.customDetectors")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("sources.scanConfig.noCustomHint")}
                </p>
              </div>
            ) : !hasSelectableCustomDetectors ? (
              <div className="rounded-[6px] border-2 border-dashed border-border p-6 text-center">
                <p className="text-sm font-medium">
                  {t("sources.scanConfig.customDetectors")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("sources.scanConfig.noSelectableCustomHint")}
                </p>
              </div>
            ) : visibleCustomDetectors.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2">
                {visibleCustomDetectors.map((detector) => (
                  <CustomDetectorCatalogCard
                    key={detector.id}
                    detector={detector}
                    enabled={selectedCustomDetectorSet.has(detector.id)}
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
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-[6px] border-2 border-dashed border-border p-6 text-center">
                <p className="text-sm font-medium">
                  {t("sources.scanConfig.noCustom")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("sources.scanConfig.noCustomHint")}
                </p>
              </div>
            )}
          </CatalogSection>
          )}
        </div>
      )}
    </div>
  );
}
