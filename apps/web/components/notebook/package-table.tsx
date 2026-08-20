"use client";

import * as React from "react";
import { Package, Plus, X } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { validatePackage, type NotebookPackage } from "@/lib/notebook-packages";

// Re-exported so the table and its rules are importable from one place.
export {
  PACKAGE_NAME_PATTERN,
  PACKAGE_VERSION_PATTERN,
  packageEntriesAreValid,
  packagesToConfig,
} from "@/lib/notebook-packages";
export type { NotebookPackage } from "@/lib/notebook-packages";

/**
 * The packages a notebook needs, installed before its first cell runs.
 *
 * A table rather than a requirements textarea: the two fields that matter are
 * the name and the version, and a free-text box invites the rest of PEP 508 --
 * extras, markers, direct URLs -- none of which the runtime accepts.
 */
export function PackageTable({
  packages,
  onChange,
  disabled = false,
}: {
  packages: NotebookPackage[];
  onChange: (packages: NotebookPackage[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  const problem = (index: number): string | null => {
    const issue = validatePackage(packages, index);
    return issue ? t(`notebook.packages.${issue}` as never) : null;
  };

  const update = (index: number, patch: Partial<NotebookPackage>) =>
    onChange(
      packages.map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry,
      ),
    );

  return (
    <div className="space-y-3" data-testid="notebook-packages">
      <div>
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <Package className="h-3.5 w-3.5 text-muted-foreground" />
          {t("notebook.packages.title")}
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("notebook.packages.description")}
        </p>
      </div>

      {packages.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("notebook.packages.empty")}
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <div className="grid grid-cols-[2fr_1fr_auto] gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>{t("notebook.packages.name")}</span>
            <span>{t("notebook.packages.version")}</span>
            <span className="w-8" />
          </div>
          {packages.map((entry, index) => {
            const error = problem(index);
            return (
              <div key={index} className="border-b last:border-b-0">
                <div className="grid grid-cols-[2fr_1fr_auto] items-center gap-2 px-3 py-2">
                  <Input
                    value={entry.name}
                    onChange={(event) =>
                      update(index, { name: event.target.value })
                    }
                    placeholder="pandas"
                    disabled={disabled}
                    autoComplete="off"
                    spellCheck={false}
                    className={cn(
                      "h-8 font-mono text-sm",
                      error && "border-destructive",
                    )}
                    aria-invalid={error ? true : undefined}
                    data-testid={`package-name-${index}`}
                  />
                  <Input
                    value={entry.version ?? ""}
                    onChange={(event) =>
                      update(index, { version: event.target.value })
                    }
                    // Empty means latest, which is the common case.
                    placeholder={t("notebook.packages.latest")}
                    disabled={disabled}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-8 font-mono text-sm"
                    data-testid={`package-version-${index}`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() =>
                      onChange(
                        packages.filter((_, position) => position !== index),
                      )
                    }
                    disabled={disabled}
                    aria-label={t("common.remove")}
                    data-testid={`package-remove-${index}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {error && (
                  <p className="px-3 pb-2 text-xs font-medium text-destructive">
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
        onClick={() => onChange([...packages, { name: "", version: "" }])}
        disabled={disabled}
        data-testid="package-add"
      >
        <Plus className="mr-2 h-4 w-4" />
        {t("notebook.packages.add")}
      </Button>
    </div>
  );
}
