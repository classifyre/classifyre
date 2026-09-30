"use client";

import * as React from "react";
import { api, type AssetFixtureDto } from "@workspace/api-client";
import { AlertTriangle, FlaskConical, Loader2, Play, Search } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { useSourceOptions } from "@/components/asset-filter-bar";
import type { ExecutionRecord } from "@/components/notebook/use-notebook-execution";

interface PreviewFinding {
  finding_type: string;
  matched_content: string;
  severity: string;
  confidence?: number;
  location?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  extracted_data?: Record<string, unknown>;
  identity_key?: string;
}

interface PreviewAsset {
  hash: string;
  name: string;
  kind: string;
  status: "ok" | "error";
  error?: string | null;
  durationMs?: number;
  findingCount: number;
  findings: PreviewFinding[];
  warnings: string[];
  /** A bounded snapshot of the asset, in the test-fixture shape. */
  fixture?: AssetFixtureDto;
}

interface AssetOption {
  id: string;
  name: string;
  kind: string;
}

const ANY_ASSET = "__sample__";

function locationLabel(finding: PreviewFinding): string {
  const metadata = finding.metadata ?? {};
  const parts: string[] = [];
  if (typeof metadata.tabular_row_index === "number") {
    parts.push(`row ${metadata.tabular_row_index}`);
  }
  if (typeof metadata.tabular_column_name === "string") {
    parts.push(String(metadata.tabular_column_name));
  }
  const location = finding.location ?? {};
  if (!parts.length && typeof location.description === "string") {
    parts.push(location.description);
  }
  if (!parts.length && typeof location.line === "number") {
    parts.push(`line ${location.line}`);
  }
  return parts.join(" · ");
}

/**
 * Judge real assets with the saved rule, without recording anything.
 *
 * Runs `preview_detect`: the same child process, payload server and finding
 * mapping a scan uses, against one chosen asset of a source (or a small
 * sample). What it shows is what a scan would record.
 */
