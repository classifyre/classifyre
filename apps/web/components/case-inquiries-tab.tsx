"use client";

import { nsPath } from "@/lib/ns-path";
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  DownloadCloud,
  ExternalLink,
  Link2,
  Loader2,
  Pencil,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type CaseLinkedInquiryDto,
  type InquiryResponseDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Label } from "@workspace/ui/components/label";
import { Switch } from "@workspace/ui/components/switch";
import { ToneBadge, Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog";
import { InquiryMatchesPanel } from "@/components/inquiry-matches-panel";
import { useTranslation } from "@/hooks/use-translation";

export type CaseInquiriesTabProps = {
  caseId: string;
  linked: CaseLinkedInquiryDto[];
  linkable: InquiryResponseDto[];
  isClosed: boolean;
  /** Findings already attached — shown as "in case" and not selectable. */
  inCaseFindingIds: Set<string>;
  onChanged: () => void;
};

/**
 * The watches driving a case, and what their latest scans landed.
 *
 * This used to be a column of the Case file tab, which put the one surface that
 * tells you the corpus has moved behind a tab about writing the conclusion —
 * and every review of a new match meant leaving the case for the inquiry page
 * and finding your way back. The matches panel is inlined here for that reason.
 */
export function CaseInquiriesTab({
  caseId,
  linked,
  linkable,
  isClosed,
  inCaseFindingIds,
  onChanged,
}: CaseInquiriesTabProps) {
  const router = useRouter();
  const { t } = useTranslation();

  const [focusedId, setFocusedId] = React.useState<string | null>(
    linked[0]?.id ?? null,
  );
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [inquiryToLink, setInquiryToLink] = React.useState("");
  const [linking, setLinking] = React.useState(false);
  const [pulling, setPulling] = React.useState<string | null>(null);
  const [savingAutoPull, setSavingAutoPull] = React.useState<string | null>(null);

  // Keep the focus on a watch that still exists after a link or unlink.
  React.useEffect(() => {
    if (focusedId && linked.some((q) => q.id === focusedId)) return;
    setFocusedId(linked[0]?.id ?? null);
    setSelected(new Set());
  }, [linked, focusedId]);

  const pullableSelected = React.useMemo(
    () => Array.from(selected).filter((id) => !inCaseFindingIds.has(id)),
    [selected, inCaseFindingIds],
  );

  const linkInquiry = async () => {
    if (!inquiryToLink) return;
    setLinking(true);
    try {
      await api.cases.casesControllerLinkInquiries({
        id: caseId,
        linkInquiriesDto: { inquiryIds: [inquiryToLink] },
      });
      toast.success(t("investigations.caseDetail.inquiryLinked"));
      setInquiryToLink("");
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error(t("investigations.caseDetail.failedToLinkInquiry"));
    } finally {
      setLinking(false);
    }
  };

  const unlinkInquiry = async (inquiryId: string) => {
    try {
      await api.cases.casesControllerUnlinkInquiry({ id: caseId, inquiryId });
      toast.success(t("investigations.caseDetail.inquiryUnlinked"));
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error(t("investigations.caseDetail.failedToUnlinkInquiry"));
    }
  };

  const setAutoPull = async (inquiryId: string, autoPull: boolean) => {
    setSavingAutoPull(inquiryId);
    try {
      await api.cases.casesControllerSetInquiryAutoPull({
        id: caseId,
        inquiryId,
        setInquiryAutoPullDto: { autoPull },
      });
      toast.success(t("investigations.caseDetail.autoPullUpdated"));
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error(t("investigations.caseDetail.failedToSetAutoPull"));
    } finally {
      setSavingAutoPull(null);
    }
  };

  /** Everything the watch currently matches, in one request. */
  const pullAll = async (inquiryId: string) => {
    setPulling(inquiryId);
    try {
      const res = await api.cases.casesControllerPull({
        id: caseId,
        pullFromInquiryDto: { inquiryId },
      });
      toast.success(
        t("investigations.caseDetail.pulled", { count: String(res.pulled) }),
      );
      setSelected(new Set());
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error(t("investigations.caseDetail.failedToPull"));
    } finally {
      setPulling(null);
    }
  };

  const addSelected = async () => {
    if (!focusedId || pullableSelected.length === 0) return;
    setPulling(focusedId);
    try {
      const res = await api.cases.casesControllerPull({
        id: caseId,
        pullFromInquiryDto: {
          inquiryId: focusedId,
          findingIds: pullableSelected,
        },
      });
      toast.success(
        t("investigations.caseDetail.pulled", { count: String(res.pulled) }),
      );
      setSelected(new Set());
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error(t("investigations.caseDetail.failedToPull"));
    } finally {
      setPulling(null);
    }
  };

  const goneTotal = linked.reduce((sum, q) => sum + q.goneMatchCount, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-muted-foreground max-w-2xl text-xs">
          {t("investigations.caseDetail.inquiriesTabDesc")}
        </p>
        {!isClosed && (
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
        )}
      </div>

      {/* Evidence the corpus has dropped out from under the case. Worth saying
          once at the top: it is the kind of thing an investigator must know
          before citing it, and nothing else on the case surfaces it. */}
      {goneTotal > 0 && (
        <Card className="border-destructive/40">
          <CardContent className="p-3 text-sm">
            <ToneBadge tone="error" dot>
              {goneTotal}
            </ToneBadge>{" "}
            {t("investigations.caseDetail.goneWarning", {
              count: String(goneTotal),
            })}
          </CardContent>
        </Card>
      )}

      {linked.length === 0 && (
        <Card>
          <CardContent className="text-muted-foreground p-4 text-sm">
            {t("investigations.caseDetail.noInquiryLinked")}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        {/* ── The watches ── */}
        <div className="space-y-2">
          {linked.map((q) => {
            const focused = q.id === focusedId;
            return (
              <Card
                key={q.id}
                className={focused ? "border-accent/60" : undefined}
              >
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 shrink-0 text-accent-ink" />
                    <button
                      className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
                      onClick={() => {
                        setFocusedId(q.id);
                        setSelected(new Set());
                      }}
                    >
                      {q.title}
                    </button>
                    {q.status === "ARCHIVED" && (
                      <ToneBadge tone="archived">
                        {t("investigations.caseDetail.archived")}
                      </ToneBadge>
                    )}
                    {q.status !== "ARCHIVED" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        aria-label={t("investigations.caseDetail.editInquiryQuery")}
                        onClick={() =>
                          router.push(
                            nsPath(`/investigations/inquiries/${q.id}/edit`),
                          )
                        }
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    )}
                    {!isClosed && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-muted-foreground h-6 w-6"
                            aria-label={t("investigations.caseDetail.unlinkInquiry")}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {t("investigations.caseDetail.unlinkInquiryTitle", {
                                title: q.title,
                              })}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {t("investigations.caseDetail.unlinkInquiryDesc")}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>
                              {t("common.cancel")}
                            </AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => void unlinkInquiry(q.id)}
                            >
                              {t("investigations.caseDetail.unlink")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {q.matchCount}{" "}
                      {t("investigations.caseDetail.currentMatch")}
                    </span>
                    {q.newMatchCount > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <ToneBadge tone="fresh">
                              {q.newMatchCount}{" "}
                              {t("investigations.matchState.new")}
                            </ToneBadge>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("investigations.matchState.newTooltip")}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {q.goneMatchCount > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <ToneBadge tone="error">
                              {q.goneMatchCount}{" "}
                              {t("investigations.caseDetail.goneMatch")}
                            </ToneBadge>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("investigations.matchState.goneTooltip")}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  {!isClosed && (
                    <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
                      <Label
                        htmlFor={`autopull-${q.id}`}
                        className="text-xs font-normal"
                      >
                        {t("investigations.caseDetail.autoPull")}
                      </Label>
                      <div className="flex items-center gap-2">
                        {savingAutoPull === q.id && (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        )}
                        <Switch
                          id={`autopull-${q.id}`}
                          checked={q.autoPull}
                          disabled={savingAutoPull === q.id}
                          onCheckedChange={(checked) =>
                            void setAutoPull(q.id, checked)
                          }
                        />
                      </div>
                    </div>
                  )}
                  {!isClosed && (
                    <p className="text-muted-foreground text-[11px]">
                      {q.autoPull
                        ? t("investigations.caseDetail.autoPullOn")
                        : t("investigations.caseDetail.autoPullOff")}
                    </p>
                  )}

                  {!isClosed && q.matchCount > 0 && (
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() =>
                          router.push(
                            nsPath(
                              `/investigations/inquiries/${q.id}?caseId=${caseId}`,
                            ),
                          )
                        }
                      >
                        {t("investigations.caseDetail.selectMatchesToPull")}{" "}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pulling === q.id}
                        onClick={() => void pullAll(q.id)}
                        title={t("investigations.caseDetail.pullAllMatches")}
                      >
                        {pulling === q.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <DownloadCloud className="h-3.5 w-3.5" />
                        )}
                        {t("investigations.caseDetail.all")}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {!isClosed && linkable.length > 0 && (
            <div className="flex gap-1.5">
              <Select value={inquiryToLink} onValueChange={setInquiryToLink}>
                <SelectTrigger className="h-8 flex-1 text-xs">
                  <SelectValue
                    placeholder={t("investigations.caseDetail.linkAnotherInquiry")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {linkable.map((q) => (
                    <SelectItem key={q.id} value={q.id}>
                      {q.title}{" "}
                      <span className="text-muted-foreground">
                        ({q.matchCount})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void linkInquiry()}
                disabled={!inquiryToLink || linking}
              >
                {linking ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Link2 className="h-3.5 w-3.5" />
                )}
                {t("investigations.caseDetail.link")}
              </Button>
            </div>
          )}
        </div>

        {/* ── What the focused watch currently answers ── */}
        <div className="min-w-0 space-y-3">
          {!focusedId ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {t("investigations.caseDetail.selectInquiry")}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  size="sm"
                  onClick={() => void addSelected()}
                  disabled={
                    isClosed ||
                    pulling === focusedId ||
                    pullableSelected.length === 0
                  }
                >
                  {pulling === focusedId ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <DownloadCloud className="h-3.5 w-3.5" />
                  )}
                  {t("investigations.caseDetail.addSelectedToCase")}
                </Button>
              </div>
              <InquiryMatchesPanel
                inquiryId={focusedId}
                inCaseFindingIds={inCaseFindingIds}
                selected={isClosed ? undefined : selected}
                onSelectedChange={isClosed ? undefined : setSelected}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
