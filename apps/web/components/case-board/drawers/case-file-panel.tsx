"use client";

import * as React from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { AlertCircle, Bot, Check, CheckCircle2, Filter, History, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, type CaseCleanupPreviewDto, type CaseResponseDto, type UpdateCaseDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import { ToneBadge } from "@workspace/ui/components/tone-badge";
import { cn } from "@workspace/ui/lib/utils";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { EscalationFlag } from "@workspace/case-board/components/finding-node";
import { CaseDetailsForm, type CaseDetailsValues } from "@/components/case-details-form";
import {
  CleanupPreviewNote,
  CleanupSwitches,
  cleanupPreviewTotal,
  fetchCleanupPreview,
} from "@/components/case-cleanup/case-cleanup-settings";
import { CLEANUP_KEYS, cleanupOf, type CleanupKey } from "@/components/case-cleanup/cleanup-rules";
import { AiActorBadge, isAiActor } from "@/components/ai-actor-badge";
import { AiModeSelect, type AiMode } from "@/components/ai-mode-select";
import { CaseAutopilotStatus } from "@/components/autopilot/case-autopilot-status";
import { useAutosave, type AutosaveStatus } from "@/hooks/use-autosave";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useBoardStore, useUi, useUiStore } from "../store/board-context";
import { useTimelineLink } from "../hooks/use-timeline-link";
import { useVisibleCentre } from "../hooks/use-visible-centre";
import { placeTerm } from "../store/commands";
import { useNsPath } from "@/lib/ns-path";

/** The statuses a case moves between while it is being worked; closing has its own button. */
const STATUSES = ["OPEN", "IN_PROGRESS"] as const;

/** Text is compared as it will be saved: a trailing space typed mid-word is not a change. */
const sameText = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim() === (b ?? "").trim();

const sameDetails = (a: CaseDetailsValues, b: CaseDetailsValues) =>
  sameText(a.title, b.title) &&
  sameText(a.description, b.description) &&
  a.severity === b.severity &&
  sameText(a.assignee, b.assignee);

/**
 * The case file (PRD §5.9): what the case says it is about, how it runs, and
 * how it ends. Everything here saves as it is changed — there is no separate
 * edit page — and every change lands on the timeline (a stretch of typing as
 * one entry).
 */
export function CaseFilePanel({
  caseId,
  caseData,
  onChanged,
  onCaseChanged,
}: {
  caseId: string;
  caseData: CaseResponseDto | null;
  /** Something the board shows changed too (status, clean-up): refetch all of it. */
  onChanged: () => void;
  /** Only the case's own fields changed: reread the case. */
  onCaseChanged: () => void;
}) {
  const boardReadOnly = useBoard((s) => s.readOnly);
  if (!caseData) return <Loader2 className="size-4 animate-spin" />;
  const closed = caseData.status === "CLOSED" || caseData.status === "ARCHIVED";
  // A closed case is a record; a demo board is read-only too.
  const readOnly = boardReadOnly || closed;
  return (
    <div className="space-y-6" data-testid="case-file-panel">
      <DetailsSection caseId={caseId} caseData={caseData} readOnly={readOnly} onSaved={onCaseChanged} onStatusChanged={onChanged} />
      <MeaningSection readOnly={readOnly} />
      <AutopilotSection caseId={caseId} caseData={caseData} readOnly={readOnly} onChanged={onChanged} />
      <CleanupSection caseId={caseId} caseData={caseData} readOnly={readOnly} onChanged={onChanged} />
      <ConclusionSection caseId={caseId} caseData={caseData} readOnly={readOnly} onSaved={onCaseChanged} onClosed={onChanged} />
    </div>
  );
}

/**
 * The Meaning lens as a list (SL5 A2): the concepts this case's evidence is
 * about, how much evidence each covers, and a way to pin one to the board.
 */
