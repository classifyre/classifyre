"use client";

import { nsPath } from "@/lib/ns-path";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Database, Fingerprint, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type InquiryResponseDto,
  type MatchOptionsResponseDto,
  type PreviewResponseDto,
} from "@workspace/api-client";
import { AiAssistedCard } from "@/components/ai-assisted-card";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import { Label } from "@workspace/ui/components/label";
import { SeverityBadge } from "@workspace/ui/components/severity-badge";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@workspace/ui/components/accordion";
import {
  MultiSelect,
  MultiSelectContent,
  MultiSelectGroup,
  MultiSelectItem,
  MultiSelectTrigger,
  MultiSelectValue,
} from "@workspace/ui/components/multi-select";
import { StickyActionToolbar } from "@/components/sticky-action-toolbar";
import {
  HorizontalStepperNav,
  VerticalStepperNav,
  type StepperNavItem,
} from "@/components/stepper-nav";
import { useTranslation } from "@/hooks/use-translation";
import {
  ALL_SOURCES_VALUE,
  customDetectorValue,
  detectorOptionCount,
  matchersFromDetectorValues,
  matchersFromSourceValues,
  normaliseSourceValues,
  pruneFindingTypes,
  visibleFindingTypes,
} from "@/lib/inquiry-matcher-form";

/** Built-in detector types offered in the merged detector picker. CUSTOM is
 * deliberately absent: it is the supertype of every custom detector, so
 * offering it would silently widen a question meant for one detector to all
 * of them. Custom detectors appear as their own entries instead. */
const BUILT_IN_DETECTORS = [
  "SECRETS",
  "PII",
  "YARA",
  "BROKEN_LINKS",
  "CODE_SECURITY",
] as const;
const parseList = (s: string) =>
  s
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);
const joinList = (items: string[]) => items.join(", ");

const STEP_IDS = ["define", "filters", "preview"] as const;
type StepId = (typeof STEP_IDS)[number];

export type InquiryFormProps = {
  mode: "create" | "edit";
  inquiryId?: string;
  initial?: InquiryResponseDto;
};

export interface InquiryFormHandle {
  getValues: () => {
    title: string;
    description: string;
    matchers: {
      matchAllSources: boolean;
      sourceIds: string[];
      detectorTypes: string[];
      customDetectorKeys: string[];
      findingTypes: string[];
      findingTypeRegex: string[];
      findingValueRegex: string[];
    };
  };
  applyPatches: (patches: Array<{ path: string; value: unknown }>) => void;
}

export const InquiryForm = React.forwardRef<
  InquiryFormHandle,
  InquiryFormProps
