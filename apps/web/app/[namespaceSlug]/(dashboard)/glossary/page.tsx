"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  Bot,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
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
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import {
  bulkUpdateGlossaryTerms,
  GLOSSARY_ENTITY_TYPES,
  listGlossaryTerms,
  removeGlossaryTerm,
  upsertGlossaryTerm,
  verifyGlossaryTerm,
  type GlossaryBulkFilters,
  type GlossaryEntityType,
  type GlossaryTermDto,
} from "@/lib/glossary-api";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL = "ALL" as const;
const PAGE_SIZE_OPTIONS = [25, 50, 100];
const DEFAULT_PAGE_SIZE = PAGE_SIZE_OPTIONS[0] as number;

type FormState = {
  term: string;
  aliasesInput: string;
  entityType: GlossaryEntityType;
  notes: string;
};

const EMPTY_FORM: FormState = {
  term: "",
  aliasesInput: "",
  entityType: "TERM",
  notes: "",
};

const CHECKBOX_CLASS =
  "border-2 border-foreground/25 rounded-[2px] data-[state=checked]:bg-accent data-[state=checked]:border-accent data-[state=checked]:text-accent-foreground data-[state=indeterminate]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:text-accent-foreground";

type BulkAction = "verify" | "unverify" | "entityType";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPageItems(current: number, total: number) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = new Set<number>([1, current, total]);
  if (current > 2) pages.add(current - 1);
  if (current < total - 1) pages.add(current + 1);
  return Array.from(pages).sort((a, b) => a - b);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function GlossaryWorkspace({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { t } = useTranslation();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [entityTypeFilter, setEntityTypeFilter] = useState<
    GlossaryEntityType | typeof ALL
  >(ALL);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);
  const [refreshCount, setRefreshCount] = useState(0);

  const [data, setData] = useState<{
    terms: GlossaryTermDto[];
    total: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTerm, setEditingTerm] = useState<GlossaryTermDto | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [pendingAction, setPendingAction] = useState<{
    id: string;
    action: "verify" | "delete";
  } | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [isAllSelected, setIsAllSelected] = useState(false);
  const [bulkEntityType, setBulkEntityType] =
    useState<GlossaryEntityType>("TERM");
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);

  // ── Debounce search input ────────────────────────────────────────────────

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ── Reset page on filter change ──────────────────────────────────────────

  useEffect(() => {
    setPage(1);
  }, [search, entityTypeFilter, pageSize]);

  // ── Fetch glossary terms ─────────────────────────────────────────────────

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const skip = (page - 1) * pageSize;
        const result = await listGlossaryTerms({
          query: search.trim() || undefined,
          entityType: entityTypeFilter !== ALL ? entityTypeFilter : undefined,
          take: pageSize,
          skip,
        });
        if (!active) return;
        setData(result);
      } catch (loadError) {
        if (!active) return;
        console.error("Failed to load glossary terms:", loadError);
        setError(
          await extractApiErrorMessage(
            loadError,
            "Failed to load glossary terms",
          ),
        );
        setData({ terms: [], total: 0 });
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [search, entityTypeFilter, page, pageSize, refreshCount]);

  // ── Derived ──────────────────────────────────────────────────────────────

  const items = data?.terms ?? [];
  const total = data?.total ?? 0;
  const hasRows = items.length > 0;
  const showInitialLoading = isLoading && data === null;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const clampedPage = Math.min(page, totalPages);
  const canPrev = clampedPage > 1;
  const canNext = clampedPage < totalPages;
  const pageItems = useMemo(
    () => getPageItems(clampedPage, totalPages),
    [clampedPage, totalPages],
  );

  // ── Selection ────────────────────────────────────────────────────────────

  const currentFilters = useMemo<GlossaryBulkFilters>(
    () => ({
      query: search.trim() || undefined,
      entityType: entityTypeFilter !== ALL ? entityTypeFilter : undefined,
    }),
    [search, entityTypeFilter],
  );

  // A filter change invalidates both the id set and the "all matching" claim.
  useEffect(() => {
    setSelectedIds(new Set<string>());
    setIsAllSelected(false);
  }, [search, entityTypeFilter]);

  const selectionCount = isAllSelected ? total : selectedIds.size;
  const pageSelectedCount = isAllSelected
    ? items.length
    : items.filter((term) => selectedIds.has(term.id)).length;
  const headerChecked =
    isAllSelected || (items.length > 0 && pageSelectedCount === items.length);
  const headerIndeterminate =
    !isAllSelected && pageSelectedCount > 0 && !headerChecked;

  function clearSelection() {
    setIsAllSelected(false);
    setSelectedIds(new Set<string>());
  }

  function toggleRow(term: GlossaryTermDto) {
    setIsAllSelected(false);
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(term.id)) next.delete(term.id);
      else next.add(term.id);
      return next;
    });
  }

  function handleHeaderCheckbox() {
    if (headerChecked || headerIndeterminate) clearSelection();
    else {
      setIsAllSelected(true);
      setSelectedIds(new Set<string>());
    }
  }

  // ── Dialog helpers ───────────────────────────────────────────────────────

  function openAddDialog() {
    setEditingTerm(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEditDialog(term: GlossaryTermDto) {
    setEditingTerm(term);
    setForm({
      term: term.term,
      aliasesInput: [...term.aliases, ...term.proposedAliases].join(", "),
      entityType: term.entityType,
      notes: term.notes ?? "",
    });
    setFormError(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    if (isSaving) return;
    setDialogOpen(false);
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  async function handleSave() {
    const trimmedTerm = form.term.trim();
    if (!trimmedTerm) {
      setFormError(t("glossary.termRequired"));
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      const aliases = Array.from(
        new Set(
          form.aliasesInput
            .split(",")
            .map((alias) => alias.trim())
            .filter(Boolean),
        ),
      );
      await upsertGlossaryTerm({
        upsertGlossaryTermDto: {
          id: editingTerm?.id,
          term: trimmedTerm,
          aliases,
          entityType: form.entityType,
          notes: form.notes.trim() || undefined,
        },
      });
      toast.success(t("glossary.saved"));
      setDialogOpen(false);
      setRefreshCount((n) => n + 1);
    } catch (saveError) {
      console.error("Failed to save glossary term:", saveError);
      setFormError(
        await extractApiErrorMessage(saveError, t("glossary.saveFailed")),
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleVerify(term: GlossaryTermDto) {
    setPendingAction({ id: term.id, action: "verify" });
    try {
      await verifyGlossaryTerm({ id: term.id, verifyGlossaryTermDto: {} });
      toast.success(t("glossary.verifySuccess"));
      setRefreshCount((n) => n + 1);
    } catch (verifyError) {
      console.error("Failed to verify glossary term:", verifyError);
      toast.error(
        await extractApiErrorMessage(verifyError, t("glossary.verifyFailed")),
      );
    } finally {
      setPendingAction((prev) => (prev?.id === term.id ? null : prev));
    }
  }

  async function handleBulkAction(action: BulkAction) {
    if (selectionCount === 0) return;
    setBulkAction(action);
    try {
      const response = await bulkUpdateGlossaryTerms({
        bulkUpdateGlossaryTermsDto: {
          ...(isAllSelected
            ? { filters: currentFilters }
            : { ids: Array.from(selectedIds) }),
          ...(action === "verify" ? { verified: true } : {}),
          ...(action === "unverify" ? { verified: false } : {}),
          ...(action === "entityType" ? { entityType: bulkEntityType } : {}),
        },
      });
      toast.success(
        t("glossary.bulk.applied", {
          count: response.updatedCount.toLocaleString(),
        }),
      );
      clearSelection();
      setRefreshCount((n) => n + 1);
    } catch (bulkError) {
      console.error("Failed to bulk update glossary terms:", bulkError);
      toast.error(
        await extractApiErrorMessage(bulkError, t("glossary.bulk.failed")),
      );
    } finally {
      setBulkAction(null);
    }
  }

  async function handleDelete(term: GlossaryTermDto) {
    setPendingAction({ id: term.id, action: "delete" });
    try {
      await removeGlossaryTerm({ id: term.id });
      toast.success(t("glossary.deleted"));
      setRefreshCount((n) => n + 1);
    } catch (deleteError) {
      console.error("Failed to delete glossary term:", deleteError);
      toast.error(
        await extractApiErrorMessage(deleteError, t("glossary.deleteFailed")),
      );
    } finally {
      setPendingAction((prev) => (prev?.id === term.id ? null : prev));
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        {!embedded ? (
          <div>
            <div className="flex items-center gap-3">
              <BookOpen className="size-7" />
              <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
                {t("glossary.title")}
              </h1>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("glossary.description")}
          </p>
        )}
        <Button onClick={openAddDialog}>
          <Plus className="mr-2 h-4 w-4" />
          {t("glossary.addTerm")}
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-[1.6]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("glossary.searchPlaceholder")}
            className="h-9 pl-9 border-2 border-border rounded-[4px]"
          />
        </div>

        <Select
          value={entityTypeFilter}
          onValueChange={(value) =>
            setEntityTypeFilter(value as GlossaryEntityType | typeof ALL)
          }
        >
          <SelectTrigger className="h-9 w-[200px] border-2 border-border rounded-[4px]">
            <SelectValue placeholder={t("glossary.entityTypeFilter")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("glossary.allTypes")}</SelectItem>
            {GLOSSARY_ENTITY_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`glossary.entityTypes.${type}` as TranslationKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectionCount > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[4px] border-2 border-accent/30 bg-background px-4 py-2.5">
          <span className="font-mono text-xs text-accent">
            {isAllSelected
              ? t("glossary.bulk.allSelected", {
                  count: selectionCount.toLocaleString(),
                })
              : selectionCount === 1
                ? t("glossary.bulk.selected", {
                    count: selectionCount.toLocaleString(),
                  })
                : t("glossary.bulk.selectedPlural", {
                    count: selectionCount.toLocaleString(),
                  })}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select
              value={bulkEntityType}
              onValueChange={(value) =>
                setBulkEntityType(value as GlossaryEntityType)
              }
            >
              <SelectTrigger className="h-8 w-[170px] rounded-[4px] border-2 border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GLOSSARY_ENTITY_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`glossary.entityTypes.${type}` as TranslationKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkAction !== null}
              onClick={() => handleBulkAction("entityType")}
              className="h-8 rounded-[4px] border-2 border-border font-mono text-xs font-bold uppercase tracking-[0.08em]"
            >
              {bulkAction === "entityType" && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              {t("glossary.bulk.changeType")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkAction !== null}
              onClick={() => handleBulkAction("unverify")}
              className="h-8 rounded-[4px] border-2 border-border font-mono text-xs font-bold uppercase tracking-[0.08em]"
            >
              {bulkAction === "unverify" && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              {t("glossary.bulk.unverify")}
            </Button>
            <Button
              size="sm"
              disabled={bulkAction !== null}
              onClick={() => handleBulkAction("verify")}
              className="h-8 rounded-[4px] border-0 bg-accent font-mono text-xs font-bold uppercase tracking-[0.08em] text-accent-foreground hover:bg-accent/90"
            >
              {bulkAction === "verify" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5" />
              )}
              {t("glossary.bulk.verify")}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="relative min-h-[360px]">
        {showInitialLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="ml-2 text-sm">{t("glossary.loading")}</span>
          </div>
        ) : !hasRows ? (
          <EmptyState
            icon={BookOpen}
            title={t("glossary.noTerms")}
            description={t("glossary.noTermsHint")}
            action={{ label: t("glossary.addTerm"), onClick: openAddDialog }}
          />
        ) : (
          <div className="max-h-[70vh] overflow-auto rounded-[4px] bg-white dark:bg-card">
            <Table>
              <TableHeader className="sticky top-0 z-20 bg-white/95 dark:bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
                <TableRow>
                  <TableHead className="w-10 bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="flex items-center justify-center">
                          <Checkbox
                            checked={
                              headerIndeterminate
                                ? "indeterminate"
                                : headerChecked
                            }
                            onCheckedChange={handleHeaderCheckbox}
                            aria-label={t("glossary.bulk.selectAllAria")}
                            className={CHECKBOX_CLASS}
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {headerChecked || headerIndeterminate
                          ? t("glossary.bulk.deselectAll")
                          : t("glossary.bulk.selectAll", {
                              count: total.toLocaleString(),
                            })}
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default px-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("glossary.columns.term")}
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default px-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("glossary.columns.aliases")}
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default px-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("glossary.columns.type")}
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default px-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("glossary.columns.verification")}
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default px-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("glossary.columns.notes")}
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 text-right dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("glossary.columns.actions")}
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((term) => {
                  const isUnverified = !term.verified;
                  const isAgentProposal = term.origin === "AGENT";
                  const isRowActionPending = pendingAction?.id === term.id;
                  const isVerifying =
                    isRowActionPending && pendingAction?.action === "verify";
                  const isDeleting =
                    isRowActionPending && pendingAction?.action === "delete";

                  return (
                    <TableRow
                      key={term.id}
                      className={
                        selectedIds.has(term.id)
                          ? "align-top bg-accent/5"
                          : "align-top"
                      }
                    >
                      <TableCell className="py-3">
                        <div className="flex items-center justify-center">
                          <Checkbox
                            checked={isAllSelected || selectedIds.has(term.id)}
                            onCheckedChange={() => toggleRow(term)}
                            aria-label={t("glossary.bulk.selectTermAria", {
                              term: term.term,
                            })}
                            className={CHECKBOX_CLASS}
                          />
                        </div>
                      </TableCell>
                      {/* Term */}
                      <TableCell className="max-w-[220px] py-3">
                        <span className="truncate text-sm font-semibold">
                          {term.term}
                        </span>
                      </TableCell>

                      {/* Aliases */}
                      <TableCell className="max-w-[260px] py-3">
                        {term.aliases.length > 0 ||
                        term.proposedAliases.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {term.aliases.map((alias) => (
                              <Badge
                                key={alias}
                                variant="outline"
                                className="rounded-[4px] text-[11px]"
                              >
                                {alias}
                              </Badge>
                            ))}
                            {term.proposedAliases.map((alias) => (
                              <Badge
                                key={`proposed-${alias}`}
                                variant="outline"
                                className="rounded-[4px] border-amber-500/30 bg-amber-50 text-[11px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                              >
                                {alias} · {t("glossary.suggested")}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {t("glossary.noValue")}
                          </span>
                        )}
                      </TableCell>

                      {/* Type */}
                      <TableCell className="py-3">
                        <Badge variant="outline" className="rounded-[4px]">
                          {t(
                            `glossary.entityTypes.${term.entityType}` as TranslationKey,
                          )}
                        </Badge>
                      </TableCell>

                      {/* Origin / verification */}
                      <TableCell className="py-3">
                        {isUnverified ? (
                          <Badge
                            variant="outline"
                            className="gap-1 rounded-[4px] border-amber-500/30 bg-amber-50 text-[11px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                          >
                            {isAgentProposal && <Bot className="h-3 w-3" />}
                            {isAgentProposal
                              ? t("glossary.unverifiedAgent")
                              : t("glossary.unverified")}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="rounded-[4px] text-[11px] text-muted-foreground"
                          >
                            {t("glossary.verified")}
                          </Badge>
                        )}
                      </TableCell>

                      {/* Notes */}
                      <TableCell className="max-w-[240px] py-3">
                        {term.notes ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <p className="cursor-default truncate text-xs text-muted-foreground">
                                {term.notes}
                              </p>
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              sideOffset={6}
                              className="max-w-[300px] break-words"
                            >
                              {term.notes}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {t("glossary.noValue")}
                          </span>
                        )}
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="py-3">
                        <div className="flex items-center justify-end gap-2">
                          {isUnverified && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 rounded-[4px] border-2 border-border"
                                  disabled={isVerifying}
                                  onClick={() => handleVerify(term)}
                                >
                                  {isVerifying ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <ShieldCheck className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {t("glossary.verify")}
                              </TooltipContent>
                            </Tooltip>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-[4px] border-2 border-border"
                            onClick={() => openEditDialog(term)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-[4px] border-2 border-destructive text-destructive hover:bg-destructive/10"
                                disabled={isDeleting}
                              >
                                {isDeleting ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="rounded-[6px] border-2 border-border">
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  {t("glossary.deleteConfirmTitle")}
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t("glossary.deleteConfirmDescription")}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel disabled={isDeleting}>
                                  {t("common.cancel")}
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  variant="destructive"
                                  disabled={isDeleting}
                                  onClick={() => handleDelete(term)}
                                  className="rounded-[4px] border-2 border-border"
                                >
                                  {isDeleting
                                    ? t("common.deleting")
                                    : t("glossary.delete")}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {isLoading && hasRows && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[4px] bg-background/45 backdrop-blur-[1px]">
            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("glossary.updating")}
            </div>
          </div>
        )}
      </div>

      {/* Footer: page size + pagination */}
      {hasRows && (
        <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t("common.rowsPerPage")}
            </span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => setPageSize(Number(value))}
            >
              <SelectTrigger className="h-8 w-[130px] border-2 border-border rounded-[4px]">
                <SelectValue placeholder={t("common.rowsPerPage")} />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {t("common.rows", { size })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {`${((clampedPage - 1) * pageSize + 1).toLocaleString()}–${Math.min(clampedPage * pageSize, total).toLocaleString()} ${t("common.of")} ${total.toLocaleString()}`}
            </span>
          </div>

          {totalPages > 1 && (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    label={t("common.pagination.previous")}
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      if (canPrev) setPage(clampedPage - 1);
                    }}
                    className={
                      !canPrev ? "pointer-events-none opacity-50" : undefined
                    }
                  />
                </PaginationItem>
                {pageItems.map((pageNumber, index) => {
                  const prev = pageItems[index - 1];
                  const showEllipsis = prev && pageNumber - prev > 1;
                  return (
                    <Fragment key={`page-group-${pageNumber}`}>
                      {showEllipsis && (
                        <PaginationItem>
                          <PaginationEllipsis
                            label={t("common.pagination.morePages")}
                          />
                        </PaginationItem>
                      )}
                      <PaginationItem>
                        <PaginationLink
                          href="#"
                          isActive={pageNumber === clampedPage}
                          onClick={(e) => {
                            e.preventDefault();
                            setPage(pageNumber);
                          }}
                        >
                          {pageNumber}
                        </PaginationLink>
                      </PaginationItem>
                    </Fragment>
                  );
                })}
                <PaginationItem>
                  <PaginationNext
                    label={t("common.pagination.next")}
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      if (canNext) setPage(clampedPage + 1);
                    }}
                    className={
                      !canNext ? "pointer-events-none opacity-50" : undefined
                    }
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}

      {/* Add / edit dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingTerm ? t("glossary.editTerm") : t("glossary.addTerm")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("glossary.form.termLabel")}</Label>
              <Input
                value={form.term}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, term: e.target.value }))
                }
                placeholder={t("glossary.form.termPlaceholder")}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("glossary.form.aliasesLabel")}</Label>
              <Input
                value={form.aliasesInput}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    aliasesInput: e.target.value,
                  }))
                }
                placeholder={t("glossary.form.aliasesPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">
                {t("glossary.form.aliasesHelp")}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("glossary.form.entityTypeLabel")}</Label>
              <Select
                value={form.entityType}
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    entityType: value as GlossaryEntityType,
                  }))
                }
              >
                <SelectTrigger className="w-full border-2 border-border rounded-[4px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GLOSSARY_ENTITY_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`glossary.entityTypes.${type}` as TranslationKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("glossary.form.notesLabel")}</Label>
              <Textarea
                value={form.notes}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, notes: e.target.value }))
                }
                placeholder={t("glossary.form.notesPlaceholder")}
                rows={3}
              />
            </div>
            {formError && (
              <p className="text-xs text-destructive">{formError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isSaving}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isSaving ? t("glossary.saving") : t("glossary.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function GlossaryPage() {
  return <GlossaryWorkspace />;
}
