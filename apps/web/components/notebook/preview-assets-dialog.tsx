"use client";

import * as React from "react";
import { Inbox } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { AssetKindBadge } from "../asset-kind-badge";

/**
 * One asset of an `extract()` sample.
 *
 * The CLI's preview path (`_call_extract` in `apps/cli/src/notebook/execute.py`)
 * is the only producer, so this mirrors its keys rather than the persisted
 * asset row: id, name, url, kind, contentType, a 2000-char contentPreview with
 * its full contentLength, and the metadata/links/extract maps.
 */
export interface PreviewAsset {
  id?: unknown;
  name?: unknown;
  url?: unknown;
  kind?: unknown;
  contentType?: unknown;
  contentPreview?: unknown;
  contentLength?: unknown;
  metadata?: unknown;
  links?: unknown;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function countEntries(value: unknown): number {
  return value && typeof value === "object" ? Object.keys(value).length : 0;
}

function countItems(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * What `extract()` yielded, as a table.
 *
 * The assets-table page is built for persisted search results (filters, sort,
 * pagination, findings joins) — none of which a bounded in-memory sample has —
 * so this reuses its row primitives (kind badge, text truncation) on the plain
 * `Table` the page itself is built from, rather than forcing the page's props
 * (`scope`, `SearchAssetsRequestInputDto`) onto a preview shape.
 */
export function PreviewAssetsDialog({
  open,
  assets,
  onOpenChange,
}: {
  open: boolean;
  assets: PreviewAsset[];
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = React.useState<string | null>(null);

  // A new preview replaces the rows — an expansion of the old sample must not
  // survive into it.
  React.useEffect(() => {
    if (open) setExpanded(null);
  }, [open, assets]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto rounded-[6px] border-2 border-border sm:max-w-3xl"
        data-testid="preview-assets-dialog"
      >
        <DialogHeader className="text-left">
          <DialogTitle>{t("notebook.previewTitle", { count: assets.length })}</DialogTitle>
          <DialogDescription>{t("notebook.previewDialogHint")}</DialogDescription>
        </DialogHeader>

        {assets.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={t("notebook.previewEmpty")}
            description={t("notebook.previewDialogEmptyHint")}
          />
        ) : (
          <div className="overflow-auto rounded-[4px] border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("notebook.previewColumns.asset")}</TableHead>
                  <TableHead>{t("notebook.previewColumns.kind")}</TableHead>
                  <TableHead>{t("notebook.previewColumns.content")}</TableHead>
                  <TableHead className="text-right">
                    {t("notebook.previewColumns.enrichment")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.map((asset, index) => {
                  const key = String(asset.id ?? asset.name ?? index);
                  const name =
                    text(asset.name) ?? text(asset.id) ?? `#${index + 1}`;
                  const url = text(asset.url);
                  const contentType = text(asset.contentType);
                  const preview = text(asset.contentPreview);
                  const contentLength =
                    typeof asset.contentLength === "number"
                      ? asset.contentLength
                      : null;
                  const isOpen = expanded === key;
                  return (
                    <React.Fragment key={`${key}-${index}`}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() =>
                          setExpanded((current) =>
                            current === key ? null : key,
                          )
                        }
                        data-testid="preview-asset-row"
                      >
                        <TableCell className="max-w-[260px]">
                          <div className="truncate text-sm font-medium">
                            {name}
                          </div>
                          {url && (
                            <div className="truncate text-xs text-muted-foreground">
                              {url}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <AssetKindBadge
                            kind={
                              typeof asset.kind === "string"
                                ? asset.kind
                                : null
                            }
                          />
                        </TableCell>
                        <TableCell className="max-w-[320px]">
                          {preview ? (
                            <code className="line-clamp-2 break-all text-[11px] text-muted-foreground">
                              {preview}
                            </code>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {[
                              contentType,
                              contentLength != null
                                ? t("notebook.previewChars", {
                                    count: contentLength,
                                  })
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {t("notebook.previewEnrichment", {
                            metadata: countEntries(asset.metadata),
                            links: countItems(asset.links),
                          })}
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow data-testid="preview-asset-detail">
                          <TableCell colSpan={4} className="bg-muted/15">
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all p-2 font-mono text-[11px]">
                              {JSON.stringify(asset, null, 2)}
                            </pre>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter className="sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="preview-assets-close"
          >
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
