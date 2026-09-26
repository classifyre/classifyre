"use client";

import * as React from "react";
import { Search } from "lucide-react";
import {
  api,
  SearchFindingsFiltersDtoDetectorTypeEnum,
  SearchFindingsFiltersDtoSeverityEnum,
  type SourceListItem,
} from "@workspace/api-client";
import { FINDING_SEVERITY_COLOR_BY_ENUM } from "@workspace/ui/lib/finding-severity";
import {
  Input,
  MultiSelect,
  MultiSelectContent,
  MultiSelectGroup,
  MultiSelectItem,
  MultiSelectTrigger,
  MultiSelectValue,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";

/** The "no source filter" value of the source select. */
export const ALL_SOURCES = "ALL";

const SEVERITY_OPTIONS = Object.values(SearchFindingsFiltersDtoSeverityEnum);
const DETECTOR_OPTIONS = Object.values(SearchFindingsFiltersDtoDetectorTypeEnum);

export interface SourceOption {
  id: string;
  name: string;
}

function formatEnumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

/** Sources for the filter, loaded once per mount and sorted by name. */
export function useSourceOptions(): SourceOption[] {
  const [sources, setSources] = React.useState<SourceOption[]>([]);
  React.useEffect(() => {
    let active = true;
    api.sources
      .sourcesControllerListSources()
      .then((list) => {
        if (!active) return;
        setSources(
          ((list ?? []) as unknown as SourceListItem[])
            .filter((s): s is SourceListItem & { id: string } => typeof s.id === "string" && s.id.length > 0)
            .map((s) => ({ id: s.id, name: s.name || s.id }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch(() => active && setSources([]));
    return () => {
      active = false;
    };
  }, []);
  return sources;
}

/**
 * The search box and finding filters shared by the assets table and the
 * case board's "add evidence" panel: text, source, severity, detector type.
 * Controlled; callers own the values and the querying. `compact` stacks the
 * controls full-width for narrow panels.
 */
export function AssetFilterBar({
  search,
  onSearchChange,
  searchPlaceholder,
  sources,
  sourceId,
  onSourceChange,
  severities,
  onSeveritiesChange,
  detectorTypes,
  onDetectorTypesChange,
  compact = false,
  afterSearch,
  children,
  autoFocus = false,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  /** Omit to hide the source select (a view already scoped to one source). */
  sources?: SourceOption[];
  sourceId: string;
  onSourceChange: (value: string) => void;
  severities: string[];
  onSeveritiesChange: (values: string[]) => void;
  detectorTypes: string[];
  onDetectorTypesChange: (values: string[]) => void;
  compact?: boolean;
  /** Controls right after the search box (the table's search-mode toggle). */
  afterSearch?: React.ReactNode;
  /** Controls after the shared filters (the table's status filter, export). */
  children?: React.ReactNode;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const control = compact ? "h-9 w-full" : undefined;
  return (
    <div className={cn("flex gap-2", compact ? "flex-col" : "flex-wrap items-center")}>
      <div className={cn("relative", compact ? "w-full" : "min-w-[240px] flex-[1.6]")}>
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder ?? t("assets.search")}
          className="h-9 pl-9 border-2 border-border rounded-[4px]"
          autoFocus={autoFocus}
        />
      </div>

      {afterSearch}

      <div className={cn("flex gap-2", compact ? "flex-col" : "contents")}>
        {sources && (
          <Select value={sourceId} onValueChange={onSourceChange}>
            <SelectTrigger className={cn("h-9 border-2 border-border rounded-[4px]", control ?? "w-[200px]")}>
              <SelectValue placeholder={t("assets.allSources")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SOURCES}>{t("assets.allSources")}</SelectItem>
              {sources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <MultiSelect values={severities} onValuesChange={onSeveritiesChange}>
          <MultiSelectTrigger className={cn("h-9 border-2 border-border rounded-[4px]", control ?? "w-[180px]")}>
            <MultiSelectValue placeholder={t("common.severity")} />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: t("assets.searchSeverity"),
              emptyMessage: t("assets.noSeveritiesFound"),
            }}
          >
            <MultiSelectGroup>
              {SEVERITY_OPTIONS.map((severity) => (
                <MultiSelectItem key={severity} value={severity}>
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-[2px] border border-border/20"
                      style={{ backgroundColor: FINDING_SEVERITY_COLOR_BY_ENUM[severity] }}
                    />
                    {formatEnumLabel(severity)}
                  </span>
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>

        <MultiSelect values={detectorTypes} onValuesChange={onDetectorTypesChange}>
          <MultiSelectTrigger className={cn("h-9 border-2 border-border rounded-[4px]", control ?? "w-[220px]")}>
            <MultiSelectValue placeholder={t("assets.detectorTypes")} />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: t("assets.searchDetectorTypes"),
              emptyMessage: t("assets.noDetectorTypesFound"),
            }}
          >
            <MultiSelectGroup>
              {DETECTOR_OPTIONS.map((detector) => (
                <MultiSelectItem key={detector} value={detector}>
                  {formatEnumLabel(detector)}
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>
      </div>

      {children}
    </div>
  );
}
