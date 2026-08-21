"use client";

import * as React from "react";
import { api } from "@workspace/api-client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { useTranslation } from "@/hooks/use-translation";
import {
  KeyValueField,
  entriesToRecord,
  recordToEntries,
  secretKeysToEntries,
  type KeyValueEntry,
} from "@/components/key-value-field";
import { isDesktopRuntime } from "@/lib/desktop";
import { NotebookEditor } from "./notebook-editor";
import { PackageTable } from "./package-table";
import { AvailablePackages } from "./available-packages";
import { LocalFolders } from "./local-folders";
import {
  packagesToConfig,
  type NotebookPackage,
} from "@/lib/notebook-packages";
import {
  localFoldersToConfig,
  type NotebookLocalFolder,
} from "@/lib/notebook-local-folders";
import { CellList, type NotebookAiConfig } from "./cell-list";
import type { NotebookCell } from "@/lib/notebook-cells";

export interface CustomSourceDraft {
  cells: NotebookCell[];
  revision: number;
  packages: NotebookPackage[];
  /** Desktop only; the API refuses to save these in a Kubernetes deployment. */
  localFolders: NotebookLocalFolder[];
  variables: KeyValueEntry[];
  secrets: KeyValueEntry[];
  /** Secret names the server already holds, so a save can tell edits from deletions. */
  originalSecretKeys: string[];
}

export function emptyDraft(): CustomSourceDraft {
  return {
    cells: [],
    revision: 1,
    packages: [],
    localFolders: [],
    variables: [],
    secrets: [],
    originalSecretKeys: [],
  };
}

/**
 * Load the starter cells from the API.
 *
 * Fetched rather than bundled so the scaffold, the contract, and the CLI's own
 * copy stay one thing: they all read the same example, and a change to what a
 * connector must define shows up here without a frontend release.
 */
export async function loadScaffold(): Promise<NotebookCell[]> {
  const scaffold =
    (await api.notebooks.notebookControllerScaffold()) as unknown as {
      cells: NotebookCell[];
    };
  return scaffold.cells;
}

export interface CustomSourceConfigProps {
  /** Absent while creating: there is nothing to save against or execute on yet. */
  sourceId?: string;
  draft: CustomSourceDraft;
  onChange: (draft: CustomSourceDraft) => void;
  disabled?: boolean;
  /** The file uploader, owned by the page that persists uploads. */
  filesSlot?: React.ReactNode;
}