function MeaningSection({ readOnly }: { readOnly: boolean }) {
  const { t } = useTranslation();
  const store = useBoardStore();
  const centre = useVisibleCentre();
  const nsPath = useNsPath();
  const semantic = useBoard((s) => s.semantic);
  if (!semantic || semantic.terms.length === 0) return null;
  const terms = [...semantic.terms]
    .filter((term) => !term.deleted)
    .sort((a, b) => b.linkedItems.length - a.linkedItems.length);
  return (
    <section className="space-y-2" data-testid="case-meaning-section">
      <SectionHeading>{t("caseBoard.meaning.title")}</SectionHeading>
      <ul className="space-y-1.5">
        {terms.map((term) => (
          <li key={term.termId} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full border border-border"
                style={{ backgroundColor: term.scheme?.color ?? "transparent" }}
              />
              <a
                href={nsPath(`/glossary/terms/${encodeURIComponent(term.key)}`)}
                className="truncate hover:underline"
              >
                {term.name}
              </a>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {t("caseBoard.term.linked", { count: String(term.linkedItems.length) })}
              </span>
            </span>
            {!readOnly && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 rounded-[4px] text-[11px]"
                onClick={() => {
                  const at = centre();
                  store
                    .getState()
                    .run(placeTerm(term.termId, term.placedItemId, { x: at.x - 100, y: at.y - 32 }));
                }}
              >
                {term.placedItemId ? t("caseBoard.meaning.show") : t("caseBoard.meaning.place")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {semantic.truncated > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {t("caseBoard.meaning.truncated", { count: String(semantic.truncated) })}
        </p>
      )}
    </section>
  );
}

function SectionHeading({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex min-h-6 items-center gap-2">
      <h3 className="min-w-0 flex-1 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">{children}</h3>
      {aside}
    </div>
  );
}

/** Where an autosaved field stands: saving, saved, or why it is not. */
export function SaveIndicator({
  status,
  invalidLabel,
  onRetry,
}: {
  status: AutosaveStatus;
  invalidLabel?: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (status === "idle") return null;
  if (status === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1 text-[11px] text-destructive hover:underline"
        data-testid="autosave-error"
      >
        <AlertCircle className="size-3" aria-hidden /> {t("caseBoard.caseFile.saveFailed")}
      </button>
    );
  }
  if (status === "invalid") {
    return <span className="text-[11px] text-destructive">{invalidLabel ?? t("caseBoard.caseFile.notSaved")}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" role="status" aria-live="polite">
      {status === "saved" ? (
        <>
          <Check className="size-3" aria-hidden /> {t("caseBoard.caseFile.saved")}
        </>
      ) : (
        <>
          <Loader2 className="size-3 animate-spin" aria-hidden /> {t("caseBoard.caseFile.saving")}
        </>
      )}
    </span>
  );
}

// ─── Details: title, description, severity, assignee, status ────────────────

function DetailsSection({
  caseId,
  caseData,
  readOnly,
  onSaved,
  onStatusChanged,
}: {
  caseId: string;
  caseData: CaseResponseDto;
  readOnly: boolean;
  onSaved: () => void;
  onStatusChanged: () => void;
}) {
  const { t } = useTranslation();
  const stored = React.useMemo<CaseDetailsValues>(
    () => ({
      title: caseData.title,
      description: caseData.description ?? "",
      severity: caseData.severity,
      assignee: caseData.assignee ?? "",
    }),
    [caseData.title, caseData.description, caseData.severity, caseData.assignee],
  );
  const details = useAutosave<CaseDetailsValues>({
    value: stored,
    isEqual: sameDetails,
    canSave: (v) => v.title.trim().length > 0,
    save: async (next, previous) => {
      // Only what changed: two people editing different fields do not overwrite each other.
      const dto: UpdateCaseDto = {};
      if (!sameText(next.title, previous.title)) dto.title = next.title.trim();
      // Empty clears the description rather than leaving the old text in place.
      if (!sameText(next.description, previous.description)) dto.description = next.description.trim();
      if (next.severity !== previous.severity) dto.severity = next.severity as UpdateCaseDto["severity"];
      if (!sameText(next.assignee, previous.assignee)) dto.assignee = next.assignee.trim();
      if (Object.keys(dto).length === 0) return;
      try {
        await api.cases.casesControllerUpdate({ id: caseId, updateCaseDto: dto });
      } catch (error) {
        toast.error(await extractApiErrorMessage(error, t("caseBoard.caseFile.saveError")));
        throw error;
      }
      onSaved();
    },
  });

  const [savingStatus, setSavingStatus] = React.useState(false);
  const setStatus = async (status: string) => {
    setSavingStatus(true);
    try {
      await api.cases.casesControllerUpdate({ id: caseId, updateCaseDto: { status: status as UpdateCaseDto["status"] } });
      onStatusChanged();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("caseBoard.caseFile.saveError")));
    } finally {
      setSavingStatus(false);
    }
  };

  const created = caseData.createdAt ? formatDistanceToNowStrict(new Date(caseData.createdAt), { addSuffix: true }) : null;

  return (
    <section className="space-y-3" data-testid="case-file-details">
      <SectionHeading
        aside={
          <SaveIndicator
            status={details.status}
            invalidLabel={t("investigations.newCase.titleRequired")}
            onRetry={() => void details.flush()}
          />
        }
      >
        {t("caseBoard.caseFile.details")}
      </SectionHeading>
      {/* Typing pauses save; leaving the fields saves at once. The board's
          shortcuts must not see keys typed here. */}
      <div
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) void details.flush();
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <CaseDetailsForm values={details.draft} onChange={details.setDraft} idPrefix="case-file" disabled={readOnly} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {isAiActor(caseData.createdBy) && <AiActorBadge />}
        {!readOnly && (
          <Select value={caseData.status} onValueChange={(status) => void setStatus(status)} disabled={savingStatus}>
            <SelectTrigger className="h-8 w-44 text-xs" aria-label={t("caseBoard.caseFile.status")} data-testid="case-file-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`caseBoard.caseFile.statuses.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {savingStatus && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        {created && (
          <span className="text-muted-foreground">
            {caseData.createdBy && !isAiActor(caseData.createdBy)
              ? t("caseBoard.caseFile.openedBy", { when: created, who: caseData.createdBy })
              : t("caseBoard.caseFile.opened", { when: created })}
          </span>
        )}
      </div>
    </section>
  );
}

// ─── Autopilot ────────────────────────────────────────────────────────────────

function AutopilotSection({
  caseId,
  caseData,
  readOnly,
  onChanged,
}: {
  caseId: string;
  caseData: CaseResponseDto;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const ui = useUiStore();
  const autopilotRefresh = useUi((s) => s.autopilotRefresh);
  const [saving, setSaving] = React.useState(false);
  const setMode = async (aiMode: AiMode) => {
    setSaving(true);
    try {
      await api.cases.casesControllerUpdate({ id: caseId, updateCaseDto: { aiMode: aiMode as UpdateCaseDto["aiMode"] } });
      onChanged();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("caseBoard.caseFile.saveError")));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="space-y-2" data-testid="case-file-autopilot">
      <SectionHeading
        aside={
          <AiModeSelect
            value={(caseData.aiMode ?? "INHERIT") as AiMode}
            disabled={saving || readOnly}
            onChange={(aiMode) => void setMode(aiMode)}
          />
        }
      >
        {t("caseBoard.caseFile.autopilot")}
      </SectionHeading>
      <CaseAutopilotStatus caseId={caseId} refreshKey={autopilotRefresh} onFinished={onChanged} />
      {!readOnly && (
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => ui.getState().set({ autopilotOpen: true })}>
          <Bot className="size-3.5" /> {t("investigations.caseDetail.runAI")}
        </Button>
      )}
    </section>
  );
}

