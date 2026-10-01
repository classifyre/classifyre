"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  BookOpen,
  Bot,
  Check,
  Loader2,
  Pencil,
  Search,
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
  EmptyState,
  Input,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import {
  approveTerm,
  bulkUpdateTerms,
  deleteTerm,
  listSchemes,
  listTerms,
  semanticErrorMessage,
  type EntityType,
  type Scheme,
  type Term,
  type TermKind,
  type TermStatus,
} from "@/lib/semantic-api";
import {
  MICRO_LABEL,
  SchemeChip,
  TermLink,
  TermStatusBadge,
} from "./glossary-ui";

const ALL = "ALL";
const NO_SCHEME = "__none__";
const PAGE_SIZE = 50;
const STATUSES: TermStatus[] = ["APPROVED", "DRAFT", "DEPRECATED"];
const ENTITY_TYPES: EntityType[] = [
  "PERSON",
  "ORGANIZATION",
  "LOCATION",
  "REFERENCE",
  "TERM",
  "OTHER",
];

const CHECKBOX_CLASS =
  "border-2 border-foreground/25 rounded-[2px] data-[state=checked]:bg-accent data-[state=checked]:border-accent data-[state=checked]:text-accent-foreground data-[state=indeterminate]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:text-accent-foreground";

/**
 * Concepts or entities (SL1 R8): one table per kind, filtered by status and
 * scheme (concepts) or entity type (entities). Bulk actions approve, move to
 * another scheme or change the kind — the migration's review path.
 */
