"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FolderPlus, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type CreateCaseDto,
  type InquiryMatchDto,
  type InquiryResponseDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Badge } from "@workspace/ui/components/badge";
import { Textarea } from "@workspace/ui/components/textarea";
import { Card, CardContent } from "@workspace/ui/components/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import {
  MultiSelect,
  MultiSelectContent,
  MultiSelectGroup,
  MultiSelectItem,
  MultiSelectTrigger,
  MultiSelectValue,
} from "@workspace/ui/components/multi-select";
import { ArrowLeft } from "lucide-react";
import { InquiryMatchesTable } from "@/components/inquiry-matches-table";
import { useTranslation } from "@/hooks/use-translation";

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;

/**
 * Dedicated case-creation page. A case can start blank or be driven by any
 * number of inquiries; for each one the analyst chooses which current matches
 * are copied in as the initial evidence.
 */
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

  const [allInquiries, setAllInquiries] = React.useState<InquiryResponseDto[]>([]);
  const [selectedInquiryIds, setSelectedInquiryIds] = React.useState<string[]>(
    initialInquiryId ? [initialInquiryId] : [],
  );
  // Per-inquiry live matches + per-inquiry selected finding ids.
  const [matchesByInquiry, setMatchesByInquiry] = React.useState<
    Map<string, InquiryMatchDto[]>
  >(new Map());
  const [selectedByInquiry, setSelectedByInquiry] = React.useState<Map<string, Set<string>>>(
    new Map(),
  );
  const [loadingMatches, setLoadingMatches] = React.useState<Set<string>>(new Set());

  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [severity, setSeverity] = React.useState<string>("MEDIUM");
  const [assignee, setAssignee] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  // Load all inquiries for the picker.
  React.useEffect(() => {
    api.inquiries
      .inquiriesControllerList({ limit: 200 })
      .then((res) => setAllInquiries(res.items))
      .catch((err) => {
        console.error(err);
        toast.error(t("investigations.newCase.failedToLoadInquiries"));
      });
  }, []);

  // Prefill the title from the first selected inquiry.
  React.useEffect(() => {
    if (selectedInquiryIds.length === 0) return;
    const first = allInquiries.find((q) => q.id === selectedInquiryIds[0]);
    if (first) setTitle((prev) => prev || first.title);
  }, [selectedInquiryIds, allInquiries]);

  // Fetch matches for newly selected inquiries; default-select all of them.
  React.useEffect(() => {
    for (const id of selectedInquiryIds) {
      if (matchesByInquiry.has(id) || loadingMatches.has(id)) continue;
      setLoadingMatches((prev) => new Set(prev).add(id));
      api.inquiries
        .inquiriesControllerListMatches({ id, limit: 200 })
        .then((res) => {
          setMatchesByInquiry((prev) => new Map(prev).set(id, res.items));
          setSelectedByInquiry((prev) =>
            new Map(prev).set(id, new Set(res.items.map((x) => x.findingId))),
          );
        })
        .catch((err) => {
          console.error(err);
          toast.error(t("investigations.newCase.failedToLoadMatches"));
        })
        .finally(() =>
          setLoadingMatches((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          }),
        );
    }
  }, [selectedInquiryIds, matchesByInquiry, loadingMatches]);

  const totalSelected = selectedInquiryIds.reduce(
    (sum, id) => sum + (selectedByInquiry.get(id)?.size ?? 0),
    0,
  );

  const create = async () => {
    if (!title.trim()) {
      toast.error(t("investigations.newCase.titleRequired"));
      return;
    }
    setCreating(true);
    try {
      const dto: CreateCaseDto = {
        title: title.trim(),
        description: description.trim() || undefined,
        severity: severity as CreateCaseDto["severity"],
        assignee: assignee.trim() || undefined,
        inquiryIds: selectedInquiryIds.length > 0 ? selectedInquiryIds : undefined,
      };
      const created = await api.cases.casesControllerCreate({ createCaseDto: dto });

      let pulled = 0;
      let pullFailed = false;
      for (const inquiryId of selectedInquiryIds) {
        const findingIds = Array.from(selectedByInquiry.get(inquiryId) ?? []);
        if (findingIds.length === 0) continue;
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
        toast.success(t("investigations.newCase.caseOpenedWithFindings", { count: String(pulled) }));
      } else {
        toast.success(t("investigations.newCase.caseOpened"));
      }
      router.push(`/investigations/${created.id}`);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : t("investigations.newCase.failedToOpenCase"));
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <h1 className="font-serif text-2xl font-black uppercase tracking-[0.03em]">{t("investigations.newCase.title")}</h1>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          {t("investigations.newCase.description")}
        </p>
      </div>

      <div className="grid max-w-6xl gap-6 lg:grid-cols-[360px_1fr]">
        {/* ── Case details ── */}
        <div className="space-y-4">
          <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-[0.14em]">
            {t("investigations.newCase.caseDetails")}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="case-title">{t("investigations.newCase.titleLabel")}</Label>
            <Input
              id="case-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("investigations.newCase.titlePlaceholder")}
              maxLength={300}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="case-description">{t("investigations.newCase.descriptionLabel")}</Label>
            <Textarea
              id="case-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("investigations.newCase.descriptionPlaceholder")}
              rows={4}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("investigations.newCase.severityLabel")}</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="case-assignee">{t("investigations.newCase.assigneeLabel")}</Label>
            <Input
              id="case-assignee"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              placeholder={t("investigations.newCase.assigneePlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("investigations.newCase.drivingInquiries")}</Label>
            <MultiSelect values={selectedInquiryIds} onValuesChange={setSelectedInquiryIds}>
              <MultiSelectTrigger className="w-full">
                <MultiSelectValue placeholder={t("investigations.newCase.selectInquiries")} />
              </MultiSelectTrigger>
              <MultiSelectContent
                search={{ placeholder: t("investigations.newCase.searchInquiries"), emptyMessage: t("investigations.newCase.noInquiriesFound") }}
              >
                <MultiSelectGroup>
                  {allInquiries.map((q) => (
                    <MultiSelectItem key={q.id} value={q.id}>
                      <span className="inline-flex items-center gap-1.5">
                        {q.title}
                        <span className="text-muted-foreground text-xs">
                          {t("investigations.newCase.matchCount", { count: String(q.matchCount) })}
                        </span>
                      </span>
                    </MultiSelectItem>
                  ))}
                </MultiSelectGroup>
              </MultiSelectContent>
            </MultiSelect>
            <p className="text-muted-foreground text-xs">
              {t("investigations.newCase.inquiryDrivesMany")}
            </p>
          </div>

          <div className="pt-2">
            <Button onClick={create} disabled={creating || !title.trim()} className="w-full">
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FolderPlus className="h-4 w-4" />
              )}
              {totalSelected > 0
                ? t("investigations.newCase.openCaseWithFindings", { count: String(totalSelected) })
                : t("investigations.newCase.openCase")}
            </Button>
          </div>
        </div>

        {/* ── Initial evidence per inquiry ── */}
        <div className="space-y-5">
          {selectedInquiryIds.length === 0 ? (
            <Card>
              <CardContent className="text-muted-foreground p-4 text-sm">
                {t("investigations.newCase.emptyStartDesc")}
              </CardContent>
            </Card>
          ) : (
            selectedInquiryIds.map((inquiryId) => {
              const inquiry = allInquiries.find((q) => q.id === inquiryId);
              const matches = matchesByInquiry.get(inquiryId);
              const selected = selectedByInquiry.get(inquiryId) ?? new Set<string>();
              return (
                <div key={inquiryId} className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-[color:var(--color-amber-600,#d97706)]" />
                    <span className="text-sm font-medium">{inquiry?.title ?? inquiryId}</span>
                    {matches && (
                      <Badge variant="outline" className="text-[10px]">
                        {t("investigations.newCase.selectionCount", { selected: String(selected.size), total: String(matches.length) })}
                      </Badge>
                    )}
                  </div>
                  {!matches ? (
                    <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" /> {t("investigations.newCase.loadingMatches")}
                    </div>
                  ) : (
                    <InquiryMatchesTable
                      matches={matches}
                      selected={selected}
                      onSelectedChange={(next) =>
                        setSelectedByInquiry((prev) => new Map(prev).set(inquiryId, next))
                      }
                    />
                  )}
                </div>
              );
            })
          )}
          {selectedInquiryIds.length > 0 && (
            <p className="text-muted-foreground text-xs">
              {t("investigations.newCase.selectionDesc")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
