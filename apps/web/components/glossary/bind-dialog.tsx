"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, Ban, Loader2, Search } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import {
  createBinding,
  listSchemes,
  listVocabulary,
  lookupTerms,
  previewBinding,
  semanticErrorMessage,
  type BindingPreview,
  type BindingSpec,
  type LookupHit,
  type Scheme,
  type VocabularyRow,
} from "@/lib/semantic-api";
import { MICRO_LABEL, TermPicker } from "./glossary-ui";

type Choice = "every" | "values" | "lookup";

const MATCHED_EXACTLY = new Set(["term", "code", "alias", "hiddenAlias"]);

/**
 * The smart default (SL2 §6.1): a categorical output whose top values mostly
 * name APPROVED concepts of one scheme is a lookup into that scheme.
 */
async function guessLookup(
  row: VocabularyRow,
): Promise<{ schemeId: string; match: "CODES" | "ANY" } | null> {
  const values = row.topValues.slice(0, 6);
  const total = values.reduce((sum, value) => sum + value.count, 0);
  if (!row.categorical || total === 0) return null;
  const covered = new Map<string, { count: number; codesOnly: boolean }>();
  await Promise.all(
    values.map(async ({ value, count }) => {
      const hits = await lookupTerms(value, { kind: "CONCEPT", limit: 3 }).catch(
        () => [] as LookupHit[],
      );
      const seen = new Set<string>();
      for (const hit of hits) {
        if (hit.status !== "APPROVED" || !hit.schemeId) continue;
        if (!MATCHED_EXACTLY.has(hit.matchedOn ?? "")) continue;
        if (seen.has(hit.schemeId)) continue;
        seen.add(hit.schemeId);
        const entry = covered.get(hit.schemeId) ?? { count: 0, codesOnly: true };
        entry.count += count;
        entry.codesOnly = entry.codesOnly && hit.matchedOn === "code";
        covered.set(hit.schemeId, entry);
      }
    }),
  );
  const best = [...covered.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  if (!best || best[1].count / total < 0.5) return null;
  return { schemeId: best[0], match: best[1].codesOnly ? "CODES" : "ANY" };
}

/** Pick the output or field to bind, for openings that start from a term. */
function VocabularyPicker({ onPick }: { onPick: (row: VocabularyRow) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = React.useState("");
  const [rows, setRows] = React.useState<VocabularyRow[] | null>(null);

  React.useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      listVocabulary({ kind: "all", bound: "any", q: query.trim() || undefined, take: 20 })
        .then((result) => {
          if (active) setRows(result.rows);
        })
        .catch(() => {
          if (active) setRows([]);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("glossary.bind.searchVocabulary")}
          className="h-9 rounded-[4px] border-2 border-border pl-9"
        />
      </div>
      <ul className="max-h-72 overflow-auto rounded-[4px] border-2 border-border">
        {rows === null ? (
          <li className="p-3">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </li>
        ) : rows.length === 0 ? (
          <li className="p-3 text-xs text-muted-foreground">
            {t("glossary.bind.noVocabulary")}
          </li>
        ) : (
          rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onPick(row)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-accent/10"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">{row.label.label}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {row.label.detail}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {(row.kind === "output" ? row.openCount : row.assetCount).toLocaleString()}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/**
 * *What does this mean?* (SL2 §6): say once what a detector output or a
 * metadata field means. Never a pattern — a choice from the observed
 * vocabulary — with a live preview of what it would link.
 */
export function BindDialog({
  open,
  onOpenChange,
  row: initialRow,
  initialTerm,
  initialValue,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The output or field; when absent the dialog first asks for one. */
  row?: VocabularyRow | null;
  /** Prefilled concept (from a term page). */
  initialTerm?: LookupHit | null;
  /** The value that opened the dialog (from a finding). */
  initialValue?: string | null;
  onSaved?: () => void;
}) {
  const { t } = useTranslation();
  const [row, setRow] = React.useState<VocabularyRow | null>(initialRow ?? null);
  const [sourceId, setSourceId] = React.useState<string>("all");
  const [choice, setChoice] = React.useState<Choice>("every");
  const [values, setValues] = React.useState<Set<string>>(new Set());
  const [schemes, setSchemes] = React.useState<Scheme[]>([]);
  const [schemeId, setSchemeId] = React.useState<string>("");
  const [match, setMatch] = React.useState<"CODES" | "ANY">("CODES");
  const [term, setTerm] = React.useState<LookupHit | null>(initialTerm ?? null);
  const [preview, setPreview] = React.useState<BindingPreview | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const isField = row?.kind === "field";

  // Reset and apply the smart default whenever the dialog opens on a row.
  React.useEffect(() => {
    if (!open) return;
    setRow(initialRow ?? null);
    setTerm(initialTerm ?? null);
    setSourceId("all");
    setPreview(null);
    setPreviewError(null);
    listSchemes()
      .then(setSchemes)
      .catch(() => setSchemes([]));
  }, [open, initialRow, initialTerm]);

  React.useEffect(() => {
    if (!open || !row) return;
    let active = true;
    const fallback: Choice = row.kind === "field" || row.categorical ? "values" : "every";
    setChoice(fallback);
    setValues(new Set(initialValue ? [initialValue] : []));
    if (initialTerm) return;
    void guessLookup(row).then((guess) => {
      if (!active || !guess) return;
      setChoice("lookup");
      setSchemeId(guess.schemeId);
      setMatch(guess.match);
    });
    return () => {
      active = false;
    };
  }, [open, row, initialValue, initialTerm]);

  const spec: BindingSpec | null = React.useMemo(() => {
    if (!row) return null;
    const scope = sourceId === "all" ? [] : [sourceId];
    const output =
      row.kind === "output" && row.output
        ? {
            detectorType: row.output.detectorType,
            customDetectorKey: row.output.customDetectorKey ?? null,
            findingType: row.output.findingType,
          }
        : null;
    if (choice === "lookup") {
      if (!schemeId) return null;
      return {
        mode: isField ? "METADATA_LOOKUP" : "OUTPUT_LOOKUP",
        output,
        field: isField ? row.field ?? null : null,
        lookup: { schemeId, match },
        sourceIds: scope,
      };
    }
    if (!term) return null;
    if (choice === "values" || isField) {
      if (values.size === 0) return null;
      return {
        mode: isField ? "METADATA_VALUES" : "OUTPUT_VALUES",
        output,
        field: isField ? row.field ?? null : null,
        values: [...values],
        termId: term.id,
        sourceIds: scope,
      };
    }
    return { mode: "OUTPUT", output, termId: term.id, sourceIds: scope };
  }, [row, sourceId, choice, schemeId, match, term, values, isField]);

  // Live preview, debounced.
  React.useEffect(() => {
    if (!open || !spec) {
      setPreview(null);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      setPreviewing(true);
      setPreviewError(null);
      previewBinding(spec)
        .then((result) => {
          if (active) setPreview(result);
        })
        .catch((error) => {
          if (!active) return;
          setPreview(null);
          setPreviewError(semanticErrorMessage(error, t("glossary.bind.previewFailed")));
        })
        .finally(() => {
          if (active) setPreviewing(false);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, spec, t]);

  async function save(status: "APPROVED" | "DRAFT", noMeaning = false) {
    if (!row) return;
    const body: BindingSpec | null = noMeaning
      ? {
          mode: "OUTPUT",
          output: row.output
            ? {
                detectorType: row.output.detectorType,
                customDetectorKey: row.output.customDetectorKey ?? null,
                findingType: row.output.findingType,
              }
            : null,
          noMeaning: true,
          sourceIds: sourceId === "all" ? [] : [sourceId],
        }
      : spec;
    if (!body) return;
    setSaving(true);
    try {
      await createBinding(body, { status });
      toast.success(
        noMeaning
          ? t("glossary.bind.markedNoMeaning")
          : status === "APPROVED"
            ? t("glossary.bind.saved", {
                assets: (preview?.counts.assets ?? 0).toLocaleString(),
              })
            : t("glossary.bind.savedDraft"),
      );
      onSaved?.();
      onOpenChange(false);
    } catch (error) {
      toast.error(semanticErrorMessage(error, t("glossary.bind.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  const existing = row?.bindings.filter((binding) => binding.status === "APPROVED") ?? [];

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("glossary.bind.title")}</DialogTitle>
          <DialogDescription>{t("glossary.bind.description")}</DialogDescription>
        </DialogHeader>

        {!row ? (
          <VocabularyPicker onPick={setRow} />
        ) : (
          <div className="space-y-5">
            {/* 1 — What the data says */}
            <section className="space-y-2">
              <div className={MICRO_LABEL}>1 · {t("glossary.bind.step1")}</div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{row.label.label}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {row.label.detail}
                  </div>
                </div>
                {row.sources.length > 1 && (
                  <Select value={sourceId} onValueChange={setSourceId}>
                    <SelectTrigger className="h-8 w-[220px] rounded-[4px] border-2 border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("glossary.bind.allSources")}</SelectItem>
                      {row.sources.map((source) => (
                        <SelectItem key={source.id} value={source.id}>
                          {t("glossary.bind.onlySource", { name: source.name })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("glossary.bind.observed", {
                  findings: row.openCount.toLocaleString(),
                  assets: row.assetCount.toLocaleString(),
                  values:
                    row.distinctValues === null
                      ? t("glossary.bind.openValued")
                      : row.distinctValues.toLocaleString(),
                })}
              </p>
              {existing.length > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {t("glossary.bind.alreadyMeans", {
                    terms: existing
                      .map((binding) =>
                        binding.noMeaning
                          ? t("glossary.bind.noMeaning")
                          : binding.term?.term ?? binding.lookupScheme?.name ?? "?",
                      )
                      .join(", "),
                  })}
                </p>
              )}
            </section>

            {/* 2 — Which findings */}
            <section className="space-y-2">
              <div className={MICRO_LABEL}>2 · {t("glossary.bind.step2")}</div>
              <div className="space-y-2" role="radiogroup">
                {(
                  [
                    ...(isField ? [] : (["every"] as const)),
                    "values",
                    "lookup",
                  ] as Choice[]
                ).map((value) => (
                  <label
                    key={value}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-[4px] border-2 px-3 py-2",
                      choice === value ? "border-accent bg-accent/5" : "border-border",
                    )}
                  >
                    <input
                      type="radio"
                      name="bind-choice"
                      className="mt-1"
                      checked={choice === value}
                      onChange={() => setChoice(value)}
                    />
                    <span className="min-w-0 flex-1 space-y-2">
                      <span className="block text-sm">
                        {t(`glossary.bind.choice.${value}` as TranslationKey)}
                      </span>
                      {value === "values" && choice === "values" && (
                        <span className="flex flex-wrap gap-1.5">
                          {row.topValues.length === 0 && (
                            <span className="text-xs text-muted-foreground">
                              {t("glossary.bind.noValues")}
                            </span>
                          )}
                          {row.topValues.map(({ value: text, count }) => {
                            const on = values.has(text);
                            return (
                              <button
                                key={text}
                                type="button"
                                aria-pressed={on}
                                onClick={() =>
                                  setValues((previous) => {
                                    const next = new Set(previous);
                                    if (next.has(text)) next.delete(text);
                                    else next.add(text);
                                    return next;
                                  })
                                }
                                className={cn(
                                  "rounded-[4px] border px-2 py-0.5 font-mono text-[11px]",
                                  on
                                    ? "border-accent bg-accent/15"
                                    : "border-border hover:bg-muted",
                                )}
                              >
                                {text} <span className="text-muted-foreground">{count}</span>
                              </button>
                            );
                          })}
                        </span>
                      )}
                      {value === "lookup" && choice === "lookup" && (
                        <span className="flex flex-wrap items-center gap-2">
                          <Select value={schemeId} onValueChange={setSchemeId}>
                            <SelectTrigger className="h-8 w-[220px] rounded-[4px] border-2 border-border">
                              <SelectValue placeholder={t("glossary.bind.pickScheme")} />
                            </SelectTrigger>
                            <SelectContent>
                              {schemes.map((scheme) => (
                                <SelectItem key={scheme.id} value={scheme.id}>
                                  {scheme.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={match}
                            onValueChange={(next) => setMatch(next as "CODES" | "ANY")}
                          >
                            <SelectTrigger className="h-8 w-[200px] rounded-[4px] border-2 border-border">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="CODES">{t("glossary.bind.matchCodes")}</SelectItem>
                              <SelectItem value="ANY">{t("glossary.bind.matchAny")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </section>

            {/* 3 — What it means */}
            {choice !== "lookup" && (
              <section className="space-y-2">
                <div className={MICRO_LABEL}>3 · {t("glossary.bind.step3")}</div>
                <TermPicker
                  value={term}
                  onChange={setTerm}
                  kind="CONCEPT"
                  placeholder={t("glossary.bind.searchConcepts")}
                />
                {term && term.status !== "APPROVED" && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {t("glossary.bind.termNotApproved")}
                  </p>
                )}
              </section>
            )}

            {/* Preview */}
            <section className="space-y-2 rounded-[4px] border-2 border-dashed border-border p-3">
              <div className="flex items-center justify-between">
                <span className={MICRO_LABEL}>{t("glossary.bind.preview")}</span>
                {previewing && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
              </div>
              {!spec ? (
                <p className="text-xs text-muted-foreground">
                  {t("glossary.bind.completeToPreview")}
                </p>
              ) : previewError ? (
                <p className="text-xs text-destructive">{previewError}</p>
              ) : preview ? (
                <div className="space-y-2 text-sm">
                  <p>
                    {t("glossary.bind.willLink", {
                      findings: preview.counts.findings.toLocaleString(),
                      assets: preview.counts.assets.toLocaleString(),
                      sources: preview.counts.sources.toLocaleString(),
                    })}
                    {preview.timedOut && ` ${t("glossary.bind.timedOut")}`}
                  </p>
                  {preview.lookup && (
                    <div className="space-y-1">
                      <div className="flex flex-wrap gap-1.5">
                        {preview.lookup.matched.map((row) => (
                          <Badge key={row.value} variant="outline" className="rounded-[4px] text-[11px]">
                            <span className="font-mono">{row.value}</span>
                            <span className="mx-1">→</span>
                            {row.term.term}
                            <span className="ml-1 text-muted-foreground">({row.count})</span>
                          </Badge>
                        ))}
                      </div>
                      {preview.lookup.unmatched.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {t("glossary.bind.unmatched")}{" "}
                          {preview.lookup.unmatched
                            .slice(0, 12)
                            .map((row) => `${row.value} (${row.count})`)
                            .join(", ")}
                        </p>
                      )}
                      {preview.lookup.ambiguous.length > 0 && (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          {t("glossary.bind.ambiguous")}{" "}
                          {preview.lookup.ambiguous.map((row) => row.value).join(", ")}
                        </p>
                      )}
                    </div>
                  )}
                  {preview.warnings.map((warning) => (
                    <p
                      key={warning.code}
                      className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"
                    >
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {warning.message}
                    </p>
                  ))}
                  {preview.samples.length > 0 && (
                    <p className="truncate text-xs text-muted-foreground">
                      {t("glossary.bind.samples")}{" "}
                      {preview.samples.map((sample) => sample.assetName).join(" · ")}
                    </p>
                  )}
                </div>
              ) : null}
            </section>
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div>
            {row && !isField && (
              <Button
                variant="ghost"
                disabled={saving}
                onClick={() => save("APPROVED", true)}
                className="text-xs"
              >
                <Ban className="h-3.5 w-3.5" />
                {t("glossary.bind.noMeaning")}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="outline"
              disabled={saving || !spec}
              onClick={() => save("DRAFT")}
            >
              {t("glossary.bind.saveDraft")}
            </Button>
            <Button disabled={saving || !spec} onClick={() => save("APPROVED")}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("glossary.bind.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