export function TermsPanel({
  kind,
  refreshKey,
  onEdit,
  onChanged,
}: {
  kind: TermKind;
  refreshKey: number;
  onEdit: (term: Term) => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<TermStatus | typeof ALL>(ALL);
  const [schemeKey, setSchemeKey] = React.useState<string>(ALL);
  const [entityType, setEntityType] = React.useState<EntityType | typeof ALL>(
    ALL,
  );
  const [page, setPage] = React.useState(0);
  const [schemes, setSchemes] = React.useState<Scheme[]>([]);
  const [data, setData] = React.useState<{ terms: Term[]; total: number } | null>(
    null,
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState<string | null>(null);
  const [bulkScheme, setBulkScheme] = React.useState<string>(NO_SCHEME);

  React.useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  React.useEffect(() => {
    setPage(0);
    setSelected(new Set());
  }, [search, status, schemeKey, entityType, kind]);

  React.useEffect(() => {
    if (kind !== "CONCEPT") return;
    listSchemes()
      .then(setSchemes)
      .catch(() => setSchemes([]));
  }, [kind, refreshKey]);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    listTerms({
      kind,
      query: search.trim() || undefined,
      status: status === ALL ? undefined : status,
      schemeKey: kind === "CONCEPT" && schemeKey !== ALL ? schemeKey : undefined,
      entityType:
        kind === "ENTITY" && entityType !== ALL ? entityType : undefined,
      take: PAGE_SIZE,
      skip: page * PAGE_SIZE,
    })
      .then((result) => {
        if (active) setData(result);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(semanticErrorMessage(loadError, t("glossary.loadFailed")));
        setData({ terms: [], total: 0 });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [kind, search, status, schemeKey, entityType, page, refreshKey, t]);

  const terms = data?.terms ?? [];
  const total = data?.total ?? 0;
  const allOnPage = terms.length > 0 && terms.every((term) => selected.has(term.id));

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run(label: string, action: () => Promise<unknown>, done: string) {
    setBusy(label);
    try {
      await action();
      toast.success(done);
      onChanged();
    } catch (actionError) {
      toast.error(semanticErrorMessage(actionError, t("glossary.actionFailed")));
    } finally {
      setBusy(null);
    }
  }

  async function bulk(input: Parameters<typeof bulkUpdateTerms>[0]) {
    await run(
      "bulk",
      async () => {
        const result = await bulkUpdateTerms({ ids: [...selected], ...input });
        setSelected(new Set());
        return result;
      },
      t("glossary.bulk.done"),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-[1.6]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t("glossary.searchPlaceholder")}
            className="h-9 rounded-[4px] border-2 border-border pl-9"
          />
        </div>
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as TermStatus | typeof ALL)}
        >
          <SelectTrigger className="h-9 w-[160px] rounded-[4px] border-2 border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("glossary.allStatuses")}</SelectItem>
            {STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`glossary.statuses.${value}` as TranslationKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {kind === "CONCEPT" ? (
          <Select value={schemeKey} onValueChange={setSchemeKey}>
            <SelectTrigger className="h-9 w-[200px] rounded-[4px] border-2 border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("glossary.allSchemes")}</SelectItem>
              {schemes.map((scheme) => (
                <SelectItem key={scheme.id} value={scheme.key}>
                  {scheme.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Select
            value={entityType}
            onValueChange={(value) =>
              setEntityType(value as EntityType | typeof ALL)
            }
          >
            <SelectTrigger className="h-9 w-[200px] rounded-[4px] border-2 border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("glossary.allTypes")}</SelectItem>
              {ENTITY_TYPES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`glossary.entityTypes.${value}` as TranslationKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-[4px] border-2 border-accent/30 px-4 py-2.5">
          <span className="font-mono text-xs text-accent-ink">
            {t("glossary.bulk.selectedPlural", {
              count: selected.size.toLocaleString(),
            })}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {kind === "CONCEPT" && (
              <>
                <Select value={bulkScheme} onValueChange={setBulkScheme}>
                  <SelectTrigger className="h-8 w-[180px] rounded-[4px] border-2 border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SCHEME}>
                      {t("glossary.editor.noScheme")}
                    </SelectItem>
                    {schemes.map((scheme) => (
                      <SelectItem key={scheme.id} value={scheme.id}>
                        {scheme.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() =>
                    bulk({
                      schemeId: bulkScheme === NO_SCHEME ? null : bulkScheme,
                    })
                  }
                  className="h-8 rounded-[4px] border-2 border-border text-xs"
                >
                  {t("glossary.bulk.moveScheme")}
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                bulk({ kind: kind === "CONCEPT" ? "ENTITY" : "CONCEPT" })
              }
              className="h-8 rounded-[4px] border-2 border-border text-xs"
            >
              {kind === "CONCEPT"
                ? t("glossary.bulk.makeEntities")
                : t("glossary.bulk.makeConcepts")}
            </Button>
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() => bulk({ status: "APPROVED" })}
              className="h-8 rounded-[4px] text-xs"
            >
              {busy === "bulk" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {t("glossary.bulk.approve")}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-[4px] border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="relative min-h-[320px]">
        {data === null && loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="ml-2 text-sm">{t("glossary.loading")}</span>
          </div>
        ) : terms.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={
              kind === "CONCEPT"
                ? t("glossary.empty.concepts")
                : t("glossary.empty.entities")
            }
            description={
              kind === "CONCEPT"
                ? t("glossary.empty.conceptsHint")
                : t("glossary.empty.entitiesHint")
            }
          />
        ) : (
          <div className="max-h-[70vh] overflow-auto rounded-[4px] bg-white dark:bg-card">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-white/95 dark:bg-card/95">
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allOnPage}
                      onCheckedChange={() =>
                        setSelected(
                          allOnPage
                            ? new Set()
                            : new Set(terms.map((term) => term.id)),
                        )
                      }
                      aria-label={t("glossary.bulk.selectAllAria")}
                      className={CHECKBOX_CLASS}
                    />
                  </TableHead>
                  <TableHead>
                    <span className={MICRO_LABEL}>{t("glossary.columns.term")}</span>
                  </TableHead>
                  <TableHead>
                    <span className={MICRO_LABEL}>
                      {kind === "CONCEPT"
                        ? t("glossary.columns.scheme")
                        : t("glossary.columns.type")}
                    </span>
                  </TableHead>
                  <TableHead>
                    <span className={MICRO_LABEL}>
                      {t("glossary.columns.labels")}
                    </span>
                  </TableHead>
                  <TableHead>
                    <span className={MICRO_LABEL}>
                      {t("glossary.columns.status")}
                    </span>
                  </TableHead>
                  <TableHead className="text-right">
                    <span className={MICRO_LABEL}>
                      {t("glossary.columns.actions")}
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {terms.map((term) => (
                  <TableRow
                    key={term.id}
                    className={selected.has(term.id) ? "bg-accent/5 align-top" : "align-top"}
                  >
                    <TableCell className="py-3">
                      <Checkbox
                        checked={selected.has(term.id)}
                        onCheckedChange={() => toggle(term.id)}
                        aria-label={t("glossary.bulk.selectTermAria", {
                          term: term.term,
                        })}
                        className={CHECKBOX_CLASS}
                      />
                    </TableCell>
                    <TableCell className="max-w-[280px] py-3">
                      <TermLink termKey={term.key} className="block truncate text-sm">
                        {term.term}
                      </TermLink>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {term.key}
                      </div>
                      {term.definition && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {term.definition}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="py-3">
                      {kind === "CONCEPT" ? (
                        term.scheme ? (
                          <SchemeChip scheme={term.scheme} />
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {t("glossary.noValue")}
                          </span>
                        )
                      ) : (
                        <Badge variant="outline" className="rounded-[4px]">
                          {t(
                            `glossary.entityTypes.${term.entityType}` as TranslationKey,
                          )}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[280px] py-3">
                      <div className="flex flex-wrap gap-1">
                        {term.codes.map((code) => (
                          <Badge
                            key={`code-${code}`}
                            variant="outline"
                            className="rounded-[4px] font-mono text-[11px]"
                          >
                            {code}
                          </Badge>
                        ))}
                        {term.aliases.map((alias) => (
                          <Badge
                            key={`alias-${alias}`}
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
                        {term.codes.length +
                          term.aliases.length +
                          term.proposedAliases.length ===
                          0 && (
                          <span className="text-xs text-muted-foreground">
                            {t("glossary.noValue")}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="flex items-center gap-1.5">
                        <TermStatusBadge status={term.status} />
                        {term.origin === "AGENT" && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("glossary.proposedByAgent")}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="flex items-center justify-end gap-2">
                        {term.status === "DRAFT" && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-[4px] border-2 border-border"
                                disabled={busy !== null}
                                aria-label={t("glossary.approve")}
                                onClick={() =>
                                  run(
                                    term.id,
                                    () => approveTerm(term.id),
                                    t("glossary.approved"),
                                  )
                                }
                              >
                                {busy === term.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Check className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t("glossary.approve")}</TooltipContent>
                          </Tooltip>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-[4px] border-2 border-border"
                          aria-label={t("glossary.edit")}
                          onClick={() => onEdit(term)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={t("glossary.delete")}
                              className="h-8 rounded-[4px] border-2 border-destructive text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
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
                              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                              <AlertDialogAction
                                variant="destructive"
                                onClick={() =>
                                  run(
                                    term.id,
                                    () => deleteTerm(term.id),
                                    t("glossary.deleted"),
                                  )
                                }
                              >
                                {t("glossary.delete")}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {loading && data !== null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/40">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
          <span>
            {`${(page * PAGE_SIZE + 1).toLocaleString()}–${Math.min((page + 1) * PAGE_SIZE, total).toLocaleString()} ${t("common.of")} ${total.toLocaleString()}`}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              {t("common.pagination.previous")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={(page + 1) * PAGE_SIZE >= total}
              onClick={() => setPage((value) => value + 1)}
            >
              {t("common.pagination.next")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
