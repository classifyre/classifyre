"use client";

import { nsPath } from "@/lib/ns-path";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink, FolderPlus, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type AssistantUiAction,
  type CreateCaseDto,
  type InquiryResponseDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Label } from "@workspace/ui/components/label";
import { Switch } from "@workspace/ui/components/switch";
import { Card, CardContent } from "@workspace/ui/components/card";
import { ToneBadge } from "@workspace/ui/components";
import {
  MultiSelect,
  MultiSelectContent,
  MultiSelectGroup,
  MultiSelectItem,
  MultiSelectTrigger,
  MultiSelectValue,
} from "@workspace/ui/components/multi-select";
import { AiAssistedCard } from "@/components/ai-assisted-card";
import {
  HorizontalStepperNav,
  VerticalStepperNav,
  type StepperNavItem,
} from "@/components/stepper-nav";
import { StickyActionToolbar } from "@/components/sticky-action-toolbar";
import { InquiryMatchesPanel } from "@/components/inquiry-matches-panel";
import {
  CaseDetailsForm,
  EMPTY_CASE_DETAILS,
  type CaseDetailsValues,
} from "@/components/case-details-form";
import { useRegisterAssistantBridge } from "@/components/assistant-workflow-provider";
import { useScrollSpy } from "@/hooks/use-scroll-spy";
import { useTranslation } from "@/hooks/use-translation";

const STEP_IDS = ["details", "inquiries", "evidence"] as const;
type StepId = (typeof STEP_IDS)[number];

/**
 * What a case takes from one watch when it opens.
 *
 * "all" is not a list of every id: it maps to omitting `findingIds` in the pull
 * DTO, which the API already reads as "every live match". That is what lets the
 * default be "bring everything" without paging thousands of rows into the
 * browser first — which is exactly what the old page did, capped at 200.
 */
type InquirySelection =
  | { mode: "all"; autoPull: boolean }
  | { mode: "ids"; ids: Set<string>; autoPull: boolean };

export default function NewCasePage() {
  return (
    <React.Suspense>
      <NewCasePageInner />
    </React.Suspense>
  );
}

function NewCasePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const initialInquiryId = searchParams.get("inquiryId");

  const [details, setDetails] =
    React.useState<CaseDetailsValues>(EMPTY_CASE_DETAILS);
  const [allInquiries, setAllInquiries] = React.useState<InquiryResponseDto[]>(
    [],
  );
  const [selectedInquiryIds, setSelectedInquiryIds] = React.useState<string[]>(
    initialInquiryId ? [initialInquiryId] : [],
  );
  const [selectionByInquiry, setSelectionByInquiry] = React.useState<
    Map<string, InquirySelection>
  >(new Map());
  const [creating, setCreating] = React.useState(false);

  const { activeStep, sectionRefs, scrollTo } = useScrollSpy(STEP_IDS, [
    selectedInquiryIds.length,
  ]);

  const steps: StepperNavItem<StepId>[] = [
    {
      id: "details",
      title: t("investigations.newCase.stepDetails"),
      description: t("investigations.newCase.stepDetailsDesc"),
    },
    {
      id: "inquiries",
      title: t("investigations.newCase.stepInquiries"),
      description: t("investigations.newCase.stepInquiriesDesc"),
    },
    {
      id: "evidence",
      title: t("investigations.newCase.stepEvidence"),
      description: t("investigations.newCase.stepEvidenceDesc"),
      disabled: selectedInquiryIds.length === 0,
    },
  ];

  const back = () => router.push(nsPath("/investigations"));

  // ── Inquiry list, refreshed when a sibling tab may have added one ─────────

  const loadInquiries = React.useCallback(async () => {
    try {
      const res = await api.inquiries.inquiriesControllerList({ limit: 200 });
      return res.items;
    } catch (err) {
      console.error(err);
      toast.error(t("investigations.newCase.failedToLoadInquiries"));
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    void loadInquiries().then((items) => items && setAllInquiries(items));
  }, [loadInquiries]);

  /**
   * "New watch" opens the builder in another tab. Rather than plumbing a
   * channel between the two, refresh on return: anything ACTIVE that appeared
   * since this page mounted is what the person just went and made, so select it
   * for them.
   */
  const mountedAt = React.useRef(new Date());
  React.useEffect(() => {
    const onFocus = async () => {
      const items = await loadInquiries();
      if (!items) return;
      setAllInquiries(items);
      const fresh = items.filter(
        (q) =>
          q.status !== "ARCHIVED" &&
          new Date(q.createdAt).getTime() > mountedAt.current.getTime(),
      );
      if (fresh.length === 0) return;
      setSelectedInquiryIds((prev) => [
        ...prev,
        ...fresh.map((q) => q.id).filter((id) => !prev.includes(id)),
      ]);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadInquiries]);

  // Prefill the title from the first selected watch.
  React.useEffect(() => {
    if (selectedInquiryIds.length === 0) return;
    const first = allInquiries.find((q) => q.id === selectedInquiryIds[0]);
    if (!first) return;
    setDetails((prev) => (prev.title ? prev : { ...prev, title: first.title }));
  }, [selectedInquiryIds, allInquiries]);

  // A newly chosen watch defaults to bringing everything it currently matches.
  React.useEffect(() => {
    setSelectionByInquiry((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const id of selectedInquiryIds) {
        if (!next.has(id)) {
          next.set(id, { mode: "all", autoPull: false });
          changed = true;
        }
      }
      for (const id of next.keys()) {
        if (!selectedInquiryIds.includes(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [selectedInquiryIds]);

  const selectionFor = (id: string): InquirySelection =>
    selectionByInquiry.get(id) ?? { mode: "all", autoPull: false };

  const setSelection = (id: string, next: InquirySelection) =>
    setSelectionByInquiry((prev) => new Map(prev).set(id, next));

  // ── Assistant bridge ──────────────────────────────────────────────────────

  const assistantBridge = React.useMemo(
    () => ({
      contextKey: "case.create" as const,
      canOpen: true,
      getContext: () => ({
        key: "case.create" as const,
        route: "/investigations/cases/new",
        title: "Case Builder Assistant",
        entityId: null,
        values: { ...details, inquiryIds: selectedInquiryIds },
        schema: null,
        validation: { isValid: true, missingFields: [], errors: [] },
        metadata: {},
      }),
      applyAction: (action: AssistantUiAction) => {
        if (action.type !== "patch_fields") return;
        for (const patch of action.patches) {
          if (patch.path === "inquiryIds") {
            setSelectedInquiryIds(
              Array.isArray(patch.value) ? patch.value.map(String) : [],
            );
          } else if (
            patch.path === "title" ||
            patch.path === "description" ||
            patch.path === "severity" ||
            patch.path === "assignee"
          ) {
            const key = patch.path;
            setDetails((prev) => ({ ...prev, [key]: String(patch.value ?? "") }));
          }
        }
      },
    }),
    [details, selectedInquiryIds],
  );

  useRegisterAssistantBridge(assistantBridge);

  // ── Create ────────────────────────────────────────────────────────────────

  const create = async () => {
    if (!details.title.trim()) {
      toast.error(t("investigations.newCase.titleRequired"));
      return;
    }
    setCreating(true);
    try {
      const autoPullInquiryIds = selectedInquiryIds.filter(
        (id) => selectionFor(id).autoPull,
      );
      const dto: CreateCaseDto = {
        title: details.title.trim(),
        description: details.description.trim() || undefined,
        severity: details.severity as CreateCaseDto["severity"],
        assignee: details.assignee.trim() || undefined,
        inquiryIds:
          selectedInquiryIds.length > 0 ? selectedInquiryIds : undefined,
        autoPullInquiryIds:
          autoPullInquiryIds.length > 0 ? autoPullInquiryIds : undefined,
      };
      const created = await api.cases.casesControllerCreate({
        createCaseDto: dto,
      });

      let pulled = 0;
      let pullFailed = false;
      for (const inquiryId of selectedInquiryIds) {
        const selection = selectionFor(inquiryId);
        // Omitted findingIds is the API's own "everything this matches", so the
        // default costs one request rather than one per page of matches.
        const findingIds =
          selection.mode === "all" ? undefined : Array.from(selection.ids);
        if (findingIds && findingIds.length === 0) continue;
        try {
          const res = await api.cases.casesControllerPull({
            id: created.id,
            pullFromInquiryDto: { inquiryId, findingIds },
          });
          pulled += res.pulled;
        } catch (err) {
          console.error(err);
          pullFailed = true;
        }
      }
      if (pullFailed) {
        toast.warning(t("investigations.newCase.pullFailed"));
      } else if (pulled > 0) {
        toast.success(
          t("investigations.newCase.caseOpenedWithFindings", {
            count: String(pulled),
          }),
        );
      } else {
        toast.success(t("investigations.newCase.caseOpened"));
      }
      router.push(nsPath(`/investigations/${created.id}`));
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof Error
          ? err.message
          : t("investigations.newCase.failedToOpenCase"),
      );
      setCreating(false);
    }
  };

  const selectedCountHint = selectedInquiryIds
    .map((id) => selectionFor(id))
    .some((s) => s.mode === "all")
    ? undefined
    : t("investigations.matchesPanel.selectedCount", {
        count: selectedInquiryIds
          .reduce((sum, id) => {
            const s = selectionFor(id);
            return sum + (s.mode === "ids" ? s.ids.size : 0);
          }, 0)
          .toLocaleString(),
      });

  return (
    <div className="container max-w-6xl space-y-6 py-8">
      <div>
        <Button
          variant="outline"
          onClick={back}
          className="mb-4 rounded-[4px] border-2 border-border"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("investigations.newCase.back")}
        </Button>
        <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
          {t("investigations.newCase.title")}
        </h1>
        <p className="text-muted-foreground mt-2 max-w-2xl">
          {t("investigations.newCase.description")}
        </p>
      </div>

      {/* Mobile sticky horizontal nav */}
      <div className="sticky top-0 z-20 -mx-4 mb-6 border-b-2 border-border bg-background/95 px-4 py-2 backdrop-blur-sm md:hidden">
        <HorizontalStepperNav
          steps={steps}
          activeStepId={activeStep}
          onNavigate={scrollTo}
          label={t("investigations.newCase.navLabel")}
        />
      </div>

      <div className="flex gap-8 lg:gap-12">
        <div className="min-w-0 flex-1 space-y-16 pb-32">
          {/* ── Details ── */}
          <section ref={sectionRefs.details as React.RefObject<HTMLElement>}>
            <AiAssistedCard
              title={t("investigations.newCase.stepDetails")}
              description={t("investigations.newCase.stepDetailsDesc")}
              active={activeStep === "details"}
            >
              <CaseDetailsForm values={details} onChange={setDetails} />
            </AiAssistedCard>
          </section>

          {/* ── Driving watches ── */}
          <section ref={sectionRefs.inquiries as React.RefObject<HTMLElement>}>
            <AiAssistedCard
              title={t("investigations.newCase.stepInquiries")}
              description={t("investigations.newCase.stepInquiriesDesc")}
              active={activeStep === "inquiries"}
              headerActions={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    window.open(
                      nsPath("/investigations/inquiries/new"),
                      "_blank",
                      "noopener",
                    )
                  }
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t("investigations.newCase.newInquiry")}
                </Button>
              }
            >
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>{t("investigations.newCase.drivingInquiries")}</Label>
                  <MultiSelect
                    values={selectedInquiryIds}
                    onValuesChange={setSelectedInquiryIds}
                  >
                    <MultiSelectTrigger className="w-full">
                      <MultiSelectValue
                        placeholder={t("investigations.newCase.selectInquiries")}
                      />
                    </MultiSelectTrigger>
                    <MultiSelectContent
                      search={{
                        placeholder: t("investigations.newCase.searchInquiries"),
                        emptyMessage: t(
                          "investigations.newCase.noInquiriesFound",
                        ),
                      }}
                    >
                      <MultiSelectGroup>
                        {allInquiries.map((q) => (
                          <MultiSelectItem key={q.id} value={q.id}>
                            <span className="inline-flex items-center gap-1.5">
                              {q.title}
                              <span className="text-muted-foreground text-xs">
                                {t("investigations.newCase.matchCount", {
                                  count: String(q.matchCount),
                                })}
                              </span>
                              {q.newMatchCount > 0 && (
                                <ToneBadge tone="fresh">
                                  {q.newMatchCount}{" "}
                                  {t("investigations.matchState.new")}
                                </ToneBadge>
                              )}
                            </span>
                          </MultiSelectItem>
                        ))}
                      </MultiSelectGroup>
                    </MultiSelectContent>
                  </MultiSelect>
                  <p className="text-muted-foreground text-xs">
                    {t("investigations.newCase.inquiryDrivesMany")}{" "}
                    {t("investigations.newCase.newInquiryHint")}
                  </p>
                </div>

                {selectedInquiryIds.map((id) => {
                  const inquiry = allInquiries.find((q) => q.id === id);
                  const selection = selectionFor(id);
                  return (
                    <Card key={id}>
                      <CardContent className="flex flex-wrap items-center gap-3 p-3">
                        <Sparkles className="h-4 w-4 shrink-0 text-accent-ink" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {inquiry?.title ?? id}
                        </span>
                        <div className="flex items-center gap-2">
                          <Label
                            htmlFor={`autopull-${id}`}
                            className="text-xs font-normal"
                          >
                            {t("investigations.newCase.autoPullLabel")}
                          </Label>
                          <Switch
                            id={`autopull-${id}`}
                            checked={selection.autoPull}
                            onCheckedChange={(checked) =>
                              setSelection(id, {
                                ...selection,
                                autoPull: checked,
                              })
                            }
                          />
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}

                {selectedInquiryIds.length > 0 && (
                  <p className="text-muted-foreground text-xs">
                    {t("investigations.newCase.autoPullDesc")}
                  </p>
                )}
              </div>
            </AiAssistedCard>
          </section>

          {/* ── Opening evidence ── */}
          <section ref={sectionRefs.evidence as React.RefObject<HTMLElement>}>
            <AiAssistedCard
              title={t("investigations.newCase.stepEvidence")}
              description={t("investigations.newCase.stepEvidenceDesc")}
              active={activeStep === "evidence"}
            >
              {selectedInquiryIds.length === 0 ? (
                <div className="text-muted-foreground space-y-1 py-4 text-sm">
                  <p className="font-medium">
                    {t("investigations.newCase.noInquiriesSelected")}
                  </p>
                  <p className="text-xs">
                    {t("investigations.newCase.noInquiriesSelectedDesc")}
                  </p>
                </div>
              ) : (
                <div className="space-y-8">
                  {selectedInquiryIds.map((id) => {
                    const inquiry = allInquiries.find((q) => q.id === id);
                    const selection = selectionFor(id);
                    return (
                      <div key={id} className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Sparkles className="h-3.5 w-3.5 text-accent-ink" />
                          <span className="text-sm font-medium">
                            {inquiry?.title ?? id}
                          </span>
                        </div>
                        <InquiryMatchesPanel
                          inquiryId={id}
                          selected={
                            selection.mode === "ids"
                              ? selection.ids
                              : new Set<string>()
                          }
                          onSelectedChange={(ids) =>
                            setSelection(id, {
                              mode: "ids",
                              ids,
                              autoPull: selection.autoPull,
                            })
                          }
                          allSelected={selection.mode === "all"}
                          onAllSelectedChange={(all) =>
                            setSelection(
                              id,
                              all
                                ? { mode: "all", autoPull: selection.autoPull }
                                : {
                                    mode: "ids",
                                    ids: new Set<string>(),
                                    autoPull: selection.autoPull,
                                  },
                            )
                          }
                        />
                      </div>
                    );
                  })}
                  <p className="text-muted-foreground text-xs">
                    {t("investigations.newCase.selectionDesc")}
                  </p>
                </div>
              )}
            </AiAssistedCard>
          </section>

          <StickyActionToolbar
            onCancel={back}
            cancelLabel={t("common.cancel")}
            onSaveAndRun={() => void create()}
            saveAndRunLabel={
              creating
                ? t("investigations.newCase.creating")
                : t("investigations.newCase.openCase")
            }
            runIcon={
              creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FolderPlus className="h-4 w-4" />
              )
            }
            hint={selectedCountHint}
            isBusy={creating}
            saveAndRunDisabled={!details.title.trim()}
            saveAndRunTestId="btn-open-case"
            className="mt-0"
          />
        </div>

        {/* Right sticky sidebar — desktop only */}
        <aside className="hidden self-start md:sticky md:top-6 md:block md:w-44 lg:w-52">
          <VerticalStepperNav
            steps={steps}
            activeStepId={activeStep}
            onNavigate={scrollTo}
            label={t("investigations.newCase.navLabel")}
          />
        </aside>
      </div>
    </div>
  );
}
