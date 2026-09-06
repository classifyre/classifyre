"use client";

import * as React from "react";
import { FlaskConical } from "lucide-react";
import { AccordionContent } from "@workspace/ui/components/accordion";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Switch } from "@workspace/ui/components/switch";
import { useTranslation } from "@/hooks/use-translation";
import {
  KeyValueField,
  secretEntriesToPatch,
  secretKeysToEntries,
} from "@/components/key-value-field";
import type { KeyValueEntry } from "@/lib/key-value";
import { entriesToRecord, recordToEntries } from "@/lib/key-value";
import type { NotebookCell } from "@/lib/notebook-cells";
import {
  packagesToConfig,
  type NotebookPackage,
} from "@/lib/notebook-packages";
import {
  localFoldersToConfig,
  type NotebookLocalFolder,
} from "@/lib/notebook-local-folders";
import {
  NotebookEditor,
  type NotebookEditorHandle,
} from "./notebook-editor";
import { CellList } from "./cell-list";
import { PackageTable } from "./package-table";
import { AvailablePackages } from "./available-packages";
import { LocalFolders } from "./local-folders";
import { TemplatePicker } from "./template-picker";

/**
 * The augmentation section of a source form: an optional Python notebook that
 * enriches every asset the connector extracts — metadata, tags, links, URN,
 * relationship edges — after extraction and before detection.
 *
 * Built only from existing parts: the same NotebookEditor the CUSTOM source
 * uses (with the augmentation scope), the same package/folder/variable/secret
 * fields, the same template picker. Additive-only by server contract: it can
 * never change what the connector extracted, drop an asset, or fail a scan.
 */

export interface AugmentationValue {
  enabled?: boolean;
  notebook?: {
    revision?: number;
    cells?: NotebookCell[];
  };
  variables?: Record<string, string>;
  /** Write-only on the way back: blank means keep, null means delete. */
  secrets?: Record<string, string | null>;
  secretKeys?: string[];
  packages?: NotebookPackage[];
  local_folders?: NotebookLocalFolder[];
}

interface AugmentationDraft {
  enabled: boolean;
  revision: number | null;
  cells: NotebookCell[];
  packages: NotebookPackage[];
  variables: KeyValueEntry[];
  secrets: KeyValueEntry[];
  originalSecretKeys: string[];
  localFolders: NotebookLocalFolder[];
}

export interface AugmentationEditorHandle {
  getCells: () => NotebookCell[];
  setCells: (cells: NotebookCell[]) => void;
  run: NotebookEditorHandle["run"];
  runAndSummarize: NotebookEditorHandle["runAndSummarize"];
  cancel: () => void;
  save: () => Promise<number | null>;
}

function configToDraft(value: AugmentationValue | undefined): AugmentationDraft {
  if (!value || typeof value !== "object") {
    return {
      enabled: false,
      revision: null,
      cells: [],
      packages: [],
      variables: [],
      secrets: [],
      originalSecretKeys: [],
      localFolders: [],
    };
  }
  const secretKeys =
    value.secretKeys ?? Object.keys(value.secrets ?? {}).filter((key) => {
      // A null in a round-tripped value is a deletion, not a key the server
      // still holds.
      return value.secrets?.[key] !== null;
    });
  return {
    enabled: value.enabled ?? (value.notebook?.cells?.length ?? 0) > 0,
    revision:
      typeof value.notebook?.revision === "number"
        ? value.notebook.revision
        : null,
    cells: value.notebook?.cells ?? [],
    packages: value.packages ?? [],
    variables: recordToEntries(value.variables),
    secrets: secretKeysToEntries(secretKeys),
    originalSecretKeys: secretKeys,
    localFolders: value.local_folders ?? [],
  };
}

function draftToConfig(draft: AugmentationDraft): AugmentationValue {
  return {
    enabled: draft.enabled,
    notebook: {
      ...(draft.revision != null ? { revision: draft.revision } : {}),
      cells: draft.cells,
    },
    variables: entriesToRecord(draft.variables),
    secrets: secretEntriesToPatch(draft.secrets, draft.originalSecretKeys),
    packages: packagesToConfig(draft.packages),
    local_folders: localFoldersToConfig(draft.localFolders),
  };
}

