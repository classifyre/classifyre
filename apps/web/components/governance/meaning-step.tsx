"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Search, Sparkles, X } from "lucide-react";
import {
  api,
  type GovernanceMeaningDto,
  type GovernanceMeaningSuggestionDto,
} from "@workspace/api-client";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import { useNsPath } from "@/lib/ns-path";
import { lookupTerms, saveTerm, type LookupHit } from "@/lib/semantic-api";

/**
 * What an asset is about (GOV §5.7), made easy: the terms it carries as
 * chips, terms it probably is about (from the semantic layer and from the
 * names of the table and its columns) to add with one click, and a search
 * that adds as you pick — or creates the term when the glossary has none.
 */
export function MeaningStep({
  assetId,
  onChanged,
}: {
  assetId: string;
  /** The checklist counts approved terms; the caller reloads it. */
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const [state, setState] = useState<GovernanceMeaningDto | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LookupHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(
        await api.governance.governanceControllerAssetMeaning({ id: assetId }),
      );
    } catch {
      setState(null);
    }
  }, [assetId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setHits([]);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      lookupTerms(text, { kind: "CONCEPT", limit: 6 })
        .then((found) => active && setHits(found))
        .catch(() => active && setHits([]))
        .finally(() => active && setSearching(false));
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const run = async (
    key: string,
    action: () => Promise<GovernanceMeaningDto>,
  ) => {
    setBusy(key);
    try {
      setState(await action());
      onChanged?.();
    } catch (error) {
      toast.error(
        await extractApiErrorMessage(error, t("governance.meaning.failed")),
      );
    } finally {
      setBusy(null);
    }
  };

  const add = (termId: string) =>
    run(termId, () =>
      api.governance.governanceControllerLinkTerm({
        id: assetId,
        linkGovernanceTermDto: { termId },
      }),
    );

  const remove = (termId: string) =>
    run(termId, () =>
      api.governance.governanceControllerUnlinkTerm({ id: assetId, termId }),
    );

  const dismiss = (suggestion: GovernanceMeaningSuggestionDto) =>
    run(suggestion.term.id, () =>
      api.governance.governanceControllerDismissSuggestion({
        id: assetId,
        suggestionId: suggestion.suggestionId!,
      }),
    );

  const create = async () => {
    const name = query.trim();
    if (!name) return;
    setBusy("create");
    try {
      const term = await saveTerm({ term: name, kind: "CONCEPT" });
      setQuery("");
      await add(term.id);
      toast.success(t("governance.meaning.created", { term: name }));
    } catch (error) {
      toast.error(
        await extractApiErrorMessage(error, t("governance.meaning.failed")),
      );
    } finally {
      setBusy(null);
    }
  };

  if (!state) {
    return (
      <Card>
        <CardContent className="flex justify-center py-6">
          <Spinner />
        </CardContent>
      </Card>
    );
  }

  const linked = new Set(state.terms.map((entry) => entry.term.id));
  const canEdit = state.canGovern;
  const exact = hits.some(
    (hit) => hit.term.toLowerCase() === query.trim().toLowerCase(),
  );

  return (
    <Card data-testid="meaning-step">
      <CardHeader>
        <CardTitle>{t("governance.meaning.title")}</CardTitle>
        <CardDescription>{t("governance.meaning.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {state.terms.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("governance.meaning.none")}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2" data-testid="meaning-terms">
            {state.terms.map((entry) => {
              const byHand = Boolean(entry.referenceId);
              return (
                <span
                  key={entry.term.id}
                  className="inline-flex items-center gap-1.5 rounded-full border-2 border-border bg-background py-1 pl-3 pr-1.5 text-sm"
                >
                  <a
                    href={nsPath(`/glossary/terms/${entry.term.key}`)}
                    className="font-medium hover:underline"
                    title={entry.term.definition ?? undefined}
                  >
                    {entry.term.term}
                  </a>
                  {entry.term.status !== "APPROVED" && (
                    <Badge variant="outline" className="text-[10px]">
                      {t(
                        `governance.meaning.termStatus.${entry.term.status}` as TranslationKey,
                      )}
                    </Badge>
                  )}
                  {!byHand && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {t("governance.meaning.auto")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("governance.meaning.autoHint", {
                          methods: entry.methods.join(", "),
                        })}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {entry.pending && <Spinner size="sm" />}
                  {canEdit && byHand && (
                    <button
                      type="button"
                      className="rounded-full p-0.5 text-muted-foreground hover:bg-accent/20 hover:text-foreground"
                      aria-label={t("governance.meaning.remove", {
                        term: entry.term.term,
                      })}
                      disabled={busy === entry.term.id}
                      onClick={() => void remove(entry.term.id)}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}

        {canEdit && state.suggestions.length > 0 && (
          <div className="space-y-2" data-testid="meaning-suggestions">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              {t("governance.meaning.suggested")}
            </div>
            <ul className="space-y-1.5">
              {state.suggestions.map((suggestion) => (
                <li
                  key={suggestion.term.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {suggestion.term.term}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {t(
                        `governance.meaning.because.${suggestion.source}` as TranslationKey,
                        { reason: suggestion.reason },
                      )}
                    </div>
                  </div>
                  <span className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === suggestion.term.id}
                      onClick={() => void add(suggestion.term.id)}
                      data-testid="meaning-accept"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      {t("governance.meaning.add")}
                    </Button>
                    {suggestion.suggestionId && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        aria-label={t("governance.meaning.dismiss")}
                        onClick={() => void dismiss(suggestion)}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {canEdit && (
          <div className="space-y-2">
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("governance.meaning.search")}
                className="pl-9"
                data-testid="meaning-search"
              />
            </div>
            {query.trim() && (
              <ul className="space-y-1">
                {searching && (
                  <li className="px-3 py-1">
                    <Spinner size="sm" />
                  </li>
                )}
                {!searching &&
                  hits.map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        disabled={linked.has(hit.id) || busy === hit.id}
                        onClick={() => {
                          setQuery("");
                          void add(hit.id);
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm enabled:hover:bg-accent/10 disabled:opacity-50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {hit.term}
                          </span>
                          {hit.definition && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {hit.definition}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {linked.has(hit.id)
                            ? t("governance.meaning.already")
                            : t("governance.meaning.add")}
                        </span>
                      </button>
                    </li>
                  ))}
                {!searching && hits.length === 0 && (
                  <li className="px-3 py-1 text-sm text-muted-foreground">
                    {t("governance.meaning.noHits")}
                  </li>
                )}
                {!searching && !exact && state.canEditGlossary && (
                  <li>
                    <button
                      type="button"
                      disabled={busy === "create"}
                      onClick={() => void create()}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent/10"
                      data-testid="meaning-create"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      {t("governance.meaning.create", { term: query.trim() })}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
