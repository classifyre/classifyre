"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

// Normalized metadata keys → i18n display labels. Source-specific keys not
// listed here fall back to a humanized version of the snake_case key.
const METADATA_KEY_TO_I18N: Record<string, TranslationKey> = {
  size_bytes: "assets.detail.assetMetadata.keys.size_bytes",
  row_count: "assets.detail.assetMetadata.keys.row_count",
  column_count: "assets.detail.assetMetadata.keys.column_count",
  column_names: "assets.detail.assetMetadata.keys.column_names",
  page_count: "assets.detail.assetMetadata.keys.page_count",
  mime_type: "assets.detail.assetMetadata.keys.mime_type",
  encoding: "assets.detail.assetMetadata.keys.encoding",
  author: "assets.detail.assetMetadata.keys.author",
  status: "assets.detail.assetMetadata.keys.status",
  tags: "assets.detail.assetMetadata.keys.tags",
  image_width: "assets.detail.assetMetadata.keys.image_width",
  image_height: "assets.detail.assetMetadata.keys.image_height",
  parse_error: "assets.detail.assetMetadata.keys.parse_error",
};

// Keys that carry a human-readable byte size and should be formatted as such.
const SIZE_KEYS = new Set(["size_bytes"]);

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return String(bytes);
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function renderValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  if (typeof value === "number") {
    if (SIZE_KEYS.has(key)) return formatBytes(value);
    return value.toLocaleString();
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

type Props = {
  metadata: Record<string, unknown> | null | undefined;
};

// A `{ columnName: typeName }` map (DB columns, parquet schema, Notion props).
function asColumnTypeMap(
  value: unknown,
): Record<string, string> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return null;
  if (!entries.every(([, v]) => typeof v === "string")) return null;
  return value as Record<string, string>;
}

export function AssetMetadataCard({ metadata }: Props) {
  const { t } = useTranslation();

  if (!metadata || typeof metadata !== "object") return null;

  const columnTypes = asColumnTypeMap(metadata["column_types"]);

  const entries = Object.entries(metadata).filter(([key, value]) => {
    // Rendered separately as a column schema table.
    if (key === "column_types") return false;
    // Redundant with the schema table when types are present.
    if (key === "column_names" && columnTypes) return false;
    return (
      value !== null &&
      value !== undefined &&
      value !== "" &&
      !(Array.isArray(value) && value.length === 0)
    );
  });

  if (entries.length === 0 && !columnTypes) return null;

  function formatKey(key: string): string {
    const i18nKey = METADATA_KEY_TO_I18N[key];
    if (i18nKey) return t(i18nKey);
    return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>{t("assets.detail.assetMetadata.title")}</CardTitle>
        <CardDescription>
          {t("assets.detail.assetMetadata.desc")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {entries.length > 0 && (
          <dl className="grid gap-2">
            {entries.map(([key, value]) => {
              const isError = key === "parse_error";
              return (
                <div
                  key={key}
                  className="grid grid-cols-[200px_1fr] items-start gap-3 rounded-[4px] border border-border/10 px-3 py-2"
                >
                  <dt className="text-xs font-medium text-muted-foreground pt-0.5">
                    {formatKey(key)}
                  </dt>
                  <dd
                    className={
                      isError
                        ? "text-sm break-words text-amber-600 dark:text-amber-500"
                        : "text-sm break-words"
                    }
                  >
                    {renderValue(key, value)}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}

        {columnTypes && <ColumnSchema columns={columnTypes} />}
      </CardContent>
    </Card>
  );
}

function ColumnSchema({ columns }: { columns: Record<string, string> }) {
  const { t } = useTranslation();
  const entries = Object.entries(columns);

  return (
    <div className="rounded-[4px] border border-border/10">
      <div className="flex items-center justify-between border-b border-border/10 px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t("assets.detail.assetMetadata.keys.column_names")}
        </span>
        <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
          {entries.length}
        </span>
      </div>
      <dl className="max-h-[280px] divide-y divide-border/10 overflow-auto">
        {entries.map(([name, type]) => (
          <div
            key={name}
            className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-1.5"
          >
            <dt className="truncate font-mono text-xs" title={name}>
              {name}
            </dt>
            <dd className="shrink-0 rounded-[3px] border border-border/40 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              {type}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
