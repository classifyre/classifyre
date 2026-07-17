"use client";

import * as React from "react";
import { Copy, RotateCw } from "lucide-react";
import { api, type BoilerplateClusterDto } from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { Spinner } from "@workspace/ui/components/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { useTranslation } from "@/hooks/use-translation";

interface SourceOption {
  id: string;
  name: string;
  type: string;
}

const THRESHOLD = 0.95;
const LIMIT = 50;

export function BoilerplateClusters() {
  const { t } = useTranslation();
  const [sources, setSources] = React.useState<SourceOption[]>([]);
  const [sourcesLoading, setSourcesLoading] = React.useState(true);
  const [sourceId, setSourceId] = React.useState<string | undefined>();
  const [clusters, setClusters] = React.useState<BoilerplateClusterDto[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    api.sources
      .sourcesControllerListSources()
      .then((list) => {
        if (!active) return;
        const opts = (list ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
        }));
        setSources(opts);
        setSourceId((prev) => prev ?? opts[0]?.id);
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
    if (!sourceId) {
      setClusters([]);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    api.embeddings
      .embeddingControllerBoilerplate({
        sourceId,
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
  }, [sourceId, t]);

  React.useEffect(() => load(), [load]);

  const showEmpty = !loading && !error && sourceId && clusters.length === 0;

  return (
    <div className="flex h-full flex-col border-2 border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Copy className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-serif text-sm font-black uppercase tracking-[0.06em]">
            {t("correlation.nearDuplicates.title")}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={sourceId}
            onValueChange={setSourceId}
            disabled={sourcesLoading || sources.length === 0}
          >
            <SelectTrigger className="h-8 w-56 rounded-[2px] border-2 text-xs">
              <SelectValue
                placeholder={t("correlation.nearDuplicates.sourcePlaceholder")}
              />
            </SelectTrigger>
            <SelectContent>
              {sources.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={load}
            disabled={!sourceId}
          >
            <RotateCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <p className="border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
        {t("correlation.nearDuplicates.caption")}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!sourceId && !sourcesLoading ? (
          <EmptyState
            icon={Copy}
            title={t("correlation.nearDuplicates.selectSourceTitle")}
            description={t("correlation.nearDuplicates.selectSourceHint")}
          />
        ) : loading || sourcesLoading ? (
          <div className="flex h-full items-center justify-center">
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
            description={t("correlation.nearDuplicates.emptyDesc")}
          />
        ) : (
          <ul className="space-y-2">
            {clusters.map((c) => (
              <li
                key={c.groupHash}
                className="flex flex-wrap items-center gap-3 rounded-[4px] border-2 border-border bg-background px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {t("correlation.nearDuplicates.findingsCount", {
                      count: String(c.findingCount),
                    })}
                  </p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground">
                    {c.groupHash}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {t("correlation.nearDuplicates.meanImportance", {
                    count: c.meanImportance.toFixed(2),
                  })}
                </Badge>
                {c.findingIds[0] && (
                  <Button size="sm" variant="outline" asChild className="shrink-0">
                    <a href={`/findings/${c.findingIds[0]}`} target="_blank" rel="noreferrer">
                      {t("correlation.nearDuplicates.reviewFindings")}
                    </a>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
