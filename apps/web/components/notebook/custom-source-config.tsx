"use client";

import * as React from "react";
import { api } from "@workspace/api-client";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@workspace/ui/components/accordion";
import { Badge } from "@workspace/ui/components/badge";
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
import {
  UploadedFiles,
  type UploadedFileMetadata,
} from "@/components/uploaded-files";
import { NotebookEditor, type NotebookEditorHandle } from "./notebook-editor";
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
import { CellList } from "./cell-list";
import type { NotebookCell } from "@/lib/notebook-cells";

export interface CustomSourceDraft {
  cells: NotebookCell[];
  revision: number;
  packages: NotebookPackage[];
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

/** The page-anchored sections a CUSTOM source is built from, in order. */
export const CUSTOM_SECTION_IDS = [
  "files",
  "packages",
  "variables",
  "notebook",
] as const;

export type CustomSectionId = (typeof CUSTOM_SECTION_IDS)[number];

export interface CustomSourceConfigProps {
  /** Absent only while a non-CUSTOM flow reuses this; a CUSTOM source is saved first. */
  sourceId?: string;
  draft: CustomSourceDraft;
  onChange: (draft: CustomSourceDraft) => void;
  disabled?: boolean;
  /** Files already stored on the source. */
  files?: UploadedFileMetadata[];
  onFilesChange?: (files: UploadedFileMetadata[]) => void;
  notebookRef?: React.RefObject<NotebookEditorHandle | null>;
  /** Told when the notebook starts or stops executing. */
  onBusyChange?: (busy: boolean) => void;
  /** Run controls live in the page's sticky toolbar, which owns save-then-run. */
  onRunCell?: (cellId: string) => void;
  /** Anchors for the page's stepper. */
  sectionRef?: (id: CustomSectionId, element: HTMLElement | null) => void;
}

/**
 * Everything a CUSTOM source is, other than its name.
 *
 * Grouped rather than stacked: a notebook author touches the notebook
 * constantly and the three supporting sections rarely, so data (files and
 * folders), dependencies (packages) and configuration (variables and secrets)
 * each get one section, and the notebook gets the rest of the page. The data
 * section is an accordion that opens only when it holds something — an empty
 * dropzone above the code is noise on the many connectors that call an API and
 * never touch a file.
 */
export function CustomSourceConfig({
  sourceId,
  draft,
  onChange,
  disabled = false,
  files = [],
  onFilesChange,
  notebookRef,
  onBusyChange,
  onRunCell,
  sectionRef,
}: CustomSourceConfigProps) {
  const { t } = useTranslation();
  const patch = (changes: Partial<CustomSourceDraft>) =>
    onChange({ ...draft, ...changes });

  const dataCount = files.length + draft.localFolders.length;
  // Opened when there is something in it, closed when there is not — decided on
  // the first render for this source and then left to the user, so their own
  // collapse is not undone by the next upload.
  const [openSections, setOpenSections] = React.useState<string[]>(() =>
    dataCount > 0 ? ["files"] : [],
  );
  const seededRef = React.useRef(dataCount > 0);
  React.useEffect(() => {
    if (seededRef.current || dataCount === 0) return;
    seededRef.current = true;
    setOpenSections((current) =>
      current.includes("files") ? current : [...current, "files"],
    );
  }, [dataCount]);

  const configCount = draft.variables.length + draft.secrets.length;

  return (
    <div className="space-y-6">
      <section
        ref={(element) => sectionRef?.("files", element)}
        data-testid="notebook-files-config"
      >
        <Accordion
          type="multiple"
          value={openSections}
          onValueChange={setOpenSections}
        >
          <AccordionItem value="files">
            <AccordionTrigger
              caption={t("notebook.data.description")}
              action={
                dataCount > 0 ? (
                  <Badge
                    variant="outline"
                    className="rounded-[4px] border-primary-foreground/40 font-mono text-[10px] text-primary-foreground"
                    data-testid="notebook-data-count"
                  >
                    {t("notebook.data.count", { count: dataCount })}
                  </Badge>
                ) : null
              }
              data-testid="notebook-data-trigger"
            >
              {t("notebook.data.title")}
            </AccordionTrigger>
            <AccordionContent className="space-y-6">
              <div>
                <h4 className="text-sm font-semibold">
                  {t("sources.uploadedFiles.title")}
                </h4>
                <p className="mb-3 mt-1 text-xs text-muted-foreground">
                  {t("notebook.files.hint")}
                </p>
                <UploadedFiles
                  existingFiles={files}
                  sourceId={sourceId}
                  onFilesChange={onFilesChange}
                  disabled={disabled}
                />
              </div>
              <LocalFolders
                folders={draft.localFolders}
                onChange={(localFolders) => patch({ localFolders })}
                disabled={disabled}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>

      <Card ref={(element) => sectionRef?.("packages", element)}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {t("notebook.packages.title")}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("notebook.packages.description")}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <PackageTable
            packages={draft.packages}
            onChange={(packages) => patch({ packages })}
            disabled={disabled}
          />
          <AvailablePackages />
        </CardContent>
      </Card>

      <Card ref={(element) => sectionRef?.("variables", element)}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {t("notebook.config.title")}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("notebook.config.description", { count: configCount })}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
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

      <Card ref={(element) => sectionRef?.("notebook", element)}>
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
              handleRef={notebookRef}
              onBusyChange={onBusyChange}
              onRunCell={onRunCell}
              onSaved={(revision) => patch({ revision })}
              onCellsChange={(cells) => patch({ cells })}
            />
          ) : (
            <DraftNotebook
              cells={draft.cells}
              disabled={disabled}
              handleRef={notebookRef}
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
 * A CUSTOM source is saved the moment its starting point is chosen, so this is
 * only reached by a flow that reuses the config without one. Same cells and the
 * same editing controls — it is the same component — but no Run: an execution
 * names a revision of a stored notebook.
 */
function DraftNotebook({
  cells,
  disabled,
  handleRef,
  onChange,
}: {
  cells: NotebookCell[];
  disabled: boolean;
  handleRef?: React.RefObject<NotebookEditorHandle | null>;
  onChange: (cells: NotebookCell[]) => void;
}) {
  const { t } = useTranslation();
  const cellsRef = React.useRef(cells);
  cellsRef.current = cells;

  React.useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      getCells: () => cellsRef.current,
      setCells: onChange,
      // Nothing to run against: an execution names a revision of a stored
      // notebook, and there is no stored source in this path.
      run: async () => null,
      runAndSummarize: async () =>
        "This source has not been saved yet, so there is no notebook to run.",
      cancel: () => undefined,
      save: async () => null,
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, onChange]);

  return (
    <div className="space-y-3" data-testid="notebook-draft">
      <p className="text-xs text-muted-foreground">{t("notebook.draftNote")}</p>
      <CellList
        notebookId="draft"
        cells={cells}
        onChange={onChange}
        disabled={disabled}
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
