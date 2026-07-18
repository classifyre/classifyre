"use client";

import * as React from "react";
import { Copy, RotateCw, SlidersHorizontal } from "lucide-react";
import { api, type BoilerplateClusterDto } from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { Spinner } from "@workspace/ui/components/spinner";
import {
  MultiSelect,
  MultiSelectContent,
  MultiSelectGroup,
  MultiSelectItem,
  MultiSelectTrigger,
  MultiSelectValue,
} from "@workspace/ui/components/multi-select";
import { useTranslation } from "@/hooks/use-translation";

interface SourceOption {
  id: string;
  name: string;
  type: string;
}

const THRESHOLD = 0.95;
const LIMIT = 100;

/**
 * Corpus-wide near-duplicate finding clusters (repeated boilerplate). Scoped
 * to "All sources" by default via the global endpoint; narrowing to specific
 * sources uses the same endpoint's `sourceIds` filter. Clusters spanning more
 * than one source are flagged — the same content circulating across systems
 * is usually more interesting than boilerplate repeated within one source.
 * Clicking a cluster focuses its assets on the graph (gray-out mechanic);
 * clicking it again clears the focus.
 */
export function BoilerplateClusters({
  onGoToTune,
  onFocusCluster,
  focusedClusterKey,
}: {
  /** Switch the workspace view to the Tune settings' semantic index section. */
  onGoToTune?: () => void;
  /** Toggle graph focus on this cluster's assets (null clears). */
  onFocusCluster?: (cluster: { key: string; assetIds: string[] } | null) => void;
  /** groupHash of the cluster currently focused on the graph, if any. */
  focusedClusterKey?: string | null;
}) {
  const { t } = useTranslation();
  const [sources, setSources] = React.useState<SourceOption[]>([]);
  const [sourcesLoading, setSourcesLoading] = React.useState(true);
  const [sourceIds, setSourceIds] = React.useState<string[]>([]);
  const [clusters, setClusters] = React.useState<BoilerplateClusterDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    api.sources
      .sourcesControllerListSources()
      .then((list) => {
        if (!active) return;
        setSources((list ?? []).map((s) => ({ id: s.id, name: s.name, type: s.type })));
      })
      .catch(() => {
        if (active) setSources([]);
      })
      .finally(() => {
        if (active) setSourcesLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const load = React.useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api.embeddings
      .embeddingControllerBoilerplateGlobal({
        sourceIds: sourceIds.length > 0 ? sourceIds : undefined,
        threshold: THRESHOLD as unknown as object,
        limit: LIMIT as unknown as object,
      })
      .then((res) => {
        if (!active) return;
        setClusters(Array.isArray(res) ? res : []);
      })
      .catch((e: unknown) => {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : t("correlation.nearDuplicates.loadFailed"),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sourceIds, t]);

  React.useEffect(() => load(), [load]);

  const sourceNameById = React.useMemo(
    () => new Map(sources.map((s) => [s.id, s.name])),
    [sources],
  );

  const showEmpty = !loading && !error && clusters.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Copy className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-serif text-sm font-black uppercase tracking-[0.06em]">
            {t("correlation.nearDuplicates.title")}
          </h3>
        </div>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={load}>
          <RotateCw className="h-4 w-4" />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("correlation.nearDuplicates.caption")}
      </p>
      {onFocusCluster && (
        <p className="text-[11px] text-muted-foreground">
          {t("correlation.nearDuplicates.focusHint")}
        </p>
      )}

      <MultiSelect values={sourceIds} onValuesChange={setSourceIds}>
        <MultiSelectTrigger
          className="h-8 w-full rounded-[2px] border-2 text-xs"
          disabled={sourcesLoading || sources.length === 0}
        >
          <MultiSelectValue
            placeholder={t("correlation.nearDuplicates.scopeAllSources")}
            overflowBehavior="cutoff"
          />
        </MultiSelectTrigger>
        <MultiSelectContent>
          <MultiSelectGroup>
            {sources.map((s) => (
              <MultiSelectItem key={s.id} value={s.id}>
                {s.name}
              </MultiSelectItem>
            ))}
          </MultiSelectGroup>
        </MultiSelectContent>
      </MultiSelect>

      <div>
        {loading || sourcesLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size="lg" label={t("correlation.nearDuplicates.title")} />
          </div>
        ) : error ? (
          <EmptyState
            icon={Copy}
            title={t("correlation.nearDuplicates.loadFailed")}
            description={error}
            action={{ label: t("correlation.nearDuplicates.retry"), onClick: load }}
          />
        ) : showEmpty ? (
          <EmptyState
            icon={Copy}
            title={t("correlation.nearDuplicates.empty")}
            description={t("correlation.nearDuplicates.emptyTuneHint")}
            action={
              onGoToTune
                ? { label: t("correlation.nearDuplicates.goToTune"), onClick: onGoToTune }
                : undefined
            }
          />
        ) : (
          <ul className="space-y-2">
            {clusters.map((c) => {
              const isFocused = focusedClusterKey === c.groupHash;
              return (
                <li
                  key={c.groupHash}
                  className={`rounded-[4px] border-2 bg-background ${
                    isFocused ? "border-foreground" : "border-border"
                  }`}
                >
                  {/* Click = toggle graph focus on this cluster's assets. */}
                  <button
                    type="button"
                    onClick={() =>
                      onFocusCluster?.(
                        isFocused ? null : { key: c.groupHash, assetIds: c.assetIds },
                      )
                    }
                    className="flex w-full flex-wrap items-center gap-3 px-3 py-2 text-left hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-sm font-medium">
                        {t("correlation.nearDuplicates.findingsCount", {
                          count: String(c.findingCount),
                        })}
                      </p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">
                        {c.groupHash}
                      </p>
                      {c.sourceCount > 1 && (
                        <div className="flex flex-wrap items-center gap-1 pt-0.5">
                          <Badge
                            variant="outline"
                            className="border-amber-600/50 bg-amber-500/10 text-[10px] uppercase text-amber-700 dark:border-amber-400/40 dark:text-amber-400"
                          >
                            {t("correlation.nearDuplicates.spansSources", {
                              count: String(c.sourceCount),
                            })}
                          </Badge>
                          <span
                            className="max-w-[220px] truncate text-[10px] text-muted-foreground"
                            title={c.sourceIds.map((id) => sourceNameById.get(id) ?? id).join(", ")}
                          >
                            {c.sourceIds.map((id) => sourceNameById.get(id) ?? id).join(", ")}
                          </span>
                        </div>
                      )}
                    </div>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {t("correlation.nearDuplicates.meanImportance", {
                        count: c.meanImportance.toFixed(2),
                      })}
                    </Badge>
                  </button>
                  {c.findingIds[0] && (
                    <div className="flex items-center justify-end border-t border-border/60 px-3 py-1.5">
                      <a
                        href={`/findings/${c.findingIds[0]}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                      >
                        {t("correlation.nearDuplicates.reviewFindings")}
                      </a>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {onGoToTune && !showEmpty && (
        <div className="border-t border-border/60 px-3 py-2">
          <button
            type="button"
            onClick={onGoToTune}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
          >
            <SlidersHorizontal className="h-3 w-3" />
            {t("correlation.nearDuplicates.goToTune")}
          </button>
        </div>
      )}
    </div>
  );
}
