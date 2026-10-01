"use client";

import * as React from "react";
import { api } from "@workspace/api-client";
import { AlertTriangle, Code2, Loader2, Play, Plus, Square, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { StickyActionToolbar } from "@/components/sticky-action-toolbar";
import { KeyValueField } from "@/components/key-value-field";
import { CellList } from "@/components/notebook/cell-list";
import { PackageTable } from "@/components/notebook/package-table";
import { AvailablePackages } from "@/components/notebook/available-packages";
import type { CellOutputValue } from "@/components/notebook/cell-output";
import type { CellStatus } from "@/components/notebook/code-cell";
import {
  useNotebookExecution,
  type ExecutionRecord,
} from "@/components/notebook/use-notebook-execution";
import { CodeDetectorFiles } from "@/components/code-detector/code-detector-files";
import { CodeDetectorPreview } from "@/components/code-detector/code-detector-preview";
import {
  CodeDetectorTests,
  type CapturedScenario,
} from "@/components/code-detector/code-detector-tests";
import { keyValueEntriesAreValid } from "@/lib/key-value";
import {
  ASSET_KINDS,
  CODE_DETECTOR_CATEGORIES,
  CODE_DETECTOR_FIELD_TYPES,
  SEVERITY_CEILINGS,
  draftProblems,
  draftToSchema,
  schemaToDraft,
  type CodeDetectorDraft,
  type CodeDetectorFieldType,
  type SeverityCeiling,
} from "@/lib/code-detector";
import type { NotebookCell } from "@/lib/notebook-cells";

export interface CodeDetectorEditorProps {
  mode: "create" | "edit";
  detectorId?: string;
  submitLabel: string;
  isSubmitting?: boolean;
  initialName?: string;
  initialKey?: string;
  initialDescription?: string;
  initialIsActive?: boolean;
  initialPipelineSchema?: Record<string, unknown>;
  initialSecretKeys?: string[];
  embedded?: boolean;
  onSubmit: (payload: {
    name: string;
    key?: string;
    description?: string;
    isActive?: boolean;
    pipelineSchema: Record<string, unknown>;
  }) => void | Promise<void>;
}

export interface CodeDetectorEditorHandle {
  submit: () => Promise<void>;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-serif font-black uppercase tracking-wide text-base">
      {children}
    </h2>
  );
}

/**
 * A code detector (pipeline type CODE_DETECTOR): a Python notebook that
 * defines `detect(asset, ctx)` and yields findings.
 *
 * Built from the notebook editor's parts -- cells, packages, variables and
 * secrets -- plus what only a detector has: a severity ceiling, a category,
 * declared output fields, uploaded files, a preview on a real asset and test
 * scenarios. Saving is explicit; running always runs the saved revision, so a
 * run first saves if the form has changed.
 */
export const CodeDetectorEditor = React.forwardRef<
  CodeDetectorEditorHandle,
  CodeDetectorEditorProps
