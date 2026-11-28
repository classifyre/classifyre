"use client";

import * as React from "react";
import {
  Download,
  Eye,
  EyeOff,
  FileCode2,
  FileJson,
  Grid3x3,
  Image as ImageIcon,
  LayoutGrid,
  Network,
  Sparkles,
  Trash2,
  Upload,
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
} from "@workspace/ui/components/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";

export interface CanvasFloatingToolbarProps {
  tableCount: number;
  hiddenCount: number;
  showHidden: boolean;
  onToggleShowHidden: () => void;
  onUnhideAll: () => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  canEdit: boolean;
  onArrangeConnected: () => void;
  onArrangeGrid: () => void;
  onFindLinks: () => void;
  onClearCanvas: () => void;
  onExportPng: (pixelRatio: 1 | 2, monochrome: boolean) => void;
  onExportSvg: () => void;
  onExportJson: () => void;
  onExportDbml?: () => void;
  onImportJson: (file: File) => void;
}

export function CanvasFloatingToolbar({
  tableCount,
  hiddenCount,
  showHidden,
  onToggleShowHidden,
  onUnhideAll,
  showGrid,
  onToggleGrid,
  canEdit,
  onArrangeConnected,
  onArrangeGrid,
  onFindLinks,
  onClearCanvas,
  onExportPng,
  onExportSvg,
  onExportJson,
  onExportDbml,
  onImportJson,
}: CanvasFloatingToolbarProps) {
  const { t } = useTranslation();
  const [confirmClear, setConfirmClear] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  return (
    <>
      <div
        className="flex items-center gap-0.5 rounded-[6px] border-2 border-border bg-card p-1"
        data-testid="vs-floating-toolbar"
      >
        {/* Hidden tables badge / toggle */}
        {hiddenCount > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex h-8 items-center gap-1 rounded-[3px] px-2 font-mono text-[11px] font-semibold transition-colors hover:bg-muted",
                  showHidden && "bg-foreground text-background hover:bg-foreground",
                )}
                title={t("visualSchema.toolbar.hiddenTables")}
                data-testid="vs-btn-hidden"
              >
                {showHidden ? (
                  <Eye className="size-3.5" />
                ) : (
                  <EyeOff className="size-3.5" />
                )}
                <span>{hiddenCount}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onToggleShowHidden}>
                {showHidden
                  ? t("visualSchema.toolbar.hideRevealed")
                  : t("visualSchema.toolbar.revealHidden")}
              </DropdownMenuItem>
              {canEdit && (
                <DropdownMenuItem onClick={onUnhideAll}>
                  {t("visualSchema.toolbar.unhideAll")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Grid Toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t("visualSchema.toolbar.grid")}
              aria-pressed={showGrid}
              onClick={onToggleGrid}
              className={cn(
                "flex size-8 items-center justify-center rounded-[3px] transition-colors hover:bg-muted",
                showGrid && "bg-foreground text-background hover:bg-foreground",
              )}
              data-testid="vs-btn-grid"
            >
              <Grid3x3 className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("visualSchema.toolbar.grid")}</TooltipContent>
        </Tooltip>

        {/* Auto-Arrange */}
        {canEdit && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={tableCount === 0}
                    aria-label={t("visualSchema.toolbar.arrange")}
                    className="flex size-8 items-center justify-center rounded-[3px] transition-colors hover:bg-muted disabled:opacity-40"
                    data-testid="vs-btn-arrange"
                  >
                    <LayoutGrid className="size-4" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t("visualSchema.toolbar.arrange")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={onArrangeConnected}
                data-testid="vs-arrange-elk"
              >
                <Network className="mr-2 size-3.5" />
                {t("visualSchema.toolbar.arrangeConnected")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onArrangeGrid}
                data-testid="vs-arrange-grid"
              >
                <LayoutGrid className="mr-2 size-3.5" />
                {t("visualSchema.toolbar.arrangeGrid")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Find Links */}
        {canEdit && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={tableCount < 2}
                aria-label={t("visualSchema.toolbar.findLinks")}
                onClick={onFindLinks}
                className="flex size-8 items-center justify-center rounded-[3px] transition-colors hover:bg-muted disabled:opacity-40"
                data-testid="vs-btn-find-links"
              >
                <Sparkles className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("visualSchema.toolbar.findLinks")}</TooltipContent>
          </Tooltip>
        )}

        {/* Clear Canvas */}
        {canEdit && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={tableCount === 0}
                aria-label={t("visualSchema.toolbar.clear")}
                onClick={() => setConfirmClear(true)}
                className="flex h-8 items-center gap-1 rounded-[3px] px-2 font-mono text-[11px] transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                data-testid="vs-btn-clear"
              >
                <Trash2 className="size-3.5" />
                {tableCount > 0 && <span className="tabular-nums">{tableCount}</span>}
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("visualSchema.toolbar.clear")}</TooltipContent>
          </Tooltip>
        )}

        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />

        {/* Export / Import */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t("visualSchema.toolbar.export")}
                  className="flex size-8 items-center justify-center rounded-[3px] transition-colors hover:bg-muted"
                  data-testid="vs-btn-export"
                >
                  <Download className="size-4" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t("visualSchema.toolbar.export")}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              disabled={tableCount === 0}
              onClick={() => onExportPng(1, false)}
            >
              <ImageIcon className="mr-2 size-3.5" />
              {t("visualSchema.export.png1x")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={tableCount === 0}
              onClick={() => onExportPng(2, false)}
            >
              <ImageIcon className="mr-2 size-3.5" />
              {t("visualSchema.export.png2x")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={tableCount === 0}
              onClick={() => onExportPng(2, true)}
            >
              <ImageIcon className="mr-2 size-3.5" />
              {t("visualSchema.export.pngBw")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={tableCount === 0}
              onClick={onExportSvg}
            >
              <ImageIcon className="mr-2 size-3.5" />
              {t("visualSchema.export.svg")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onExportJson} data-testid="vs-export-json">
              <FileJson className="mr-2 size-3.5" />
              {t("visualSchema.export.json")}
            </DropdownMenuItem>
            {onExportDbml && (
              <DropdownMenuItem
                disabled={tableCount === 0}
                onClick={onExportDbml}
                data-testid="vs-export-dbml"
              >
                <FileCode2 className="mr-2 size-3.5" />
                {t("visualSchema.export.dbml")}
              </DropdownMenuItem>
            )}
            {canEdit && (
              <DropdownMenuItem
                onClick={() => fileInputRef.current?.click()}
                data-testid="vs-import-json"
              >
                <Upload className="mr-2 size-3.5" />
                {t("visualSchema.export.importJson")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onImportJson(file);
          e.target.value = "";
        }}
      />

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("visualSchema.clearDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("visualSchema.clearDialog.body", { count: tableCount })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onClearCanvas();
                setConfirmClear(false);
              }}
              data-testid="vs-confirm-clear"
            >
              {t("visualSchema.toolbar.clear")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
