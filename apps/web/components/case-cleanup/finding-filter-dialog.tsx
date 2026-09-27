"use client";

import * as React from "react";
import { Filter, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { EscalationFlag } from "@workspace/case-board/components/finding-node";
import { toast } from "sonner";
import {
  api,
  type CaseFindingFilterDto,
  type CaseFindingFiltersChangeResponseDto,
  type CaseFindingFiltersPreviewDto,
  type CaseFindingTypeOptionDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group";
import { cn } from "@workspace/ui/lib/utils";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import { useTranslation } from "@/hooks/use-translation";

export type FilterKind = "FINDING_TYPE" | "VALUE_PATTERN";

/** What a rule does: filter matching findings out, or escalate them. */
export type RuleAction = "EXCLUDE" | "ESCALATE";

/** What opens the dialog, and what it starts out filled with. */
export interface FilterDialogRequest {
  /** Filter out (default) or escalate. */
  action?: RuleAction;
  /** A linked inquiry to scope to; omitted or null for the whole case. */
  inquiryId?: string | null;
  kind?: FilterKind;
  types?: string[];
  pattern?: string;
  description?: string;
  /** Edit this (value) filter instead of adding new ones. */
  filter?: CaseFindingFilterDto;
}

const CASE_SCOPE = "__case__";
const PREVIEW_DEBOUNCE_MS = 300;

interface PatternRow {
  key: number;
  pattern: string;
  description: string;
}

/**
 * Add (or edit) case finding rules: filters and escalations, by type, picked
 * from what the case holds and its watches answer, or by value, as regular
 * expressions with a reason. Before anything is saved it says how many
 * findings of the case match — to be detached by a filter, or escalated — and
 * the number is on the button too, so a rule never does more than the
 * investigator saw.
 */
export function FindingFilterDialog({
  caseId,
  watches,
  filters,
  request,
  onClose,
  onApplied,
  clientId,
}: {
  caseId: string;
  /** The case's linked inquiries, for the scope picker. */
  watches: Array<{ id: string; title: string }>;
  /** The case's filters, so types filtered already are marked. */
  filters: CaseFindingFilterDto[];
  /** Null while closed. */
  request: FilterDialogRequest | null;
  onClose: () => void;
  onApplied: (result: CaseFindingFiltersChangeResponseDto) => void;
  /** The board tab asking, so it ignores the echo of its own change. */
  clientId?: string;
}) {
  const { t } = useTranslation();
  const open = request !== null;
  const editing = request?.filter ?? null;
  const action: RuleAction = (editing?.action as RuleAction | undefined) ?? request?.action ?? "EXCLUDE";
  const escalate = action === "ESCALATE";

  const [scope, setScope] = React.useState(CASE_SCOPE);
  const [kind, setKind] = React.useState<FilterKind>("FINDING_TYPE");
  const [types, setTypes] = React.useState<Set<string>>(new Set());
  const [rows, setRows] = React.useState<PatternRow[]>([]);
  const [search, setSearch] = React.useState("");
  const [options, setOptions] = React.useState<CaseFindingTypeOptionDto[] | null>(null);
  const [approximate, setApproximate] = React.useState(false);
  const [preview, setPreview] = React.useState<CaseFindingFiltersPreviewDto | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const nextKey = React.useRef(1);

  // A new request starts the dialog over.
  React.useEffect(() => {
    if (!request) return;
    const f = request.filter;
    setScope(f ? (f.inquiryId ?? CASE_SCOPE) : (request.inquiryId ?? CASE_SCOPE));
    setKind(f ? (f.kind as FilterKind) : (request.kind ?? "FINDING_TYPE"));
    setTypes(new Set(request.types ?? []));
    setRows([
      {
        key: 0,
        pattern: f?.pattern ?? request.pattern ?? "",
        description: f?.description ?? request.description ?? "",
      },
    ]);
    setSearch("");
    setPreview(null);
    setSaving(false);
  }, [request]);

  const inquiryId = scope === CASE_SCOPE ? null : scope;

  React.useEffect(() => {
    if (!open || kind !== "FINDING_TYPE" || editing) return;
    let cancelled = false;
    setOptions(null);
    api.cases
      .caseCleanupControllerFilterOptions({ id: caseId, inquiryId: inquiryId ?? undefined })
      .then((res) => {
        if (cancelled) return;
        setOptions(res.types);
        setApproximate(res.approximate);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, kind, caseId, inquiryId, editing]);

  // Rows with a pattern, in order: the preview answers per rule in this order.
  const patternRows = React.useMemo(() => rows.filter((r) => r.pattern.length > 0), [rows]);
  const rules = React.useMemo(
    () =>
      kind === "FINDING_TYPE"
        ? [...types].map((pattern) => ({ kind, pattern }))
        : patternRows.map((r) => ({
            kind,
            pattern: r.pattern,
            description: r.description.trim() || undefined,
          })),
    [kind, types, patternRows],
  );
  const rulesKey = JSON.stringify([inquiryId, rules.map((r) => [r.kind, r.pattern])]);

  React.useEffect(() => {
    if (!open) return;
    if (rules.length === 0) {
      setPreview(null);
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const timer = window.setTimeout(() => {
      api.cases
        .caseCleanupControllerPreviewFilters({
          id: caseId,
          previewCaseFindingFiltersDto: {
            action,
            inquiryId,
            rules: rules.map(({ kind: k, pattern }) => ({ kind: k, pattern })),
          },
        })
        .then((res) => {
          if (!cancelled) setPreview(res);
        })
        .catch(() => {
          if (!cancelled) setPreview(null);
        })
        .finally(() => {
          if (!cancelled) setChecking(false);
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // rulesKey stands for rules/inquiryId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, caseId, rulesKey, action]);

  // Types a filter in this scope already covers (a case-wide one covers every scope).
  const covered = React.useMemo(
    () =>
      new Set(
        filters
          .filter(
            (f) =>
              f.kind === "FINDING_TYPE" &&
              f.action === action &&
              (f.inquiryId == null || f.inquiryId === inquiryId),
          )
          .map((f) => f.pattern),
      ),
    [filters, inquiryId, action],
  );

  const visibleOptions = React.useMemo(() => {
    const all = options ?? [];
    // A type the request named but the options do not list (it was just
    // detached elsewhere, or the watch no longer answers it) is still shown.
    const extra = [...types]
      .filter((type) => !all.some((o) => o.findingType === type))
      .map(
        (findingType): CaseFindingTypeOptionDto => ({
          findingType,
          inCase: 0,
          answers: 0,
        }),
      );
    const term = search.trim().toLowerCase();
    return [...extra, ...all].filter(
      (o) =>
        !term ||
        o.findingType.toLowerCase().includes(term) ||
        (o.detectorName ?? "").toLowerCase().includes(term),
    );
  }, [options, types, search]);

  const problems = kind === "VALUE_PATTERN" ? (preview?.problems ?? []) : [];
  const hasProblem = problems.some((p) => p !== "");
  const matched = preview?.matched ?? 0;
  const canSubmit =
    !saving && rules.length > 0 && !hasProblem && !(editing && rows[0]?.pattern.length === 0);

  const toggleType = (type: string, on: boolean) =>
    setTypes((prev) => {
      const next = new Set(prev);
      if (on) next.add(type);
      else next.delete(type);
      return next;
    });

  const setRow = (key: number, patch: Partial<PatternRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const submit = async () => {
    setSaving(true);
    try {
      if (editing) {
        const res = await api.cases.caseCleanupControllerUpdateFilter({
          id: caseId,
          filterId: editing.id,
          updateCaseFindingFilterDto: {
            pattern: rows[0]?.pattern ?? editing.pattern,
            description: rows[0]?.description.trim() || null,
            clientId,
          },
        });
        toast.success(
          escalate
            ? res.escalated > 0
              ? t("caseEscalation.dialog.updated", { count: res.escalated })
              : t("caseEscalation.dialog.updatedNone")
            : res.detached > 0
              ? t("caseFilters.dialog.updated", { count: res.detached })
              : t("caseFilters.dialog.updatedNone"),
        );
        onApplied(res);
      } else {
        const res = await api.cases.caseCleanupControllerAddFilters({
          id: caseId,
          addCaseFindingFiltersDto: { action, inquiryId, rules, clientId },
        });
        toast.success(
          escalate
            ? res.escalated > 0
              ? t("caseEscalation.dialog.applied", { count: res.escalated })
              : t("caseEscalation.dialog.appliedNone")
            : res.detached > 0
              ? t("caseFilters.dialog.applied", { count: res.detached })
              : t("caseFilters.dialog.appliedNone"),
        );
        onApplied(res);
      }
      onClose();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("caseFilters.dialog.failed")));
      setSaving(false);
    }
  };

  const submitLabel = escalate
    ? editing
      ? matched > 0
        ? t("caseEscalation.dialog.saveCount", { count: matched })
        : t("caseEscalation.dialog.save")
      : matched > 0
        ? t("caseEscalation.dialog.submitCount", { count: matched })
        : t("caseEscalation.dialog.submit")
    : editing
      ? matched > 0
        ? t("caseFilters.dialog.saveDetach", { count: matched })
        : t("caseFilters.dialog.save")
      : matched > 0
        ? t("caseFilters.dialog.submitDetach", { count: matched })
        : t("caseFilters.dialog.submit");

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="flex max-h-[min(720px,90dvh)] flex-col gap-4 rounded-[6px] border-2 border-border sm:max-w-xl"
        data-testid="finding-filter-dialog"
        // The board's shortcuts must not see keys typed into the fields.
        onKeyDown={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {escalate ? (
              <EscalationFlag size={16} />
            ) : (
              <Filter className="size-4 text-accent-ink" aria-hidden />
            )}
            {escalate
              ? editing
                ? t("caseEscalation.dialog.editTitle")
                : t("caseEscalation.dialog.title")
              : editing
                ? t("caseFilters.dialog.editTitle")
                : t("caseFilters.dialog.title")}
          </DialogTitle>
          <DialogDescription>
            {escalate ? t("caseEscalation.dialog.description") : t("caseFilters.dialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="font-mono text-[10px] uppercase tracking-[0.12em]">
                {t("caseFilters.dialog.scope")}
              </Label>
              <Select value={scope} onValueChange={setScope} disabled={!!editing}>
                <SelectTrigger className="h-9 w-full rounded-[4px] border-2 border-border" data-testid="filter-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CASE_SCOPE}>{t("caseFilters.dialog.scopeCase")}</SelectItem>
                  {watches.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {t("caseFilters.dialog.scopeWatch", { title: w.title })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="font-mono text-[10px] uppercase tracking-[0.12em]">
                {t("caseFilters.dialog.by")}
              </Label>
              <ToggleGroup
                type="single"
                variant="outline"
                value={kind}
                onValueChange={(value) => value && setKind(value as FilterKind)}
                disabled={!!editing}
                className="h-9 w-full"
              >
                <ToggleGroupItem value="FINDING_TYPE" className="flex-1 text-xs" data-testid="filter-kind-type">
                  {t("caseFilters.dialog.byType")}
                </ToggleGroupItem>
                <ToggleGroupItem value="VALUE_PATTERN" className="flex-1 text-xs" data-testid="filter-kind-value">
                  {t("caseFilters.dialog.byValue")}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>

          {kind === "FINDING_TYPE" ? (
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-muted-foreground text-xs">{t("caseFilters.dialog.typesHint")}</p>
                {types.size > 0 && (
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-accent-ink">
                    {t("caseFilters.dialog.selected", { count: types.size })}
                  </span>
                )}
              </div>
              <div className="rounded-[4px] border-2 border-border">
                <div className="flex items-center gap-2 border-b border-border px-2">
                  <Search className="size-3.5 text-muted-foreground" aria-hidden />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("caseFilters.dialog.typesSearch")}
                    className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none"
                    data-testid="filter-type-search"
                  />
                </div>
                <ul className="max-h-56 overflow-y-auto py-1" role="listbox" aria-multiselectable>
                  {options === null ? (
                    <li className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" /> {t("caseFilters.dialog.typesLoading")}
                    </li>
                  ) : visibleOptions.length === 0 ? (
                    <li className="px-3 py-2 text-xs text-muted-foreground">{t("caseFilters.dialog.typesEmpty")}</li>
                  ) : (
                    visibleOptions.map((o) => {
                      const already = covered.has(o.findingType);
                      const checked = types.has(o.findingType);
                      return (
                        <li key={o.findingType}>
                          <label
                            className={cn(
                              "flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-muted",
                              already && "cursor-default opacity-60 hover:bg-transparent",
                            )}
                          >
                            <Checkbox
                              checked={checked || already}
                              disabled={already}
                              onCheckedChange={(on) => toggleType(o.findingType, on === true)}
                              aria-label={o.findingType}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-mono text-xs">{o.findingType}</span>
                              {o.detectorName && o.detectorName !== o.findingType && (
                                <span className="block truncate text-[11px] text-muted-foreground">{o.detectorName}</span>
                              )}
                            </span>
                            <span className="shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                              {already ? (
                                escalate ? t("caseEscalation.dialog.alreadyRule") : t("caseFilters.dialog.alreadyFiltered")
                              ) : (
                                <>
                                  {o.inCase > 0 && (
                                    <span className="font-medium text-foreground">
                                      {t("caseFilters.dialog.inCase", { count: o.inCase.toLocaleString() })}
                                    </span>
                                  )}
                                  {o.inCase > 0 && o.answers > 0 && " · "}
                                  {o.answers > 0 && t("caseFilters.dialog.answers", { count: o.answers.toLocaleString() })}
                                </>
                              )}
                            </span>
                          </label>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>
              {approximate && <p className="text-[11px] text-muted-foreground">{t("caseFilters.dialog.approximate")}</p>}
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((row) => {
                const index = patternRows.findIndex((r) => r.key === row.key);
                const problem = index >= 0 ? problems[index] : "";
                const count = index >= 0 && preview && !problem ? preview.perRule[index] : null;
                return (
                  <div key={row.key} className="space-y-1">
                    <div className="flex items-start gap-2">
                      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1.1fr_1fr]">
                        <Input
                          value={row.pattern}
                          onChange={(e) => setRow(row.key, { pattern: e.target.value })}
                          placeholder={t("caseFilters.dialog.patternPlaceholder")}
                          className={cn("h-9 rounded-[4px] border-2 font-mono text-xs", problem && "border-destructive")}
                          aria-invalid={!!problem}
                          spellCheck={false}
                          data-testid="filter-pattern"
                        />
                        <Input
                          value={row.description}
                          onChange={(e) => setRow(row.key, { description: e.target.value })}
                          placeholder={t("caseFilters.dialog.descriptionPlaceholder")}
                          className="h-9 rounded-[4px] border-2 text-xs"
                          data-testid="filter-description"
                        />
                      </div>
                      {!editing && rows.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-9 shrink-0 text-muted-foreground"
                          aria-label={t("caseFilters.dialog.removePattern")}
                          title={t("caseFilters.dialog.removePattern")}
                          onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                    {problem ? (
                      <p className="text-[11px] text-destructive">{problem}</p>
                    ) : count !== null && count !== undefined ? (
                      <p className="text-[11px] text-muted-foreground">
                        {t("caseFilters.dialog.ruleMatches", { count })}
                      </p>
                    ) : null}
                  </div>
                );
              })}
              {!editing && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() =>
                    setRows((prev) => [...prev, { key: nextKey.current++, pattern: "", description: "" }])
                  }
                >
                  <Plus className="size-3" /> {t("caseFilters.dialog.addPattern")}
                </Button>
              )}
              <p className="text-[11px] text-muted-foreground">{t("caseFilters.dialog.patternHint")}</p>
            </div>
          )}

          {rules.length > 0 && (
            <div
              role="status"
              data-testid="filter-preview"
              className={cn(
                "rounded-[4px] border-2 p-3 text-sm",
                matched === 0
                  ? "border-border bg-muted/40 text-muted-foreground"
                  : escalate
                    ? "border-escalation/40 bg-escalation-soft text-foreground"
                    : "border-amber-600/35 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-200",
              )}
            >
              {checking && !preview ? (
                <span className="inline-flex items-center gap-2 text-xs">
                  <Loader2 className="size-3 animate-spin" /> {t("caseFilters.dialog.checking")}
                </span>
              ) : matched > 0 && preview ? (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-2 font-medium">
                    {escalate && <EscalationFlag size={13} className="shrink-0" />}
                    {escalate
                      ? t("caseEscalation.dialog.previewSome", { count: matched })
                      : t("caseFilters.dialog.previewSome", { count: matched })}
                  </p>
                  <ul className="space-y-0.5 font-mono text-[11px] opacity-80">
                    {preview.sample.map((item, index) => (
                      <li key={index} className="truncate">
                        {item.label}
                        {item.value ? `: ${item.value}` : ""}
                        {item.assetLabel ? ` · ${item.assetLabel}` : ""}
                      </li>
                    ))}
                  </ul>
                  {matched > preview.sample.length && (
                    <p className="text-[11px] opacity-80">
                      {t("caseFilters.dialog.previewMore", { count: matched - preview.sample.length })}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs">
                  {escalate ? t("caseEscalation.dialog.previewNone") : t("caseFilters.dialog.previewNone")}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={!canSubmit}
            variant={!escalate && matched > 0 ? "destructive" : "default"}
            className={cn(
              escalate &&
                "border-escalation bg-escalation text-escalation-foreground hover:bg-escalation/90",
            )}
            data-testid="filter-submit"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : escalate ? (
              <span className="text-[11px] leading-none" aria-hidden>
                ▲
              </span>
            ) : (
              <Filter className="size-3.5" />
            )}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
