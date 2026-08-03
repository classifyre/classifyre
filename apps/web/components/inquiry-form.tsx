"use client";

import { nsPath } from "@/lib/ns-path";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Database, Fingerprint, Loader2 } from "lucide-react";
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
import { StickyActionToolbar } from "@/components/sticky-action-toolbar";
import {
  HorizontalStepperNav,
  VerticalStepperNav,
  type StepperNavItem,
} from "@/components/stepper-nav";
import { useTranslation } from "@/hooks/use-translation";

const DETECTORS = [
  "SECRETS",
  "PII",
  "YARA",
  "BROKEN_LINKS",
  "CODE_SECURITY",
  "CUSTOM",
] as const;
const parseList = (s: string) =>
  s
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);
const joinList = (items: string[]) => items.join(", ");

const STEP_IDS = ["define", "filters", "preview"] as const;
type StepId = (typeof STEP_IDS)[number];

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 rounded-[4px] border-2 px-2.5 py-1 text-xs font-medium transition-all ${
        active
          ? "border-border bg-foreground text-background shadow-[2px_2px_0_var(--color-border)]"
          : "border-border text-muted-foreground hover:bg-accent"
      }`}
    >
      {active && <Check className="h-3 w-3" />}
      {children}
    </button>
  );
}

function applyInitialFindingTypes(
  findingTypes: string[],
  options: MatchOptionsResponseDto | null,
): { selectedTypes: Set<string>; customTypeText: string } {
  if (!options) {
    return { selectedTypes: new Set(findingTypes), customTypeText: "" };
  }
  const known = new Set(options.findingTypes.map((t) => t.value));
  const selected = findingTypes.filter((t) => known.has(t));
  const custom = findingTypes.filter((t) => !known.has(t));
  return {
    selectedTypes: new Set(selected),
    customTypeText: joinList(custom),
  };
}

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
    () => new Set(initial?.detectorTypes ?? []),
  );
  const [selectedCustomKeys, setSelectedCustomKeys] = React.useState<
    Set<string>
  >(() => new Set(initial?.customDetectorKeys ?? []));
  const [selectedTypes, setSelectedTypes] = React.useState<Set<string>>(
    () => new Set(initial?.findingTypes ?? []),
  );
  const [customTypeText, setCustomTypeText] = React.useState("");
  const [regexText, setRegexText] = React.useState(
    joinList(initial?.findingTypeRegex ?? []),
  );
  const [valueRegexText, setValueRegexText] = React.useState(
    joinList(initial?.findingValueRegex ?? []),
  );
  const [typeSearch, setTypeSearch] = React.useState("");

  const [options, setOptions] = React.useState<MatchOptionsResponseDto | null>(
    null,
  );
  const [preview, setPreview] = React.useState<PreviewResponseDto | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [activeStep, setActiveStep] = React.useState<StepId>("define");
  const findingTypesSplitRef = React.useRef(false);

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

  const toggle = (
    set: Set<string>,
    setter: (s: Set<string>) => void,
    id: string,
  ) => {
    const n = new Set(set);
    n.has(id) ? n.delete(id) : n.add(id);
    setter(n);
  };

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

  React.useEffect(() => {
    if (!isEdit || !initial || !options || findingTypesSplitRef.current) return;
    const { selectedTypes: splitSelected, customTypeText: splitCustom } =
      applyInitialFindingTypes(initial.findingTypes, options);
    setSelectedTypes(splitSelected);
    setCustomTypeText(splitCustom);
    findingTypesSplitRef.current = true;
  }, [isEdit, initial, options]);

  const matchers = React.useMemo(
    () => ({
      matchAllSources,
      sourceIds: matchAllSources ? [] : Array.from(selectedSources),
      detectorTypes: Array.from(selectedDetectors) as never,
      customDetectorKeys: Array.from(selectedCustomKeys),
      findingTypes: [...selectedTypes, ...parseList(customTypeText)],
      findingTypeRegex: parseList(regexText),
      findingValueRegex: parseList(valueRegexText),
    }),
    [
      matchAllSources,
      selectedSources,
      selectedDetectors,
      selectedCustomKeys,
      selectedTypes,
      customTypeText,
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
            setSelectedDetectors(
              new Set(
                Array.isArray(patch.value) ? patch.value.map(String) : [],
              ),
            );
          } else if (patch.path === "matchers.customDetectorKeys") {
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

  const filteredTypes = (options?.findingTypes ?? []).filter(
    (type) =>
      !typeSearch.trim() ||
      type.value.toLowerCase().includes(typeSearch.trim().toLowerCase()),
  );
  const noSourcesChosen = !matchAllSources && selectedSources.size === 0;

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <div>
        <Button
          variant="outline"
          onClick={back}
          className="mb-4 rounded-[4px] border-2 border-border shadow-[3px_3px_0_var(--color-border)]"
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
                  <div className="flex flex-wrap gap-1.5">
                    <Chip
                      active={matchAllSources}
                      onClick={() => setMatchAllSources(true)}
                    >
                      {t("investigations.inquiryForm.allSources")}
                    </Chip>
                    <Chip
                      active={!matchAllSources}
                      onClick={() => setMatchAllSources(false)}
                    >
                      {t("investigations.inquiryForm.specificSources")}
                    </Chip>
                  </div>
                  {!matchAllSources && (
                    <div className="flex max-h-40 flex-wrap gap-1.5 overflow-auto rounded-[4px] border border-border p-2">
                      {(options?.sources ?? []).length === 0 && (
                        <span className="text-muted-foreground text-xs">
                          {t("investigations.inquiryForm.noSources")}
                        </span>
                      )}
                      {(options?.sources ?? []).map((s) => (
                        <Chip
                          key={s.id}
                          active={selectedSources.has(s.id)}
                          onClick={() =>
                            toggle(selectedSources, setSelectedSources, s.id)
                          }
                        >
                          {s.name}
                        </Chip>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>
                    {t("investigations.inquiryForm.detectorTypesLabel")}{" "}
                    <span className="text-muted-foreground font-normal">
                      {t("investigations.inquiryForm.emptyMeansAny")}
                    </span>
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {DETECTORS.map((d) => (
                      <Chip
                        key={d}
                        active={selectedDetectors.has(d)}
                        onClick={() =>
                          toggle(selectedDetectors, setSelectedDetectors, d)
                        }
                      >
                        {d}
                      </Chip>
                    ))}
                  </div>
                </div>

                {(options?.customDetectors ?? []).length > 0 && (
                  <div className="space-y-2">
                    <Label>
                      {t("investigations.inquiryForm.customDetectorsLabel")}
                    </Label>
                    <div className="flex flex-wrap gap-1.5">
                      {options!.customDetectors.map((c) => (
                        <Chip
                          key={c.key}
                          active={selectedCustomKeys.has(c.key)}
                          onClick={() =>
                            toggle(
                              selectedCustomKeys,
                              setSelectedCustomKeys,
                              c.key,
                            )
                          }
                        >
                          {c.name}
                        </Chip>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>
                    {t("investigations.inquiryForm.findingTypesLabel")}{" "}
                    <span className="text-muted-foreground font-normal">
                      {t("investigations.inquiryForm.emptyMeansAny")}
                    </span>
                  </Label>
                  <Input
                    value={typeSearch}
                    onChange={(e) => setTypeSearch(e.target.value)}
                    placeholder={t(
                      "investigations.inquiryForm.filterTypesPlaceholder",
                    )}
                    className="h-8 max-w-xs"
                  />
                  {filteredTypes.length > 0 ? (
                    <div className="flex max-h-44 flex-wrap gap-1.5 overflow-auto rounded-[4px] border border-border p-2">
                      {filteredTypes.map((type) => (
                        <Chip
                          key={`${type.detectorType}:${type.value}`}
                          active={selectedTypes.has(type.value)}
                          onClick={() =>
                            toggle(selectedTypes, setSelectedTypes, type.value)
                          }
                        >
                          {type.value}{" "}
                          <span className="opacity-50">· {type.count}</span>
                        </Chip>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      {noSourcesChosen
                        ? t(
                            "investigations.inquiryForm.noDetectedTypesPickSources",
                          )
                        : t("investigations.inquiryForm.noDetectedTypes")}
                    </p>
                  )}
                  <Input
                    value={customTypeText}
                    onChange={(e) => setCustomTypeText(e.target.value)}
                    placeholder={t(
                      "investigations.inquiryForm.customTypesPlaceholder",
                    )}
                    className="h-8"
                  />
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