export function AugmentationConfig({
  sourceId,
  value,
  onChange,
  disabled = false,
  editorRef,
  onBusyChange,
  onRunCell,
}: {
  sourceId?: string;
  value: AugmentationValue | undefined;
  onChange: (value: AugmentationValue | undefined) => void;
  disabled?: boolean;
  editorRef?: React.RefObject<AugmentationEditorHandle | null>;
  onBusyChange?: (busy: boolean) => void;
  onRunCell?: (cellId: string) => void;
}) {
  const { t } = useTranslation();
  const draft = React.useMemo(() => configToDraft(value), [value]);
  const editorHandleRef = React.useRef<NotebookEditorHandle | null>(null);

  const update = React.useCallback(
    (patch: Partial<AugmentationDraft>) => {
      onChange(draftToConfig({ ...draft, ...patch }));
    },
    [draft, onChange],
  );

  React.useImperativeHandle(
    editorRef,
    () => ({
      getCells: () => editorHandleRef.current?.getCells() ?? draft.cells,
      setCells: (cells) => {
        if (editorHandleRef.current) editorHandleRef.current.setCells(cells);
        else update({ cells });
      },
      run: (...args) =>
        editorHandleRef.current?.run(...args) ?? Promise.resolve(null),
      runAndSummarize: (...args) =>
        editorHandleRef.current?.runAndSummarize(...args) ??
        Promise.resolve(
          "There is no augmentation notebook on this source to run.",
        ),
      cancel: () => editorHandleRef.current?.cancel(),
      save: () => editorHandleRef.current?.save() ?? Promise.resolve(null),
    }),
    [draft.cells, update],
  );

  return (
    <div className="space-y-4" data-testid="augmentation-config">
      <p className="text-xs text-muted-foreground">
        {t("augmentation.intro")}{" "}
        <a
          href="/sources/augmentation"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          {t("augmentation.docsLink")}
        </a>
      </p>

      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2">
        <span className="text-sm font-medium">
          {t("augmentation.enableLabel")}
        </span>
        <Switch
          checked={draft.enabled}
          disabled={disabled}
          onCheckedChange={(enabled) => update({ enabled })}
          data-testid="augmentation-enabled"
        />
      </label>

      {draft.enabled && (
        <div className="space-y-4">
          {sourceId ? (
            <NotebookEditor
              sourceId={sourceId}
              scope="augmentation"
              cells={draft.cells}
              revision={draft.revision ?? 1}
              disabled={disabled}
              handleRef={editorHandleRef}
              onBusyChange={onBusyChange}
              onRunCell={onRunCell}
              onSaved={(revision) => update({ revision })}
              onCellsChange={(cells) => update({ cells })}
            />
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t("augmentation.saveSourceFirst")}
              </p>
              <CellList
                notebookId="augmentation-draft"
                cells={draft.cells}
                onChange={(cells) => update({ cells })}
                disabled={disabled}
              />
            </div>
          )}

          <Card>
            <CardContent className="space-y-4 pt-4">
              <PackageTable
                packages={draft.packages}
                onChange={(packages) => update({ packages })}
                disabled={disabled}
              />
              <AvailablePackages />
              <LocalFolders
                folders={draft.localFolders}
                onChange={(localFolders) => update({ localFolders })}
                disabled={disabled}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-4">
              <KeyValueField
                entries={draft.variables}
                onChange={(variables) => update({ variables })}
                label={t("notebook.config.variablesTitle")}
                description={t("notebook.config.variablesDescription")}
                emptyHint={t("notebook.config.variablesEmpty")}
                addLabel={t("notebook.config.addVariable")}
                keyPlaceholder="api_base"
                valuePlaceholder="https://api.example.com"
                disabled={disabled}
                testId="augmentation-variables"
              />
              <KeyValueField
                entries={draft.secrets}
                onChange={(secrets) => update({ secrets })}
                secret
                label={t("notebook.config.secretsTitle")}
                description={t("notebook.config.secretsDescription")}
                emptyHint={t("notebook.config.secretsEmpty")}
                addLabel={t("notebook.config.addSecret")}
                keyPlaceholder="api_token"
                disabled={disabled}
                testId="augmentation-secrets"
              />
            </CardContent>
          </Card>

          <TemplatePicker
            scope="augmentation"
            disabled={disabled}
            onInsert={(cells) => update({ cells: [...draft.cells, ...cells] })}
          />
        </div>
      )}
    </div>
  );
}

export function AugmentationAccordionBody(props: {
  sourceId?: string;
  value: AugmentationValue | undefined;
  onChange: (value: AugmentationValue | undefined) => void;
  disabled?: boolean;
  editorRef?: React.RefObject<AugmentationEditorHandle | null>;
  onBusyChange?: (busy: boolean) => void;
  onRunCell?: (cellId: string) => void;
}) {
  return (
    <AccordionContent>
      <div className="flex items-start gap-2 pb-2">
        <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <AugmentationConfig {...props} />
        </div>
      </div>
    </AccordionContent>
  );
}
