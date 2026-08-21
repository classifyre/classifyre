"use client";

import * as React from "react";
import { FolderTree, Plus, X } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { FolderPathInput } from "@/components/folder-path-input";
import {
  validateLocalFolder,
  type NotebookLocalFolder,
} from "@/lib/notebook-local-folders";

/**
 * Folders on this machine a notebook may read, as `ctx.folder("name")`.
 *
 * Desktop only, and the caller decides that -- in Kubernetes the runner is a
 * pod with none of your filesystem, and the API refuses to save a source that
 * carries folders there. Uploading the files to the source is the mechanism
 * that works everywhere.
 *
 * A name and a path rather than a bare path: the notebook refers to the folder
 * by name, so moving the directory is a change to this form rather than an edit
 * to the connector's code.
 */
export function LocalFolders({
  folders,
  onChange,
  disabled = false,
}: {
  folders: NotebookLocalFolder[];
  onChange: (folders: NotebookLocalFolder[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  const update = (index: number, patch: Partial<NotebookLocalFolder>) =>
    onChange(
      folders.map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry,
      ),
    );

  return (
    <div className="space-y-3" data-testid="notebook-local-folders">
      <div>
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <FolderTree className="h-3.5 w-3.5 text-muted-foreground" />
          {t("notebook.folders.title")}
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("notebook.folders.description")}
        </p>
      </div>

      {folders.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("notebook.folders.empty")}
        </p>
      ) : (
        <div className="space-y-2">
          {folders.map((entry, index) => {
            const issue = validateLocalFolder(folders, index);
            const error = issue
              ? t(`notebook.folders.${issue}` as never)
              : null;
            return (
              <div key={index} className="space-y-1">
                <div className="flex items-start gap-2">
                  <Input
                    value={entry.name}
                    onChange={(event) =>
                      update(index, { name: event.target.value })
                    }
                    placeholder="dumps"
                    disabled={disabled}
                    autoComplete="off"
                    spellCheck={false}
                    className={cn(
                      "w-40 font-mono text-sm",
                      error && "border-destructive",
                    )}
                    aria-invalid={error ? true : undefined}
                    data-testid={`folder-name-${index}`}
                  />
                  <FolderPathInput
                    value={entry.path}
                    onChange={(path) => update(index, { path })}
                    placeholder={t("notebook.folders.pathPlaceholder")}
                    disabled={disabled}
                    className="flex-1"
                    testId={`folder-path-${index}`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      onChange(
                        folders.filter((_, position) => position !== index),
                      )
                    }
                    disabled={disabled}
                    aria-label={t("common.remove")}
                    data-testid={`folder-remove-${index}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {error && (
                  <p className="text-xs font-medium text-destructive">
                    {error}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...folders, { name: "", path: "" }])}
        disabled={disabled}
        data-testid="folder-add"
      >
        <Plus className="mr-2 h-4 w-4" />
        {t("notebook.folders.add")}
      </Button>
    </div>
  );
}
