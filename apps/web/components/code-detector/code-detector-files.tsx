"use client";

import * as React from "react";
import { api, type CustomDetectorFileDto } from "@workspace/api-client";
import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button, Card } from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Files a code detector reads with `ctx.file(name)`: a screening list, a
 * model, a reference table. Stored with the detector, so every source it is
 * attached to reads the same file. Uploading a name that exists replaces it.
 */
export function CodeDetectorFiles({
  detectorId,
  disabled,
  onChanged,
}: {
  detectorId: string;
  disabled?: boolean;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [files, setFiles] = React.useState<CustomDetectorFileDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [uploading, setUploading] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const load = React.useCallback(async () => {
    try {
      setFiles(
        await api.customDetectors.customDetectorsControllerListFiles({
          id: detectorId,
        }),
      );
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("detectors.code.filesLoadFailed")));
    } finally {
      setLoading(false);
    }
  }, [detectorId, t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      await api.uploadCustomDetectorFile(detectorId, file);
      toast.success(t("detectors.code.fileUploaded", { name: file.name }));
      await load();
      onChanged?.();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("detectors.code.fileUploadFailed")));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (file: CustomDetectorFileDto) => {
    try {
      await api.customDetectors.customDetectorsControllerDeleteFile({
        id: detectorId,
        fileId: file.id,
      });
      await load();
      onChanged?.();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("detectors.code.fileDeleteFailed")));
    }
  };

  return (
    <Card className="p-6 space-y-4 border-2 border-border" data-testid="code-detector-files">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif font-black uppercase tracking-wide text-base">
            {t("detectors.code.filesTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("detectors.code.filesHint")}
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          data-testid="code-detector-file-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          {t("detectors.code.fileUpload")}
        </Button>
      </div>
      {loading ? null : files.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("detectors.code.filesEmpty")}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-[4px] border border-border">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <code className="font-mono">{file.fileName}</code>
              <span className="text-xs text-muted-foreground">
                {formatBytes(file.fileSizeBytes)}
              </span>
              <code className="ml-auto hidden font-mono text-[10px] text-muted-foreground md:inline">
                ctx.file(&quot;{file.fileName}&quot;)
              </code>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => void remove(file)}
                aria-label={t("common.delete")}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
