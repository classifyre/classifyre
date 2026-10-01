"use client";

import * as React from "react";
import { toast } from "sonner";
import { Ban, Link2, ListTree, Loader2, RefreshCw, Search } from "lucide-react";
import {
  Badge,
  Button,
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
import {
  createBinding,
  getCoverage,
  listVocabulary,
  refreshVocabulary,
  semanticErrorMessage,
  type VocabularyRow,
} from "@/lib/semantic-api";
import { BindDialog } from "./bind-dialog";
import { MICRO_LABEL, TermLink } from "./glossary-ui";

type Bound = "false" | "true" | "any";
type Kind = "outputs" | "fields" | "all";

/**
 * *Unbound vocabulary* (SL2 §6.3): the data dictionary as a worklist — every
 * detector output and metadata field the data produces, with counts, and
 * whether it already carries a meaning.
 */
export function VocabularyPanel({
  refreshKey,
  onChanged,
}: {
  refreshKey: number;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [bound, setBound] = React.useState<Bound>("false");
  const [kind, setKind] = React.useState<Kind>("outputs");
  const [queryInput, setQueryInput] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [rows, setRows] = React.useState<VocabularyRow[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [refreshedAt, setRefreshedAt] = React.useState<string | null>(null);
  const [coverage, setCoverage] =
    React.useState<Awaited<ReturnType<typeof getCoverage>> | null>(null);
  const [binding, setBinding] = React.useState<VocabularyRow | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => setQuery(queryInput), 300);
    return () => clearTimeout(timer);
  }, [queryInput]);

  React.useEffect(() => {
    let active = true;
    setRows(null);
    Promise.all([
      listVocabulary({ kind, bound, q: query.trim() || undefined, take: 100 }),
      getCoverage().catch(() => null),
    ])
      .then(([result, cov]) => {
        if (!active) return;
        setRows(result.rows);
        setTotal(result.total);
        setRefreshedAt(result.refreshedAt);
        setCoverage(cov);
      })
      .catch(() => {
        if (active) setRows([]);
      });
    return () => {
      active = false;
    };
  }, [kind, bound, query, refreshKey]);

  async function markNoMeaning(row: VocabularyRow) {
    if (!row.output) return;
    setBusy(row.id);
    try {
      await createBinding({
        mode: "OUTPUT",
        output: {
          detectorType: row.output.detectorType,
          customDetectorKey: row.output.customDetectorKey ?? null,
          findingType: row.output.findingType,
        },
        noMeaning: true,
      });
      toast.success(t("glossary.bind.markedNoMeaning"));
      onChanged();
    } catch (error) {
      toast.error(semanticErrorMessage(error, t("glossary.bind.saveFailed")));
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    setBusy("refresh");
    try {
      await refreshVocabulary();
      toast.success(t("glossary.vocabulary.refreshQueued"));
    } catch (error) {
      toast.error(semanticErrorMessage(error, t("glossary.actionFailed")));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {coverage && coverage.share !== null && (
        <div className="rounded-[4px] border-2 border-border px-4 py-3 text-sm">
          {t("glossary.vocabulary.coverage", {
            share: Math.round(coverage.share * 100).toString(),
            outputs: coverage.unboundOutputs.toLocaleString(),
            findings: coverage.unboundFindings.toLocaleString(),
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder={t("glossary.vocabulary.search")}
            className="h-9 rounded-[4px] border-2 border-border pl-9"
          />
        </div>
        <Select value={bound} onValueChange={(value) => setBound(value as Bound)}>
          <SelectTrigger className="h-9 w-[170px] rounded-[4px] border-2 border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="false">{t("glossary.vocabulary.unbound")}</SelectItem>
            <SelectItem value="true">{t("glossary.vocabulary.bound")}</SelectItem>
            <SelectItem value="any">{t("glossary.vocabulary.everything")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={(value) => setKind(value as Kind)}>
          <SelectTrigger className="h-9 w-[170px] rounded-[4px] border-2 border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="outputs">{t("glossary.vocabulary.outputs")}</SelectItem>
            <SelectItem value="fields">{t("glossary.vocabulary.fields")}</SelectItem>
            <SelectItem value="all">{t("glossary.vocabulary.both")}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          disabled={busy === "refresh"}
          onClick={refresh}
          className="h-9 rounded-[4px] border-2 border-border"
        >
          {busy === "refresh" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {t("glossary.vocabulary.refresh")}
        </Button>
      </div>
      {refreshedAt && (
        <p className="text-[11px] text-muted-foreground">
          {t("glossary.vocabulary.refreshedAt", {
            when: new Date(refreshedAt).toLocaleString(),
          })}
        </p>
      )}

      {rows === null ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ListTree}
          title={
            bound === "false"
              ? t("glossary.vocabulary.allBound")
              : t("glossary.vocabulary.empty")
          }
          description={t("glossary.vocabulary.emptyHint")}
        />
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-[4px] bg-white dark:bg-card">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-white/95 dark:bg-card/95">
              <TableRow>
                <TableHead>
                  <span className={MICRO_LABEL}>{t("glossary.vocabulary.columns.vocabulary")}</span>
                </TableHead>
                <TableHead>
                  <span className={MICRO_LABEL}>{t("glossary.vocabulary.columns.sources")}</span>
                </TableHead>
                <TableHead className="text-right">
                  <span className={MICRO_LABEL}>{t("glossary.vocabulary.columns.open")}</span>
                </TableHead>
                <TableHead>
                  <span className={MICRO_LABEL}>{t("glossary.vocabulary.columns.values")}</span>
                </TableHead>
                <TableHead>
                  <span className={MICRO_LABEL}>{t("glossary.vocabulary.columns.means")}</span>
                </TableHead>
                <TableHead className="text-right">
                  <span className={MICRO_LABEL}>{t("glossary.columns.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className="align-top">
                  <TableCell className="max-w-[300px] py-3">
                    <div className="truncate text-sm font-semibold">{row.label.label}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {row.label.detail}
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-sm">{row.sources.length}</span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {row.sources.map((source) => source.name).join(", ")}
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="py-3 text-right font-mono text-sm">
                    {(row.kind === "output" ? row.openCount : row.assetCount).toLocaleString()}
                  </TableCell>
                  <TableCell className="max-w-[260px] py-3">
                    {row.distinctValues === null ? (
                      <span className="text-xs text-muted-foreground">
                        {t("glossary.bind.openValued")}
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {row.topValues.slice(0, 4).map((value) => (
                          <Badge
                            key={value.value}
                            variant="outline"
                            className="rounded-[4px] font-mono text-[10px]"
                          >
                            {value.value}
                          </Badge>
                        ))}
                        {row.distinctValues > 4 && (
                          <span className="text-[11px] text-muted-foreground">
                            +{(row.distinctValues - 4).toLocaleString()}
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[240px] py-3">
                    {row.bindings.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        {t("glossary.vocabulary.unboundShort")}
                      </span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {row.bindings.map((binding) => (
                          <span key={binding.id} className="text-xs">
                            {binding.noMeaning ? (
                              <span className="text-muted-foreground">
                                {t("glossary.bind.noMeaningShort")}
                              </span>
                            ) : binding.term ? (
                              <TermLink termKey={binding.term.key}>{binding.term.term}</TermLink>
                            ) : (
                              binding.lookupScheme?.name
                            )}
                            {binding.status !== "APPROVED" && (
                              <span className="ml-1 text-muted-foreground">
                                ({binding.status.toLowerCase()})
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setBinding(row)}
                        className="h-8 rounded-[4px] border-2 border-border text-xs"
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        {t("glossary.vocabulary.bind")}
                      </Button>
                      {row.kind === "output" && !row.bound && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy === row.id}
                              aria-label={t("glossary.bind.noMeaning")}
                              onClick={() => markNoMeaning(row)}
                              className="h-8"
                            >
                              {busy === row.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Ban className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t("glossary.bind.noMeaningHelp")}</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {total > rows.length && (
            <p className="p-3 text-xs text-muted-foreground">
              {t("glossary.vocabulary.more", {
                shown: rows.length.toLocaleString(),
                total: total.toLocaleString(),
              })}
            </p>
          )}
        </div>
      )}

      <BindDialog
        open={binding !== null}
        onOpenChange={(open) => !open && setBinding(null)}
        row={binding}
        onSaved={onChanged}
      />
    </div>
  );
}