export function CustomSourceConfig({
  sourceId,
  draft,
  onChange,
  disabled = false,
  filesSlot,
}: CustomSourceConfigProps) {
  const { t } = useTranslation();
  // Local folders are paths on the machine running the app. There is no such
  // machine behind a browser tab talking to a cluster, and the API refuses to
  // save them there -- so the control is not offered either.
  const [desktop, setDesktop] = React.useState(false);
  React.useEffect(() => setDesktop(isDesktopRuntime()), []);

  const patch = (changes: Partial<CustomSourceDraft>) =>
    onChange({ ...draft, ...changes });

  // What the AI helper is shown. Secret *names* only — the browser is never
  // sent the values, so there is nothing here to leak even by accident.
  const ai = {
    packages: draft.packages,
    variables: entriesToRecord(draft.variables),
    secretKeys: draft.secrets.map((entry) => entry.key).filter(Boolean),
  };

  return (
    <div className="space-y-6">
      {(filesSlot || desktop) && (
        <div className="space-y-6" data-testid="notebook-files-config">
          {filesSlot}
          {filesSlot && (
            <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {t("notebook.files.hint")}
            </p>
          )}
          {desktop && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {t("notebook.folders.title")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <LocalFolders
                  folders={draft.localFolders}
                  onChange={(localFolders) => patch({ localFolders })}
                  disabled={disabled}
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {t("notebook.config.variablesTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <PackageTable
            packages={draft.packages}
            onChange={(packages) => patch({ packages })}
            disabled={disabled}
          />
          <AvailablePackages />
          <KeyValueField
            entries={draft.variables}
            onChange={(variables) => patch({ variables })}
            label={t("notebook.config.variablesTitle")}
            description={t("notebook.config.variablesDescription")}
            emptyHint={t("notebook.config.variablesEmpty")}
            addLabel={t("notebook.config.addVariable")}
            keyPlaceholder="api_base"
            valuePlaceholder="https://api.example.com"
            disabled={disabled}
            testId="notebook-variables"
          />
          <KeyValueField
            entries={draft.secrets}
            onChange={(secrets) => patch({ secrets })}
            secret
            label={t("notebook.config.secretsTitle")}
            description={t("notebook.config.secretsDescription")}
            emptyHint={t("notebook.config.secretsEmpty")}
            addLabel={t("notebook.config.addSecret")}
            keyPlaceholder="api_token"
            disabled={disabled}
            testId="notebook-secrets"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("notebook.title")}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("notebook.description")}
          </p>
        </CardHeader>
        <CardContent>
          {sourceId ? (
            <NotebookEditor
              sourceId={sourceId}
              cells={draft.cells}
              revision={draft.revision}
              disabled={disabled}
              ai={ai}
              onSaved={(revision) => patch({ revision })}
              onCellsChange={(cells) => patch({ cells })}
            />
          ) : (
            // Before the source exists there is nothing to save against and
            // nothing to run: the cells travel with the create request instead.
            <DraftNotebook
              cells={draft.cells}
              disabled={disabled}
              ai={ai}
              onChange={(cells) => patch({ cells })}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The notebook before the source exists.
 *
 * Same cells and the same editing controls as the saved editor -- it is the same
 * component -- but no Run and no autosave: an execution names a revision of a
 * stored notebook, and there is not one yet. The cells travel with the create
 * request instead.
 */
function DraftNotebook({
  cells,
  disabled,
  ai,
  onChange,
}: {
  cells: NotebookCell[];
  disabled: boolean;
  ai: NotebookAiConfig;
  onChange: (cells: NotebookCell[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3" data-testid="notebook-draft">
      <p className="text-xs text-muted-foreground">{t("notebook.draftNote")}</p>
      <CellList
        notebookId="draft"
        cells={cells}
        onChange={onChange}
        disabled={disabled}
        ai={ai}
      />
    </div>
  );
}

/** Fold the draft into the config a create/update request expects. */
export function draftToConfig(
  draft: CustomSourceDraft,
): Record<string, unknown> {
  const secrets: Record<string, string> = {};
  for (const entry of draft.secrets) {
    // A blank value on an existing secret means "leave it alone", and there is
    // no stored value here to leave alone -- so it is simply omitted.
    if (entry.key.trim() && entry.value !== "")
      secrets[entry.key] = entry.value;
  }
  return {
    required: {
      notebook: { revision: draft.revision, cells: draft.cells },
    },
    masked: { secrets },
    optional: {
      variables: entriesToRecord(draft.variables),
      packages: packagesToConfig(draft.packages),
      local_folders: localFoldersToConfig(draft.localFolders),
    },
  };
}

/** Build a draft from an existing source's config plus the notebook endpoint. */
export function draftFromNotebook(notebook: {
  revision: number;
  cells: NotebookCell[];
  packages?: NotebookPackage[];
  localFolders?: NotebookLocalFolder[];
  variables?: Record<string, string>;
  secretKeys?: string[];
}): CustomSourceDraft {
  return {
    cells: notebook.cells,
    revision: notebook.revision,
    packages: notebook.packages ?? [],
    localFolders: notebook.localFolders ?? [],
    variables: recordToEntries(notebook.variables),
    secrets: secretKeysToEntries(notebook.secretKeys),
    originalSecretKeys: notebook.secretKeys ?? [],
  };
}