>(function CodeDetectorEditor(
  {
    mode,
    detectorId,
    submitLabel,
    isSubmitting,
    initialName,
    initialKey,
    initialDescription,
    initialIsActive,
    initialPipelineSchema,
    initialSecretKeys,
    embedded,
    onSubmit,
  },
  ref,
) {
  const { t } = useTranslation();
  const [name, setName] = React.useState(initialName ?? "");
  const [key, setKey] = React.useState(initialKey ?? "");
  const [description, setDescription] = React.useState(initialDescription ?? "");
  const [isActive, setIsActive] = React.useState(initialIsActive ?? true);
  const [draft, setDraft] = React.useState<CodeDetectorDraft>(() =>
    schemaToDraft(initialPipelineSchema, initialSecretKeys ?? []),
  );
  const [dirty, setDirty] = React.useState(false);
  const [captured, setCaptured] = React.useState<CapturedScenario | null>(null);
  const [runError, setRunError] = React.useState<string | null>(null);

  // A new detector from the parent (after a save and reload) resets the form.
  React.useEffect(() => {
    setDraft(schemaToDraft(initialPipelineSchema, initialSecretKeys ?? []));
    setDirty(false);
  }, [initialPipelineSchema, initialSecretKeys]);

  const update = React.useCallback((patch: Partial<CodeDetectorDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
  }, []);

  React.useEffect(() => {
    // The starter notebook, for a detector created without a template.
    if (mode !== "create" || draft.cells.length > 0) return;
    let active = true;
    api.notebooks
      .notebookControllerScaffold({ scope: "detector" as never })
      .then((scaffold) => {
        if (!active) return;
        const cells = (scaffold as unknown as { cells: NotebookCell[] }).cells;
        setDraft((current) =>
          current.cells.length > 0 ? current : { ...current, cells },
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [mode, draft.cells.length]);

  const problems = draftProblems(draft);
  const keysValid =
    keyValueEntriesAreValid(draft.variables) &&
    keyValueEntriesAreValid(draft.secrets);
  const effectiveKey = key || toSlug(name);
  const canSubmit =
    !isSubmitting && name.trim().length > 0 && problems.length === 0 && keysValid;

  const payload = React.useCallback(
    () => ({
      name,
      key: effectiveKey,
      description,
      isActive,
      pipelineSchema: draftToSchema(draft, initialPipelineSchema),
    }),
    [name, effectiveKey, description, isActive, draft, initialPipelineSchema],
  );

  const handleSubmit = React.useCallback(async () => {
    if (!canSubmit) throw new Error("Validation failed");
    await onSubmit(payload());
    setDirty(false);
  }, [canSubmit, onSubmit, payload]);

  React.useImperativeHandle(ref, () => ({ submit: handleSubmit }));

  // -- executions (edit mode) ---------------------------------------------------

  const start = React.useCallback(
    async (request: Record<string, unknown>) =>
      (await api.notebooks.notebookControllerCreateDetectorExecution({
        detectorId: detectorId ?? "",
        createDetectorNotebookExecutionDto: request as never,
      })) as unknown as ExecutionRecord,
    [detectorId],
  );
  const { execution, run, cancel, busy } = useNotebookExecution(detectorId ?? "", {
    start,
  });

  /** Save when needed, then read back the revision the server assigned. */
  const savedRevision = React.useCallback(async (): Promise<number | null> => {
    if (!detectorId) return null;
    if (dirty) {
      if (!canSubmit) return null;
      await handleSubmit();
    }
    const fresh = await api.getCustomDetector(detectorId);
    const schema = (
      fresh as unknown as {
        pipelineSchema?: { notebook?: { revision?: unknown } };
      }
    ).pipelineSchema;
    const revision = schema?.notebook?.revision;
    return Number.isInteger(revision) ? (revision as number) : 1;
  }, [detectorId, dirty, canSubmit, handleSubmit]);

  const runMode = React.useCallback(
    async (
      modeName: "cell" | "all" | "preview_detect",
      extra: { targetCellId?: string; sourceId?: string; assetId?: string } = {},
    ) => {
      setRunError(null);
      try {
        const revision = await savedRevision();
        if (revision === null) return;
        await run({ revision, mode: modeName, ...extra, maxAssets: 3 });
      } catch (error) {
        setRunError(error instanceof Error ? error.message : String(error));
      }
    },
    [run, savedRevision],
  );

  const resultByCell = React.useMemo(() => {
    const map = new Map<string, { outputs: CellOutputValue[]; durationMs: number }>();
    if (execution?.mode === "preview_detect") return map;
    for (const entry of execution?.outputs?.cells ?? []) {
      map.set(entry.cellId, {
        outputs: (entry.outputs ?? []) as CellOutputValue[],
        durationMs: entry.durationMs,
      });
    }
    return map;
  }, [execution]);

  const cellStatus = (cellId: string): CellStatus => {
    if (!execution || execution.mode === "preview_detect") return "idle";
    if (execution.status === "PENDING") return "queued";
    if (execution.status === "RUNNING") {
      return execution.mode === "cell"
        ? execution.targetCellId === cellId
          ? "running"
          : "idle"
        : "running";
    }
    if (execution.failedCellId === cellId) return "error";
    return resultByCell.has(cellId) ? "success" : "idle";
  };

  const captureFromPreview = React.useCallback(
    (sample: {
      name: string;
      fixture?: CapturedScenario["fixture"];
      findings: CapturedScenario["findings"];
    }) => {
      if (!sample.fixture) return;
      setCaptured({
        name: t("detectors.code.capturedName", { name: sample.name }),
        fixture: sample.fixture,
        findings: sample.findings,
      });
    },
    [t],
  );

  const contract = execution?.outputs?.contract;

  return (
    <div className="space-y-6" data-testid="code-detector-editor">
      {/* ── Identity ── */}
      <Card className="p-6 space-y-4 border-2 border-border">
        <SectionTitle>{t("detectors.code.identityTitle")}</SectionTitle>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="code-name">{t("detectors.code.name")} *</Label>
            <Input
              id="code-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (mode === "create") setKey(toSlug(event.target.value));
                setDirty(true);
              }}
              placeholder={t("detectors.code.namePlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="code-key">{t("detectors.code.key")}</Label>
            <Input
              id="code-key"
              value={key}
              onChange={(event) => {
                setKey(event.target.value);
                setDirty(true);
              }}
              className="font-mono text-sm"
              placeholder="de_dq_totals"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="code-description">{t("detectors.code.description")}</Label>
          <Textarea
            id="code-description"
            rows={2}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              setDirty(true);
            }}
          />
        </div>
        <div className="flex items-center gap-3">
          <Switch
            id="code-active"
            checked={isActive}
            onCheckedChange={(value) => {
              setIsActive(value);
              setDirty(true);
            }}
          />
          <Label htmlFor="code-active">{t("detectors.code.active")}</Label>
        </div>
      </Card>

      {/* ── What a finding is ── */}
      <Card className="p-6 space-y-4 border-2 border-border">
        <SectionTitle>{t("detectors.code.ruleTitle")}</SectionTitle>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("detectors.code.severity")}</Label>
            <Select
              value={draft.severity}
              onValueChange={(value) => update({ severity: value as SeverityCeiling })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITY_CEILINGS.map((level) => (
                  <SelectItem key={level} value={level}>
                    {level}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("detectors.code.severityHint")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>{t("detectors.code.category")}</Label>
            <Select
              value={draft.category}
              onValueChange={(value) => update({ category: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CODE_DETECTOR_CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <label className="flex items-start gap-3">
          <Switch
            checked={draft.needsFindings}
            onCheckedChange={(value) => update({ needsFindings: value })}
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">
              {t("detectors.code.needsFindings")}
            </span>
            <span className="block text-xs text-muted-foreground">
              {t("detectors.code.needsFindingsHint")}
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <Switch
            checked={!draft.deterministic}
            onCheckedChange={(value) => update({ deterministic: !value })}
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">
              {t("detectors.code.nonDeterministic")}
            </span>
            <span className="block text-xs text-muted-foreground">
              {t("detectors.code.nonDeterministicHint")}
            </span>
          </span>
        </label>
        <div className="space-y-1.5">
          <Label>{t("detectors.code.scopeKinds")}</Label>
          <div className="flex flex-wrap gap-4">
            {ASSET_KINDS.map((kind) => (
              <label key={kind} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={draft.assetKinds.includes(kind)}
                  onCheckedChange={(checked) =>
                    update({
                      assetKinds: checked
                        ? [...draft.assetKinds, kind]
                        : draft.assetKinds.filter((value) => value !== kind),
                    })
                  }
                />
                {kind}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("detectors.code.scopeKindsHint")}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("detectors.code.timeout")}</Label>
            <Input
              inputMode="numeric"
              value={draft.perAssetTimeoutSeconds}
              placeholder="30"
              onChange={(event) =>
                update({ perAssetTimeoutSeconds: event.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("detectors.code.maxFindings")}</Label>
            <Input
              inputMode="numeric"
              value={draft.maxFindingsPerAsset}
              placeholder="200"
              onChange={(event) =>
                update({ maxFindingsPerAsset: event.target.value })
              }
            />
          </div>
        </div>
      </Card>

      {/* ── Packages, variables, secrets (before the code: cells read them via ctx) ── */}
      <Card className="p-6 space-y-4 border-2 border-border">
        <SectionTitle>{t("detectors.code.environmentTitle")}</SectionTitle>
        <KeyValueField
          entries={draft.variables}
          onChange={(variables) => update({ variables })}
          label={t("notebook.config.variablesTitle")}
          description={t("detectors.code.variablesHint")}
          emptyHint={t("notebook.config.variablesEmpty")}
          addLabel={t("notebook.config.addVariable")}
          keyPlaceholder="threshold"
          valuePlaceholder="0.9"
          testId="code-detector-variables"
        />
        <KeyValueField
          entries={draft.secrets}
          onChange={(secrets) => update({ secrets })}
          secret
          label={t("notebook.config.secretsTitle")}
          description={t("detectors.code.secretsHint")}
          emptyHint={t("notebook.config.secretsEmpty")}
          addLabel={t("notebook.config.addSecret")}
          keyPlaceholder="api_token"
          testId="code-detector-secrets"
        />
        <PackageTable
          packages={draft.packages}
          onChange={(packages) => update({ packages })}
        />
        <AvailablePackages />
      </Card>

      {/* ── The code ── */}
      <Card className="p-6 space-y-4 border-2 border-border">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Code2 className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <div>
              <SectionTitle>{t("detectors.code.notebookTitle")}</SectionTitle>
              <p className="text-sm text-muted-foreground">
                {t("detectors.code.notebookHint")}
              </p>
            </div>
          </div>
          {mode === "edit" && detectorId ? (
            <div className="flex items-center gap-2">
              {busy ? (
                <Button type="button" size="sm" variant="outline" onClick={() => void cancel()}>
                  <Square className="mr-1.5 h-4 w-4" />
                  {t("notebook.cancel")}
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !canSubmit}
                onClick={() => void runMode("all")}
                data-testid="code-run-all"
              >
                {busy && execution?.mode === "all" ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-1.5 h-4 w-4" />
                )}
                {t("detectors.code.runAll")}
              </Button>
            </div>
          ) : null}
        </div>
        {problems.includes("missingDetect") ? (
          <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            {t("detectors.code.missingDetect")}
          </p>
        ) : null}
        {contract && !contract.ok ? (
          <ul className="list-disc pl-5 text-sm text-destructive">
            {(contract.violations as Array<{ message: string }>).map((violation, index) => (
              <li key={index}>{violation.message}</li>
            ))}
          </ul>
        ) : null}
        {runError ? <p className="text-sm text-destructive">{runError}</p> : null}
        <CellList
          notebookId={detectorId ?? "code-detector-draft"}
          cells={draft.cells}
          onChange={(cells) => update({ cells })}
          scope="detector"
          onRunCell={
            mode === "edit" && detectorId
              ? (cellId) => void runMode("cell", { targetCellId: cellId })
              : undefined
          }
          runState={(cellId) => ({
            status: cellStatus(cellId),
            outputs: resultByCell.get(cellId)?.outputs ?? [],
            durationMs: resultByCell.get(cellId)?.durationMs ?? null,
            error:
              execution?.mode !== "preview_detect" &&
              execution?.failedCellId === cellId
                ? execution.error
                : null,
            blamed:
              execution?.failedCellId === cellId &&
              execution.targetCellId !== cellId,
          })}
        />
      </Card>

      {/* ── Output fields ── */}
      <Card className="p-6 space-y-4 border-2 border-border">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <SectionTitle>{t("detectors.code.fieldsTitle")}</SectionTitle>
            <p className="text-sm text-muted-foreground">
              {t("detectors.code.fieldsHint")}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              update({
                fields: [...draft.fields, { name: "", type: "string", description: "" }],
              })
            }
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {t("detectors.code.addField")}
          </Button>
        </div>
        {draft.fields.map((field, index) => (
          <div key={index} className="grid gap-2 md:grid-cols-[1fr_10rem_2fr_auto]">
            <Input
              value={field.name}
              className="font-mono text-sm"
              placeholder="expected"
              onChange={(event) =>
                update({
                  fields: draft.fields.map((entry, position) =>
                    position === index ? { ...entry, name: event.target.value } : entry,
                  ),
                })
              }
            />
            <Select
              value={field.type}
              onValueChange={(value) =>
                update({
                  fields: draft.fields.map((entry, position) =>
                    position === index
                      ? { ...entry, type: value as CodeDetectorFieldType }
                      : entry,
                  ),
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CODE_DETECTOR_FIELD_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={field.description}
              placeholder={t("detectors.code.fieldDescription")}
              onChange={(event) =>
                update({
                  fields: draft.fields.map((entry, position) =>
                    position === index
                      ? { ...entry, description: event.target.value }
                      : entry,
                  ),
                })
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("common.delete")}
              onClick={() =>
                update({ fields: draft.fields.filter((_, position) => position !== index) })
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {problems.includes("fieldName") || problems.includes("duplicateField") ? (
          <p className="text-sm text-destructive">{t("detectors.code.fieldProblem")}</p>
        ) : null}
      </Card>

      {mode === "edit" && detectorId ? (
        <>
          <CodeDetectorFiles detectorId={detectorId} />
          <CodeDetectorPreview
            execution={execution}
            busy={busy}
            disabled={!canSubmit}
            onRun={(request) => void runMode("preview_detect", request)}
            onCapture={captureFromPreview}
          />
          <CodeDetectorTests
            detectorId={detectorId}
            captured={captured}
            onCapturedConsumed={() => setCaptured(null)}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("detectors.code.saveFirst")}
        </p>
      )}

      {!embedded && (
        <StickyActionToolbar
          onSaveAndRun={() => void handleSubmit()}
          saveAndRunLabel={submitLabel}
          isBusy={isSubmitting}
          saveAndRunDisabled={!canSubmit}
        />
      )}
    </div>
  );
});
