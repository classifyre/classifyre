"use client";

import { Download } from "lucide-react";
import { Button } from "@workspace/ui/components";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { useTranslation } from "@/hooks/use-translation";
import type { ExportFormat } from "@/lib/data-query";

const LABEL: Record<
  ExportFormat,
  "dataQuery.export.xlsx" | "dataQuery.export.csv" | "dataQuery.export.parquet"
> = {
  xlsx: "dataQuery.export.xlsx",
  csv: "dataQuery.export.csv",
  parquet: "dataQuery.export.parquet",
};

/**
 * The one Export control: a button that opens the formats this export can
 * write — the SQL results' three, or the asset and finding lists' CSV. The
 * same words and look wherever data leaves the app.
 */
export function ExportMenu({
  formats,
  onExport,
  disabled = false,
  testId = "export",
}: {
  formats: readonly ExportFormat[];
  onExport: (format: ExportFormat) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={disabled}
          data-testid={testId}
        >
          <Download className="h-4 w-4" />
          {t("dataQuery.export.button")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {formats.map((format) => (
          <DropdownMenuItem
            key={format}
            data-testid={`export-${format}`}
            onSelect={() => onExport(format)}
          >
            {t(LABEL[format])}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