>(function InquiryForm({ mode, inquiryId, initial }, ref) {
  const router = useRouter();
  const { t } = useTranslation();
  const isEdit = mode === "edit";

  const [title, setTitle] = React.useState(initial?.title ?? "");
  const [description, setDescription] = React.useState(
    initial?.description ?? "",
  );
  const [matchAllSources, setMatchAllSources] = React.useState(
    initial?.matchAllSources ?? true,
  );
  const [selectedSources, setSelectedSources] = React.useState<Set<string>>(
    () => new Set(initial?.sourceIds ?? []),
  );
  const [selectedDetectors, setSelectedDetectors] = React.useState<Set<string>>(
    // The raw CUSTOM supertype is never a selectable option (see
    // BUILT_IN_DETECTORS); a legacy bare CUSTOM expands to concrete keys once
    // match-options arrive (detectorExpandRef effect below).
    () => new Set((initial?.detectorTypes ?? []).filter((d) => d !== "CUSTOM")),
  );
  const [selectedCustomKeys, setSelectedCustomKeys] = React.useState<
    Set<string>
  >(() => new Set(initial?.customDetectorKeys ?? []));
  // The full stored list, including types match-options cannot see (a detector
  // removed since, or types outside the current source scope). Pruning only
  // ever drops types that are known AND uncovered, so edits never lose those.
  const [selectedTypes, setSelectedTypes] = React.useState<Set<string>>(
    () => new Set(initial?.findingTypes ?? []),
  );
  const [regexText, setRegexText] = React.useState(
    joinList(initial?.findingTypeRegex ?? []),
  );
  const [valueRegexText, setValueRegexText] = React.useState(
    joinList(initial?.findingValueRegex ?? []),
  );

  const [options, setOptions] = React.useState<MatchOptionsResponseDto | null>(
    null,
  );
  const [preview, setPreview] = React.useState<PreviewResponseDto | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [activeStep, setActiveStep] = React.useState<StepId>("define");
  const detectorExpandRef = React.useRef(false);
  const detectorsTouchedRef = React.useRef(false);

  const sectionRefs = {
    define: React.useRef<HTMLElement>(null),
    filters: React.useRef<HTMLElement>(null),
    preview: React.useRef<HTMLElement>(null),
  };

  const steps: StepperNavItem<StepId>[] = [
    {
      id: "define",
      title: t("investigations.inquiryForm.stepDefine"),
      description: t("investigations.inquiryForm.stepDefineDesc"),
    },
    {
      id: "filters",
      title: t("investigations.inquiryForm.stepFilters"),
      description: t("investigations.inquiryForm.stepFiltersDesc"),
    },
    {
      id: "preview",
      title: t("investigations.inquiryForm.stepPreview"),
      description: t("investigations.inquiryForm.stepPreviewDesc"),
    },
  ];

  const loadOptions = React.useCallback(async (sourceIds?: string[]) => {
    try {
      setOptions(
        await api.inquiries.inquiriesControllerMatchOptions({ sourceIds }),
      );
    } catch (err) {
      console.error(err);
    }
  }, []);

  React.useEffect(() => {
    void loadOptions();
  }, [loadOptions]);
  React.useEffect(() => {
    if (matchAllSources) void loadOptions();
    else if (selectedSources.size > 0)
      void loadOptions(Array.from(selectedSources));
  }, [matchAllSources, selectedSources, loadOptions]);

  // Legacy bare-CUSTOM expansion: `detectorTypes: ["CUSTOM"]` with no keys
  // meant "any custom detector". Expand once to the concrete keys so the
  // merged picker shows what that actually matches. Skipped when the operator
  // already touched the detector selection.
  React.useEffect(() => {
    if (!isEdit || !initial || !options || detectorExpandRef.current) return;
    detectorExpandRef.current = true;
    if (
      initial.detectorTypes.includes("CUSTOM" as never) &&
      initial.customDetectorKeys.length === 0 &&
      !detectorsTouchedRef.current
    ) {
      setSelectedCustomKeys(
        new Set(options.customDetectors.map((c) => c.key)),
      );
    }
  }, [isEdit, initial, options]);

  // Keep the finding-type selection consistent with the detector selection: a
  // type whose detector is no longer selected is deselected. Pruning only
  // drops types match-options knows and shows as uncovered; anything else
  // (removed detectors, other source scopes) survives. Idempotent, so repeat
  // runs are a no-op guarded by the equality check.
  React.useEffect(() => {
    if (!options) return;
    setSelectedTypes((prev) => {
      const next = pruneFindingTypes(
        [...prev],
        options.findingTypes,
        [...selectedDetectors],
        [...selectedCustomKeys],
        options.customDetectors,
      );
      return next.length === prev.size && next.every((v) => prev.has(v))
        ? prev
        : new Set(next);
    });
  }, [options, selectedDetectors, selectedCustomKeys]);

  const matchers = React.useMemo(
    () => ({
      matchAllSources,
      sourceIds: matchAllSources ? [] : Array.from(selectedSources),
      detectorTypes: Array.from(selectedDetectors) as never,
      customDetectorKeys: Array.from(selectedCustomKeys),
      findingTypes: [...selectedTypes],
      findingTypeRegex: parseList(regexText),
      findingValueRegex: parseList(valueRegexText),
    }),
    [
      matchAllSources,
      selectedSources,
      selectedDetectors,
      selectedCustomKeys,
      selectedTypes,
      regexText,
      valueRegexText,
    ],
  );

  React.useImperativeHandle(
    ref,
    () => ({
      getValues: () => ({ title, description, matchers }),
      applyPatches: (patches) => {
        for (const patch of patches) {
          if (patch.path === "title") {
            setTitle(String(patch.value ?? ""));
          } else if (patch.path === "description") {
            setDescription(String(patch.value ?? ""));
          } else if (patch.path === "matchers.matchAllSources") {
            setMatchAllSources(Boolean(patch.value));
          } else if (patch.path === "matchers.sourceIds") {
            setSelectedSources(
              new Set(
                Array.isArray(patch.value) ? patch.value.map(String) : [],
              ),
            );
          } else if (patch.path === "matchers.detectorTypes") {
            // The picker never offers CUSTOM; strip it so an assistant patch
            // cannot sneak the supertype back in (bare CUSTOM expands to
            // concrete keys only through the edit-load path above).
            detectorsTouchedRef.current = true;
            setSelectedDetectors(
              new Set(
                Array.isArray(patch.value)
                  ? patch.value.map(String).filter((d) => d !== "CUSTOM")
                  : [],
              ),
            );
          } else if (patch.path === "matchers.customDetectorKeys") {
            detectorsTouchedRef.current = true;
            setSelectedCustomKeys(
              new Set(
                Array.isArray(patch.value) ? patch.value.map(String) : [],
              ),
            );
          } else if (patch.path === "matchers.findingTypes") {
            setSelectedTypes(
              new Set(
                Array.isArray(patch.value) ? patch.value.map(String) : [],
              ),
            );
          } else if (patch.path === "matchers.findingTypeRegex") {
            setRegexText(
              joinList(
                Array.isArray(patch.value) ? patch.value.map(String) : [],
              ),
            );
          } else if (patch.path === "matchers.findingValueRegex") {
            setValueRegexText(
              joinList(
                Array.isArray(patch.value) ? patch.value.map(String) : [],
              ),
            );
          }
        }
      },
    }),
    [title, description, matchers],
  );

  // ─── Multi-select derivations ──────────────────────────────────────────
  const loadingOptions = options === null;

  const sourceValues = matchAllSources
    ? [ALL_SOURCES_VALUE]
    : [...selectedSources];
  const handleSourceValuesChange = (values: string[]) => {
    const next = normaliseSourceValues(values, sourceValues);
    const asMatchers = matchersFromSourceValues(next);
    setMatchAllSources(asMatchers.matchAllSources);
    setSelectedSources(new Set(asMatchers.sourceIds));
  };

  const detectorValues = React.useMemo(
    () => [
      ...selectedDetectors,
      ...[...selectedCustomKeys].map(customDetectorValue),
    ],
    [selectedDetectors, selectedCustomKeys],
  );
  const handleDetectorValuesChange = (values: string[]) => {
    detectorsTouchedRef.current = true;
    const asMatchers = matchersFromDetectorValues(values);
    setSelectedDetectors(new Set(asMatchers.detectorTypes));
    setSelectedCustomKeys(new Set(asMatchers.customDetectorKeys));
  };

  // Finding-type rows for the current detector selection, deduped by value
  // (one type string can be emitted by several detectors) with counts summed.
  // Selected-but-invisible values (removed detectors, other source scopes) get
  // fallback entries below so they stay visible and removable.
  const availableTypeRows = React.useMemo(() => {
    const rows = visibleFindingTypes(
      options?.findingTypes ?? [],
      [...selectedDetectors],
      [...selectedCustomKeys],
      "",
      options?.customDetectors ?? [],
    );
    const byValue = new Map<string, { value: string; count: number }>();
    for (const row of rows) {
      const existing = byValue.get(row.value);
      byValue.set(
        row.value,
        existing
          ? { value: row.value, count: existing.count + row.count }
          : { value: row.value, count: row.count },
      );
    }
    return [...byValue.values()].sort(
      (a, b) => b.count - a.count || a.value.localeCompare(b.value),
    );
  }, [options, selectedDetectors, selectedCustomKeys]);
  const knownTypeValues = React.useMemo(
    () => new Set((options?.findingTypes ?? []).map((t) => t.value)),
    [options],
  );
  // Selected types match-options has never heard of (a detector removed
  // since, or types from another source scope): kept by pruning, so they need
  // fallback entries to stay visible and removable.
  const orphanTypeValues = [...selectedTypes].filter(
    (v) => !knownTypeValues.has(v),
  );
  const knownCustomKeys = React.useMemo(
    () => new Set((options?.customDetectors ?? []).map((c) => c.key)),
    [options],
  );
  const orphanCustomKeys = [...selectedCustomKeys].filter(
    (k) => !knownCustomKeys.has(k),
  );
  // Sources selected before they were deleted: kept in state so saving does
  // not silently narrow the question, with fallback entries to remove them.
  const orphanSourceIds = matchAllSources
    ? []
    : [...selectedSources].filter(
        (id) => !(options?.sources ?? []).some((s) => s.id === id),
      );

  const matchersKey = JSON.stringify(matchers);
  React.useEffect(() => {
    if (!matchAllSources && selectedSources.size === 0) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.inquiries.inquiriesControllerPreview({
          previewInquiryDto: matchers,
        });
        if (!cancelled) setPreview(res);
      } catch (err) {
        if (!cancelled) console.error(err);
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchersKey]);

  React.useEffect(() => {
    const els = STEP_IDS.map((id) => ({
      id,
      el: sectionRefs[id].current,
    })).filter((x): x is { id: StepId; el: HTMLElement } => !!x.el);
    const map = new Map<Element, StepId>(els.map(({ id, el }) => [el, id]));
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            const id = map.get(e.target);
            if (id) setActiveStep(id);
          }
      },
      { rootMargin: "0px 0px -65% 0px", threshold: 0 },
    );
    els.forEach(({ el }) => obs.observe(el));
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  const scrollTo = (id: StepId) =>
    sectionRefs[id].current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

  const save = async () => {
    if (!title.trim()) {
      toast.error(t("investigations.inquiryForm.titleRequired"));
      scrollTo("define");
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        if (!inquiryId) throw new Error("Missing inquiry id");
        await api.inquiries.inquiriesControllerUpdate({
          id: inquiryId,
          updateInquiryDto: {
            title: title.trim(),
            description: description.trim() || undefined,
            ...matchers,
          },
        });
        toast.success(t("investigations.inquiryForm.updated"));
        router.push(nsPath(`/investigations/inquiries/${inquiryId}`));
      } else {
        const created = await api.inquiries.inquiriesControllerCreate({
          createInquiryDto: {
            title: title.trim(),
            description: description.trim() || undefined,
            ...matchers,
          },
        });
        toast.success(t("investigations.inquiryForm.created"));
        router.push(nsPath(`/investigations/inquiries/${created.id}`));
      }
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof Error
          ? err.message
          : isEdit
            ? t("investigations.inquiryForm.updateFailed")
            : t("investigations.inquiryForm.createFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const back = () => {
    if (isEdit && inquiryId)
      router.push(nsPath(`/investigations/inquiries/${inquiryId}`));
    else router.push(nsPath("/investigations"));
  };

  const noSourcesChosen = !matchAllSources && selectedSources.size === 0;

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <div>
        <Button
          variant="outline"
          onClick={back}
          className="mb-4 rounded-[4px] border-2 border-border"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {isEdit
            ? t("investigations.inquiryForm.backToInquiry")
            : t("investigations.inquiryForm.backToInvestigations")}
        </Button>
        <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
          {isEdit
            ? t("investigations.inquiryForm.editTitle")
            : t("investigations.inquiryForm.createTitle")}
        </h1>
        <p className="text-muted-foreground mt-2 max-w-2xl">
          {isEdit
            ? t("investigations.inquiryForm.editDescription")
            : t("investigations.inquiryForm.createDescription")}
        </p>
      </div>

      {/* Mobile sticky horizontal nav */}
      <div className="sticky top-0 z-20 -mx-4 mb-6 border-b-2 border-border bg-background/95 px-4 py-2 backdrop-blur-sm md:hidden">
        <HorizontalStepperNav
          steps={steps}
          activeStepId={activeStep}
          onNavigate={scrollTo}
          label={t("investigations.inquiryForm.navLabel")}
        />
      </div>

      {/* Desktop: content + right sticky sidebar */}
      <div className="flex gap-8 lg:gap-12">
        <div className="min-w-0 flex-1 space-y-16 pb-32">
          <section ref={sectionRefs.define}>
            <AiAssistedCard
              title={t("investigations.inquiryForm.defineCardTitle")}
              description={t("investigations.inquiryForm.defineCardDesc")}
              active={activeStep === "define"}
            >
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="q-title">
                    {t("investigations.inquiryForm.titleLabel")}{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="q-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t(
                      "investigations.inquiryForm.titlePlaceholder",
                    )}
                    autoFocus
                    className="text-base"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="q-desc">
                    {t("investigations.inquiryForm.descriptionLabel")}
                  </Label>
                  <Textarea
                    id="q-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    placeholder={t(
                      "investigations.inquiryForm.descriptionPlaceholder",
                    )}
                  />
                </div>
              </div>
            </AiAssistedCard>
          </section>

          <section ref={sectionRefs.filters}>
            <AiAssistedCard
              title={t("investigations.inquiryForm.filtersCardTitle")}
              description={t("investigations.inquiryForm.filtersCardDesc")}
              active={activeStep === "filters"}
            >
              <div className="space-y-6">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Database className="h-3.5 w-3.5" />{" "}
                    {t("investigations.inquiryForm.sourcesLabel")}
                  </Label>
                  <MultiSelect
                    values={sourceValues}
                    onValuesChange={handleSourceValuesChange}
                  >
                    <MultiSelectTrigger
                      className="w-full rounded-[4px] border-2 border-border"
                      disabled={loadingOptions}
                    >
                      {loadingOptions ? (
                        <span className="text-muted-foreground flex items-center gap-2 font-normal">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {t("investigations.inquiryForm.optionsLoading")}
                        </span>
                      ) : (
                        <MultiSelectValue
                          placeholder={t(
                            "investigations.inquiryForm.sourcesMultiselectPlaceholder",
                          )}
                          overflowBehavior="wrap-when-open"
                        />
                      )}
                    </MultiSelectTrigger>
                    <MultiSelectContent
                      search={{
                        placeholder: t(
                          "investigations.inquiryForm.sourcesSearchPlaceholder",
                        ),
                        emptyMessage: t(
                          "investigations.inquiryForm.searchEmpty",
                        ),
                      }}
                    >
                      <MultiSelectGroup>
                        <MultiSelectItem
                          value={ALL_SOURCES_VALUE}
                          badgeLabel={t(
                            "investigations.inquiryForm.allSources",
                          )}
                        >
                          {t("investigations.inquiryForm.allSources")}
                        </MultiSelectItem>
                        {(options?.sources ?? []).map((s) => (
                          <MultiSelectItem
                            key={s.id}
                            value={s.id}
                            badgeLabel={s.name}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-medium">
                                {s.name}
                              </span>
                              <span className="text-muted-foreground shrink-0 text-xs">
                                {s.type} ·{" "}
                                {t(
                                  "investigations.inquiryForm.sourcesCounts",
                                  {
                                    assets: s.assetCount,
                                    findings: s.openFindingCount,
                                  },
                                )}
                              </span>
                            </span>
                          </MultiSelectItem>
                        ))}
                        {orphanSourceIds.map((id) => (
                          <MultiSelectItem
                            key={id}
                            value={id}
                            badgeLabel={id}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-mono text-xs">
                                {id}
                              </span>
                              <span className="text-muted-foreground shrink-0 text-xs">
                                {t("investigations.inquiryForm.unobservedType")}
                              </span>
                            </span>
                          </MultiSelectItem>
                        ))}
                      </MultiSelectGroup>
                    </MultiSelectContent>
                  </MultiSelect>
                </div>

                <div className="space-y-2">
                  <Label>
                    {t("investigations.inquiryForm.detectorTypesLabel")}{" "}
                    <span className="text-muted-foreground font-normal">
                      {t("investigations.inquiryForm.emptyMeansAny")}
                    </span>
                  </Label>
                  <MultiSelect
                    values={detectorValues}
                    onValuesChange={handleDetectorValuesChange}
                  >
                    <MultiSelectTrigger
                      className="w-full rounded-[4px] border-2 border-border"
                      disabled={loadingOptions}
                    >
                      {loadingOptions ? (
                        <span className="text-muted-foreground flex items-center gap-2 font-normal">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {t("investigations.inquiryForm.optionsLoading")}
                        </span>
                      ) : (
                        <MultiSelectValue
                          placeholder={t(
                            "investigations.inquiryForm.detectorsPlaceholder",
                          )}
                          overflowBehavior="wrap-when-open"
                        />
                      )}
                    </MultiSelectTrigger>
                    <MultiSelectContent
                      search={{
                        placeholder: t(
                          "investigations.inquiryForm.detectorsSearchPlaceholder",
                        ),
                        emptyMessage: t(
                          "investigations.inquiryForm.searchEmpty",
                        ),
                      }}
                    >
                      <MultiSelectGroup
                        heading={t(
                          "investigations.inquiryForm.detectorsGroupBuiltIn",
                        )}
                      >
                        {BUILT_IN_DETECTORS.map((d) => (
                          <MultiSelectItem key={d} value={d} badgeLabel={d}>
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-medium">{d}</span>
                              <span className="text-muted-foreground shrink-0 text-xs">
                                ·{" "}
                                {detectorOptionCount(
                                  d,
                                  options?.findingTypes ?? [],
                                  options?.customDetectors ?? [],
                                )}
                              </span>
                            </span>
                          </MultiSelectItem>
                        ))}
                      </MultiSelectGroup>
                      <MultiSelectGroup
                        heading={t(
                          "investigations.inquiryForm.detectorsGroupCustom",
                        )}
                      >
                        {(options?.customDetectors ?? []).map((c) => (
                          <MultiSelectItem
                            key={c.key}
                            value={customDetectorValue(c.key)}
                            badgeLabel={c.name}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-medium">
                                {c.name}
                              </span>
                              <span className="text-muted-foreground shrink-0 text-xs">
                                · {c.openFindings}
                              </span>
                            </span>
                          </MultiSelectItem>
                        ))}
                        {orphanCustomKeys.map((key) => (
                          <MultiSelectItem
                            key={key}
                            value={customDetectorValue(key)}
                            badgeLabel={key}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-mono text-xs">
                                {key}
                              </span>
                              <span className="text-muted-foreground shrink-0 text-xs">
                                {t("investigations.inquiryForm.unobservedType")}
                              </span>
                            </span>
                          </MultiSelectItem>
                        ))}
                      </MultiSelectGroup>
                    </MultiSelectContent>
                  </MultiSelect>
                </div>

                <div className="space-y-2">
                  <Label>
                    {t("investigations.inquiryForm.findingTypesLabel")}{" "}
                    <span className="text-muted-foreground font-normal">
                      {t("investigations.inquiryForm.emptyMeansAny")}
                    </span>
                  </Label>
                  {detectorValues.length > 0 && (
                    <p className="text-muted-foreground text-[11px]">
                      {t("investigations.inquiryForm.findingTypesFilteredHint")}
                    </p>
                  )}
                  <MultiSelect
                    values={[...selectedTypes]}
                    onValuesChange={(values) =>
                      setSelectedTypes(new Set(values))
                    }
                  >
                    <MultiSelectTrigger
                      className="w-full rounded-[4px] border-2 border-border"
                      disabled={loadingOptions}
                    >
                      {loadingOptions ? (
                        <span className="text-muted-foreground flex items-center gap-2 font-normal">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {t("investigations.inquiryForm.optionsLoading")}
                        </span>
                      ) : (
                        <MultiSelectValue
                          placeholder={t(
                            "investigations.inquiryForm.findingTypesPlaceholder",
                          )}
                          overflowBehavior="wrap-when-open"
                        />
                      )}
                    </MultiSelectTrigger>
                    <MultiSelectContent
                      search={{
                        placeholder: t(
                          "investigations.inquiryForm.filterTypesPlaceholder",
                        ),
                        emptyMessage: t(
                          "investigations.inquiryForm.searchEmpty",
                        ),
                      }}
                    >
                      <MultiSelectGroup>
                        {availableTypeRows.map((row) => (
                          <MultiSelectItem
                            key={row.value}
                            value={row.value}
                            badgeLabel={row.value}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-medium">
                                {row.value}
                              </span>
                              <span className="text-muted-foreground shrink-0 text-xs">
                                · {row.count}
                              </span>
                            </span>
                          </MultiSelectItem>
                        ))}
                        {orphanTypeValues.map((value) => (
                          <MultiSelectItem
                            key={value}
                            value={value}
                            badgeLabel={value}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-mono text-xs">
                                {value}
                              </span>
                              <span className="text-muted-foreground shrink-0 text-xs">
                                {t("investigations.inquiryForm.unobservedType")}
                              </span>
                            </span>
                          </MultiSelectItem>
                        ))}
                      </MultiSelectGroup>
                    </MultiSelectContent>
                  </MultiSelect>
                </div>

                <Accordion type="single" collapsible>
                  <AccordionItem value="advanced">
                    <AccordionTrigger
                      caption={t("investigations.inquiryForm.advancedDesc")}
                    >
                      {t("investigations.inquiryForm.advancedTitle")}
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4">
                      <div className="space-y-2">
                        <Label>
                          {t("investigations.inquiryForm.findingTypesLabel")}{" "}
                          <span className="text-muted-foreground font-normal">
                            regex
                          </span>
                        </Label>
                        <Input
                          value={regexText}
                          onChange={(e) => setRegexText(e.target.value)}
                          placeholder={t(
                            "investigations.inquiryForm.typeRegexPlaceholder",
                          )}
                          className="h-8 font-mono text-xs"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>
                          {t("investigations.inquiryForm.valueFilterLabel")}{" "}
                          <span className="text-muted-foreground font-normal">
                            {t("investigations.inquiryForm.valueFilterHint")}
                          </span>
                        </Label>
                        <p className="text-muted-foreground text-[11px]">
                          {t("investigations.inquiryForm.valueFilterDesc")}
                        </p>
                        <Input
                          value={valueRegexText}
                          onChange={(e) => setValueRegexText(e.target.value)}
                          placeholder={t(
                            "investigations.inquiryForm.valueRegexPlaceholder",
                          )}
                          className="h-8 font-mono text-xs"
                        />
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            </AiAssistedCard>
          </section>

          <section ref={sectionRefs.preview}>
            <AiAssistedCard
              title={t("investigations.inquiryForm.previewCardTitle")}
              description={t("investigations.inquiryForm.previewCardDesc")}
              active={activeStep === "preview"}
            >
              {noSourcesChosen ? (
                <p className="text-muted-foreground text-sm">
                  {t("investigations.inquiryForm.previewChooseSources")}
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex items-baseline gap-2">
                      <span className="font-serif text-4xl font-black tabular-nums">
                        {preview?.total ?? "—"}
                      </span>
                      <span className="text-muted-foreground text-sm">
                        {t("investigations.inquiryForm.findingsMatchNow")}
                      </span>
                    </div>
                    {previewing && (
                      <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
                    )}
                  </div>
                  {preview && preview.sample.length > 0 && (
                    <ScrollArea className="h-72 rounded-[4px] border border-border">
                      <div className="divide-y divide-border/60">
                        {preview.sample.map((m) => (
                          <div
                            key={m.findingId}
                            className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <Fingerprint className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                              <span className="truncate font-medium">
                                {m.label}
                              </span>
                              {m.severity && (
                                <SeverityBadge
                                  severity={m.severity.toLowerCase() as never}
                                  className="shrink-0"
                                >
                                  {m.severity}
                                </SeverityBadge>
                              )}
                              {m.matchedContent && (
                                <span className="text-muted-foreground truncate text-[11px]">
                                  {m.matchedContent.slice(0, 48)}
                                </span>
                              )}
                            </span>
                            {m.assetName && (
                              <span className="text-muted-foreground max-w-[40%] shrink-0 truncate text-xs">
                                {m.assetName}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                  {preview && preview.total > preview.sample.length && (
                    <p className="text-muted-foreground text-xs">
                      {t("investigations.inquiryForm.showingOf", {
                        shown: preview.sample.length,
                        total: preview.total,
                      })}
                    </p>
                  )}
                </div>
              )}
            </AiAssistedCard>
          </section>

          <StickyActionToolbar
            onCancel={back}
            cancelLabel={t("common.cancel")}
            onSaveAndRun={() => void save()}
            saveAndRunLabel={
              isEdit
                ? t("investigations.inquiryForm.update")
                : t("investigations.inquiryForm.create")
            }
            runIcon={
              saving ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined
            }
            hint={
              preview
                ? t("investigations.inquiryForm.currentMatches", {
                    count: preview.total,
                  })
                : undefined
            }
            isBusy={saving}
            saveAndRunDisabled={!title.trim()}
            saveAndRunTestId="btn-save-inquiry"
            className="mt-0"
          />
        </div>

        {/* Right sticky sidebar — desktop only */}
        <aside className="hidden self-start md:sticky md:top-6 md:block md:w-44 lg:w-52">
          <VerticalStepperNav
            steps={steps}
            activeStepId={activeStep}
            onNavigate={scrollTo}
            label={t("investigations.inquiryForm.navLabel")}
          />
        </aside>
      </div>
    </div>
  );
});