// ─── Clean-up, filters and escalation ─────────────────────────────────────────

/**
 * The case's clean-up switches, applied as they are flipped. Switching one on
 * takes out what already qualifies, so when something would leave the case
 * the switch asks first and says what.
 */
function CleanupSection({
  caseId,
  caseData,
  readOnly,
  onChanged,
}: {
  caseId: string;
  caseData: CaseResponseDto;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const ui = useUiStore();
  const store = useBoardStore();
  const openTimeline = useTimelineLink();
  const rules = cleanupOf(caseData);
  const [busyKey, setBusyKey] = React.useState<CleanupKey | null>(null);
  const [confirm, setConfirm] = React.useState<{ key: CleanupKey; preview: CaseCleanupPreviewDto } | null>(null);
  const allRules = caseData.findingFilters ?? [];
  const filters = allRules.filter((f) => f.action !== "ESCALATE");
  const escalations = allRules.filter((f) => f.action === "ESCALATE");
  const escalated = caseData.escalatedCount ?? 0;
  const [clearing, setClearing] = React.useState(false);

  const apply = async (key: CleanupKey, checked: boolean) => {
    setBusyKey(key);
    try {
      const res = await api.cases.casesControllerUpdate({ id: caseId, updateCaseDto: { [key]: checked } });
      const removed = (res.cleanup?.findingsRemoved ?? 0) + (res.cleanup?.evidenceRemoved ?? 0);
      if (removed > 0) {
        toast.success(t("caseCleanup.savedWithRemovals", { count: removed }), {
          action: {
            label: t("caseBoard.timelineLink.whatChanged"),
            onClick: () => void openTimeline({ types: ["FINDINGS_AUTO_REMOVED", "EVIDENCE_AUTO_REMOVED"] }),
          },
        });
      }
      onChanged();
      store.getState().refetch();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("caseBoard.caseFile.saveError")));
    } finally {
      setBusyKey(null);
    }
  };

  const toggle = async (key: CleanupKey, checked: boolean) => {
    if (!checked) {
      await apply(key, false);
      return;
    }
    setBusyKey(key);
    let preview: CaseCleanupPreviewDto | null = null;
    try {
      preview = await fetchCleanupPreview(caseId, [key]);
    } catch {
      // Without a preview, say nothing is known: the confirmation still asks.
    }
    setBusyKey(null);
    if (preview && cleanupPreviewTotal(preview) === 0) await apply(key, true);
    else setConfirm({ key, preview: preview ?? { goneFindings: 0, resolvedFindings: 0, goneAssets: 0, findingsWithAssets: 0, sample: [] } });
  };

  const clearAll = async () => {
    setClearing(true);
    try {
      const res = await api.cases.caseCleanupControllerClearEscalations({ id: caseId, clearCaseEscalationsDto: {} });
      toast.success(t("caseEscalation.clearedAll", { count: res.cleared }));
      onChanged();
      store.getState().refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("caseEscalation.failedToClear"));
    } finally {
      setClearing(false);
    }
  };

  const enabled = CLEANUP_KEYS.filter((key) => rules[key]);

  return (
    <section className="space-y-2.5" data-testid="case-file-cleanup">
      <SectionHeading
        aside={
          enabled.length > 0 ? (
            <TimelineLinkButton
              label={t("caseBoard.timelineLink.removals")}
              onClick={() => void openTimeline({ types: ["FINDINGS_AUTO_REMOVED", "EVIDENCE_AUTO_REMOVED", "CLEANUP_SETTINGS_UPDATED"] })}
            />
          ) : null
        }
      >
        {t("caseCleanup.title")}
      </SectionHeading>
      <p className="text-xs text-muted-foreground">{t("caseCleanup.panelHint")}</p>
      <CleanupSwitches
        values={rules}
        onToggle={(key, checked) => void toggle(key, checked)}
        disabled={readOnly}
        busyKey={busyKey}
        idPrefix="case-file-cleanup"
        compact
      />

      <div className="space-y-1.5 pt-1">
        <div className="flex items-center gap-2 text-xs">
          <Filter className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 text-muted-foreground">
            {filters.length > 0 ? t("caseCleanup.filters", { count: filters.length }) : t("caseCleanup.noFilters")}
          </span>
          {filters.length > 0 && (
            <TimelineLinkButton
              label={t("caseBoard.timelineLink.history")}
              onClick={() =>
                void openTimeline({ types: ["FINDING_FILTER_ADDED", "FINDING_FILTER_UPDATED", "FINDING_FILTER_REMOVED"] })
              }
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-1.5 text-[11px]"
            onClick={() => ui.getState().openDrawer("inquiries")}
          >
            {t("caseCleanup.manageFilters")}
          </Button>
        </div>
        <div className="flex items-center gap-2 text-xs" data-testid="case-file-escalation">
          <EscalationFlag size={12} className="shrink-0" />
          <span className={cn("min-w-0 flex-1", escalated > 0 ? "font-medium text-foreground" : "text-muted-foreground")}>
            {escalated > 0 ? t("caseEscalation.summary", { count: escalated }) : t("caseEscalation.noneEscalated")}
            {" · "}
            {escalations.length > 0 ? t("caseEscalation.rules", { count: escalations.length }) : t("caseEscalation.noRules")}
          </span>
          {escalated > 0 && (
            <TimelineLinkButton
              label={t("caseBoard.timelineLink.whatChanged")}
              onClick={() => void openTimeline({ types: ["FINDINGS_ESCALATED"] })}
            />
          )}
          {escalated > 0 && !readOnly && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-1.5 text-[11px]"
              disabled={clearing}
              onClick={() => void clearAll()}
              data-testid="escalation-clear-all"
            >
              {t("caseEscalation.clearAll")}
            </Button>
          )}
        </div>
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm ? t("caseCleanup.confirmTitle", { rule: t(`caseCleanup.rules.${confirm.key}.label`) }) : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("caseCleanup.confirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          {confirm && (
            <CleanupPreviewNote preview={confirm.preview} checking={false} heading={t("caseCleanup.previewTurnOn")} />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="cleanup-confirm"
              onClick={() => {
                const key = confirm?.key;
                setConfirm(null);
                if (key) void apply(key, true);
              }}
            >
              {t("caseCleanup.confirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** A small "History" / "What changed" link into the timeline. */
export function TimelineLinkButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      data-testid="timeline-link"
    >
      <History className="size-3" aria-hidden />
      {label}
    </button>
  );
}

// ─── Conclusion and closing ───────────────────────────────────────────────────

function ConclusionSection({
  caseId,
  caseData,
  readOnly,
  onSaved,
  onClosed,
}: {
  caseId: string;
  caseData: CaseResponseDto;
  readOnly: boolean;
  onSaved: () => void;
  onClosed: () => void;
}) {
  const { t } = useTranslation();
  const closed = caseData.status === "CLOSED" || caseData.status === "ARCHIVED";
  const conclusion = useAutosave<string>({
    value: caseData.conclusion ?? "",
    isEqual: (a, b) => a === b,
    save: async (next) => {
      try {
        await api.cases.casesControllerUpdate({ id: caseId, updateCaseDto: { conclusion: next } });
      } catch (error) {
        toast.error(await extractApiErrorMessage(error, t("caseBoard.caseFile.saveError")));
        throw error;
      }
      onSaved();
    },
  });
  const [closing, setClosing] = React.useState(false);

  const close = async () => {
    setClosing(true);
    try {
      await conclusion.flush();
      await api.cases.casesControllerClose({ id: caseId, closeCaseDto: { conclusion: conclusion.draft.trim() } });
      toast.success(t("investigations.caseDetail.caseClosed"));
      onClosed();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("caseBoard.caseFile.saveError")));
    } finally {
      setClosing(false);
    }
  };

  return (
    <section className="space-y-2" data-testid="case-file-conclusion">
      <SectionHeading
        aside={closed ? <ToneBadge tone="archived">{caseData.status}</ToneBadge> : <SaveIndicator status={conclusion.status} onRetry={() => void conclusion.flush()} />}
      >
        {t("investigations.caseDetail.conclusion")}
      </SectionHeading>
      {closed || readOnly ? (
        <p className="text-sm whitespace-pre-wrap">{caseData.conclusion || t("investigations.caseDetail.noConclusion")}</p>
      ) : (
        <>
          <Textarea
            rows={6}
            value={conclusion.draft}
            placeholder={t("investigations.caseDetail.conclusionDesc")}
            onChange={(e) => conclusion.setDraft(e.target.value)}
            onBlur={() => void conclusion.flush()}
            onKeyDown={(e) => e.stopPropagation()}
            data-testid="case-file-conclusion-input"
          />
          <div className="flex flex-wrap items-center gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" disabled={conclusion.draft.trim().length === 0 || closing}>
                  {closing ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                  {t("investigations.caseDetail.closeCase")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("investigations.caseDetail.closeCaseTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>{t("investigations.caseDetail.closeCaseDesc")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void close()}>{t("investigations.caseDetail.closeCase")}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            {conclusion.draft.trim().length === 0 && (
              <span className="text-xs text-muted-foreground">{t("investigations.caseDetail.conclusionRequired")}</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