export function CodeDetectorPreview({
  execution,
  busy,
  disabled,
  onRun,
  onCapture,
}: {
  execution: ExecutionRecord | null;
  busy: boolean;
  disabled?: boolean;
  onRun: (request: { sourceId: string; assetId?: string }) => void;
  /** Keep this asset and the findings it produced as a test scenario. */
  onCapture?: (sample: {
    name: string;
    fixture?: AssetFixtureDto;
    findings: Array<{ finding_type: string; identity_key?: string }>;
  }) => void;
}) {
  const { t } = useTranslation();
  const sources = useSourceOptions();
  const [sourceId, setSourceId] = React.useState<string>("");
  const [assetId, setAssetId] = React.useState<string>(ANY_ASSET);
  const [query, setQuery] = React.useState("");
  const [assets, setAssets] = React.useState<AssetOption[]>([]);
  const [loadingAssets, setLoadingAssets] = React.useState(false);

  React.useEffect(() => {
    if (!sourceId) {
      setAssets([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      setLoadingAssets(true);
      api
        .searchAssets({
          assets: {
            sourceId,
            ...(query.trim() ? { search: query.trim() } : {}),
          },
          page: { skip: 0, limit: 25 },
        } as never)
        .then((response) => {
          if (!active) return;
          setAssets(
            (response.items ?? []).map((item) => ({
              id: item.asset.id,
              name: item.asset.name,
              kind: item.asset.assetType,
            })),
          );
        })
        .catch(() => active && setAssets([]))
        .finally(() => active && setLoadingAssets(false));
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [sourceId, query]);

  const isPreview = execution?.mode === "preview_detect";
  const samples = (isPreview ? (execution?.outputs?.assets ?? []) : []) as
    | PreviewAsset[];
  const result = (
    isPreview ? (execution?.outputs?.result ?? null) : null
  ) as {
    sampled?: number;
    failed?: number;
    findings?: number;
    logs?: string;
    warnings?: string[];
  } | null;

  return (
    <Card className="p-6 space-y-4 border-2 border-border" data-testid="code-detector-preview">
      <div>
        <h2 className="font-serif font-black uppercase tracking-wide text-base">
          {t("detectors.code.previewTitle")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("detectors.code.previewHint")}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <div className="space-y-1.5">
          <Label>{t("detectors.code.previewSource")}</Label>
          <Select
            value={sourceId}
            onValueChange={(value) => {
              setSourceId(value);
              setAssetId(ANY_ASSET);
            }}
          >
            <SelectTrigger data-testid="code-preview-source">
              <SelectValue placeholder={t("detectors.code.previewPickSource")} />
            </SelectTrigger>
            <SelectContent>
              {sources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("detectors.code.previewAsset")}</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("detectors.code.previewSearchAssets")}
                className="pl-8"
                disabled={!sourceId}
              />
            </div>
          </div>
          <Select value={assetId} onValueChange={setAssetId} disabled={!sourceId}>
            <SelectTrigger data-testid="code-preview-asset">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_ASSET}>
                {t("detectors.code.previewSample")}
              </SelectItem>
              {assets.map((asset) => (
                <SelectItem key={asset.id} value={asset.id}>
                  {asset.name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {asset.kind}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {loadingAssets ? (
            <p className="text-xs text-muted-foreground">
              {t("detectors.code.previewLoadingAssets")}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          onClick={() =>
            onRun({
              sourceId,
              assetId: assetId === ANY_ASSET ? undefined : assetId,
            })
          }
          disabled={disabled || busy || !sourceId}
          data-testid="code-preview-run"
        >
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          {t("detectors.code.previewRun")}
        </Button>
      </div>

      {isPreview && execution?.status === "ERROR" && execution.error ? (
        <div className="flex items-start gap-2 rounded-[4px] border border-destructive/50 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p className="font-medium">{execution.error.type}</p>
            <p className="whitespace-pre-wrap break-words text-muted-foreground">
              {execution.error.message}
            </p>
          </div>
        </div>
      ) : null}

      {isPreview && result ? (
        <p className="text-sm" data-testid="code-preview-summary">
          {t("detectors.code.previewSummary", {
            sampled: result.sampled ?? samples.length,
            findings: result.findings ?? 0,
            failed: result.failed ?? 0,
          })}
        </p>
      ) : null}

      {samples.map((sample) => (
        <div
          key={sample.hash}
          className="space-y-2 rounded-[4px] border border-border p-3"
          data-testid="code-preview-asset-result"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{sample.name}</span>
            <Badge variant="outline" className="font-mono text-[10px]">
              {sample.kind || "asset"}
            </Badge>
            <Badge
              variant="outline"
              className={
                sample.status === "ok"
                  ? "text-[10px] uppercase"
                  : "border-destructive text-[10px] uppercase text-destructive"
              }
            >
              {sample.status === "ok"
                ? t("detectors.code.previewFindings", {
                    count: sample.findingCount,
                  })
                : t("detectors.code.previewFailed")}
            </Badge>
            {typeof sample.durationMs === "number" ? (
              <span className="text-xs text-muted-foreground">
                {sample.durationMs} ms
              </span>
            ) : null}
            {onCapture && sample.fixture && sample.status === "ok" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => onCapture(sample)}
                data-testid="code-preview-capture"
              >
                <FlaskConical className="mr-1.5 h-4 w-4" />
                {t("detectors.code.previewCapture")}
              </Button>
            ) : null}
          </div>
          {sample.error ? (
            <p className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">
              {sample.error}
            </p>
          ) : null}
          {sample.findings.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium">{t("detectors.code.colLabel")}</th>
                    <th className="py-1 pr-3 font-medium">{t("detectors.code.colValue")}</th>
                    <th className="py-1 pr-3 font-medium">{t("detectors.code.colSeverity")}</th>
                    <th className="py-1 pr-3 font-medium">{t("detectors.code.colLocation")}</th>
                    <th className="py-1 pr-3 font-medium">{t("detectors.code.colFields")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sample.findings.map((finding, index) => (
                    <tr key={index} className="border-t border-border/40 align-top">
                      <td className="py-1 pr-3 font-mono">
                        {finding.finding_type}
                        {finding.identity_key ? (
                          <span className="block text-muted-foreground">
                            #{finding.identity_key}
                          </span>
                        ) : null}
                      </td>
                      <td className="max-w-[18rem] break-words py-1 pr-3">
                        {finding.matched_content}
                        {typeof finding.metadata?.message === "string" ? (
                          <span className="block text-muted-foreground">
                            {finding.metadata.message}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1 pr-3 uppercase">{finding.severity}</td>
                      <td className="py-1 pr-3">{locationLabel(finding)}</td>
                      <td className="py-1 pr-3 font-mono">
                        {finding.extracted_data
                          ? JSON.stringify(finding.extracted_data)
                          : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {sample.warnings.length > 0 ? (
            <ul className="list-disc pl-5 text-xs text-amber-700 dark:text-amber-400">
              {sample.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}

      {isPreview && result?.logs ? (
        <details className="rounded-[4px] border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {t("detectors.code.previewLogs")}
          </summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-xs">
            {result.logs}
          </pre>
        </details>
      ) : null}
    </Card>
  );
}
