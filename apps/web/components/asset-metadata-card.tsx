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

export function AssetMetadataCard({ metadata }: Props) {
  const { t } = useTranslation();

  if (!metadata || typeof metadata !== "object") return null;

  const entries = Object.entries(metadata).filter(
    ([, value]) =>
      value !== null &&
      value !== undefined &&
      value !== "" &&
      !(Array.isArray(value) && value.length === 0),
  );

  if (entries.length === 0) return null;

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
      <CardContent>
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
      </CardContent>
    </Card>
  );
}
