"use client";

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Play,
  Trash2,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";
import {
  api,
  type CreateTestScenarioDto,
  type TestResultDto,
  type TestScenarioDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { Card, CardContent } from "@workspace/ui/components/card";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

type TestResultStatus = "PASS" | "FAIL" | "ERROR";
type DetectorMethod = "RULESET" | "CLASSIFIER" | "ENTITY";

interface Props {
  detectorId: string;
  method: DetectorMethod;
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: TestResultStatus | undefined }) {
  if (!status) {
    return (
      <Badge className="rounded-[4px] border border-stone-400 bg-transparent text-[10px] uppercase tracking-wide text-stone-500">
        Not run
      </Badge>
    );
  }
  const styles: Record<TestResultStatus, string> = {
    PASS: "border-green-600 text-green-700",
    FAIL: "border-red-600 text-red-700",
    ERROR: "border-orange-500 text-orange-600",
  };
  return (
    <Badge
      className={`rounded-[4px] border bg-transparent text-[10px] uppercase tracking-wide ${styles[status]}`}
    >
      {status}
    </Badge>
  );
}

// ── Expected outcome summary ──────────────────────────────────────────────────

function OutcomeSummary({
  method,
  outcome,
}: {
  method: DetectorMethod;
  outcome: Record<string, unknown>;
}) {
  if (method === "RULESET") {
    return (
      <span className="text-xs text-muted-foreground">
        Should {outcome.shouldMatch ? "match" : "not match"}
      </span>
    );
  }
  if (method === "CLASSIFIER") {
    return (
      <span className="text-xs text-muted-foreground">
        Label: <span className="font-mono">{String(outcome.label ?? "")}</span>
        {typeof outcome.minConfidence === "number"
          ? ` ≥${Math.round((outcome.minConfidence as number) * 100)}%`
          : ""}
      </span>
    );
  }
  if (method === "ENTITY") {
    const entities = Array.isArray(outcome.entities)
      ? (outcome.entities as Array<{ label: string; text?: string }>)
      : [];
    return (
      <span className="text-xs text-muted-foreground">
        Entities:{" "}
        {entities.map((e, i) => (
          <span key={i} className="font-mono">
            {i > 0 ? ", " : ""}
            {e.label}
            {e.text ? `="${e.text}"` : ""}
          </span>
        ))}
      </span>
    );
  }
  return null;
}

// ── Add scenario form ─────────────────────────────────────────────────────────

interface AddFormState {
  name: string;
  description: string;
  inputText: string;
  // RULESET
  shouldMatch: boolean;
  // CLASSIFIER
  label: string;
  minConfidence: string;
  // ENTITY
  entities: Array<{ label: string; text: string }>;
}

const defaultForm = (): AddFormState => ({
  name: "",
  description: "",
  inputText: "",
  shouldMatch: true,
  label: "",
  minConfidence: "",
  entities: [{ label: "", text: "" }],
});

function buildExpectedOutcome(
  method: DetectorMethod,
  form: AddFormState,
): Record<string, unknown> {
  if (method === "RULESET") {
    return { shouldMatch: form.shouldMatch };
  }
  if (method === "CLASSIFIER") {
    const out: Record<string, unknown> = { label: form.label };
    const conf = parseFloat(form.minConfidence);
    if (!isNaN(conf)) out.minConfidence = conf;
    return out;
  }
  // ENTITY
  return {
    entities: form.entities
      .filter((e) => e.label.trim().length > 0)
      .map((e) => ({
        label: e.label.trim(),
        ...(e.text.trim() ? { text: e.text.trim() } : {}),
      })),
  };
}

interface AddFormProps {
  method: DetectorMethod;
  onAdd: (payload: CreateTestScenarioDto) => Promise<void>;
  onCancel: () => void;
}

function AddScenarioForm({ method, onAdd, onCancel }: AddFormProps) {
  const [form, setForm] = useState<AddFormState>(defaultForm());
  const [saving, setSaving] = useState(false);

  const set = (key: keyof AddFormState, value: unknown) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.inputText.trim()) return;

    setSaving(true);
    try {
      await onAdd({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        inputText: form.inputText.trim(),
        expectedOutcome: buildExpectedOutcome(method, form),
      });
      setForm(defaultForm());
    } finally {
      setSaving(false);
    }
  };

  const addEntity = () =>
    setForm((prev) => ({
      ...prev,
      entities: [...prev.entities, { label: "", text: "" }],
    }));

  const removeEntity = (idx: number) =>
    setForm((prev) => ({
      ...prev,
      entities: prev.entities.filter((_, i) => i !== idx),
    }));

  const updateEntity = (idx: number, key: "label" | "text", value: string) =>
    setForm((prev) => ({
      ...prev,
      entities: prev.entities.map((e, i) =>
        i === idx ? { ...e, [key]: value } : e,
      ),
    }));

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      className="rounded-[4px] border-2 border-black p-4 shadow-[3px_3px_0_#000] space-y-4 bg-background"
    >
      <p className="font-serif font-black uppercase tracking-wide text-sm">
        New Test Scenario
      </p>

      <div className="space-y-1">
        <label className="text-xs font-medium">Name *</label>
        <input
          className="w-full rounded-[4px] border border-stone-300 px-3 py-1.5 text-sm focus:outline-none focus:border-black"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Should match IBAN"
          required
          data-testid="input-test-name"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium">Input Text *</label>
        <textarea
          className="w-full rounded-[4px] border border-stone-300 px-3 py-1.5 text-sm focus:outline-none focus:border-black min-h-[80px] resize-y font-mono"
          value={form.inputText}
          onChange={(e) => set("inputText", e.target.value)}
          placeholder="Paste text to test against the detector..."
          required
          data-testid="textarea-test-input"
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium">Expected Outcome</p>

        {method === "RULESET" && (
          <div className="flex gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                checked={form.shouldMatch}
                onChange={() => set("shouldMatch", true)}
                data-testid="radio-test-match-true"
              />
              Should match
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                checked={!form.shouldMatch}
                onChange={() => set("shouldMatch", false)}
                data-testid="radio-test-match-false"
              />
              Should not match
            </label>
          </div>
        )}

        {method === "CLASSIFIER" && (
          <div className="flex gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-xs text-muted-foreground">Label *</label>
              <input
                className="w-full rounded-[4px] border border-stone-300 px-3 py-1.5 text-sm focus:outline-none focus:border-black"
                value={form.label}
                onChange={(e) => set("label", e.target.value)}
                placeholder="e.g. advice"
                required
                data-testid="input-test-label"
              />
            </div>
            <div className="w-40 space-y-1">
              <label className="text-xs text-muted-foreground">
                Min confidence
              </label>
              <input
                className="w-full rounded-[4px] border border-stone-300 px-3 py-1.5 text-sm focus:outline-none focus:border-black"
                value={form.minConfidence}
                onChange={(e) => set("minConfidence", e.target.value)}
                placeholder="0.6"
                type="number"
                min="0"
                max="1"
                step="0.05"
                data-testid="input-test-confidence"
              />
            </div>
          </div>
        )}

        {method === "ENTITY" && (
          <div className="space-y-2">
            {form.entities.map((ent, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  className="flex-1 rounded-[4px] border border-stone-300 px-3 py-1.5 text-sm focus:outline-none focus:border-black"
                  value={ent.label}
                  onChange={(e) => updateEntity(idx, "label", e.target.value)}
                  placeholder="Entity label (e.g. PersonName)"
                />
                <input
                  className="flex-1 rounded-[4px] border border-stone-300 px-3 py-1.5 text-sm focus:outline-none focus:border-black"
                  value={ent.text}
                  onChange={(e) => updateEntity(idx, "text", e.target.value)}
                  placeholder="Expected text (optional)"
                />
                {form.entities.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeEntity(idx)}
                    className="text-stone-400 hover:text-red-600 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addEntity}
              className="text-xs text-stone-500 hover:text-black transition-colors flex items-center gap-1"
            >
              <Plus className="h-3 w-3" />
              Add entity
            </button>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving} data-testid="btn-save-test-scenario">
          {saving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
          Add Scenario
        </Button>
      </div>
    </form>
  );
}

// ── Scenario row ──────────────────────────────────────────────────────────────

function ScenarioRow({
  scenario,
  method,
  runResult,
  onDelete,
}: {
  scenario: TestScenarioDto;
  method: DetectorMethod;
  runResult?: TestResultDto;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const displayResult = runResult ?? scenario.lastResult ?? undefined;

  return (
    <div className="rounded-[4px] border border-stone-200 bg-background">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{scenario.name}</p>
          <OutcomeSummary method={method} outcome={scenario.expectedOutcome} />
        </div>
        <StatusBadge
          status={displayResult?.status as TestResultStatus | undefined}
        />
        {displayResult && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-stone-400 hover:text-black transition-colors"
            aria-label="Toggle details"
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        )}
        <button
          onClick={onDelete}
          className="text-stone-400 hover:text-red-600 transition-colors"
          aria-label="Delete scenario"
          data-testid="btn-delete-test-scenario"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {expanded && displayResult && (
        <div className="border-t border-stone-200 px-4 py-3 space-y-2">
          {displayResult.errorMessage && (
            <p className="text-xs text-red-600 font-mono">
              {displayResult.errorMessage}
            </p>
          )}
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Actual output
              {displayResult.durationMs != null
                ? ` · ${displayResult.durationMs}ms`
                : ""}
            </summary>
            <pre className="mt-2 overflow-auto rounded-[4px] bg-stone-50 p-3 text-xs font-mono border border-stone-200">
              {JSON.stringify(displayResult.actualOutput, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CustomDetectorTests({ detectorId, method }: Props) {
  const [scenarios, setScenarios] = useState<TestScenarioDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResults, setRunResults] = useState<Map<string, TestResultDto>>(
    new Map(),
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listTestScenarios(detectorId);
      setScenarios(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load scenarios");
    } finally {
      setLoading(false);
    }
  }, [detectorId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async (payload: CreateTestScenarioDto) => {
    try {
      await api.createTestScenario(detectorId, payload);
      toast.success("Test scenario added");
      setShowAddForm(false);
      await load();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to add scenario",
      );
      throw err;
    }
  };

  const handleDelete = async (scenarioId: string) => {
    try {
      await api.deleteTestScenario(detectorId, scenarioId);
      toast.success("Scenario deleted");
      await load();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete scenario",
      );
    }
  };

  const handleRunAll = async () => {
    if (scenarios.length === 0) return;
    setRunning(true);
    setRunResults(new Map());
    try {
      const response = await api.runTestScenarios(detectorId);
      const map = new Map<string, TestResultDto>();
      for (const { scenario, result } of response.results) {
        map.set(scenario.id, result);
      }
      setRunResults(map);

      const { passed, failed, errored, total } = response.summary;
      if (failed === 0 && errored === 0) {
        toast.success(`All ${total} tests passed`);
      } else {
        toast.error(`${passed} passed, ${failed} failed, ${errored} errored`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run tests");
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading test scenarios…
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  const passCount = [...runResults.values()].filter(
    (r) => r.status === "PASS",
  ).length;
  const failCount = [...runResults.values()].filter(
    (r) => r.status === "FAIL",
  ).length;
  const errorCount = [...runResults.values()].filter(
    (r) => r.status === "ERROR",
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {runResults.size > 0 && (
            <div className="flex items-center gap-2 text-sm" data-testid="test-run-summary" data-passed={passCount} data-failed={failCount} data-errored={errorCount}>
              <span className="text-green-600 font-medium" data-testid="test-run-passed">
                {passCount} passed
              </span>
              {failCount > 0 && (
                <span className="text-red-600 font-medium" data-testid="test-run-failed">
                  {failCount} failed
                </span>
              )}
              {errorCount > 0 && (
                <span className="text-orange-500 font-medium" data-testid="test-run-errored">
                  {errorCount} errored
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddForm((v) => !v)}
            data-testid="btn-show-add-test"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Test
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void handleRunAll();
            }}
            disabled={running || scenarios.length === 0}
            data-testid="btn-run-all-tests"
          >
            {running ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            {running ? "Running…" : "Run All Tests"}
          </Button>
        </div>
      </div>

      {showAddForm && (
        <AddScenarioForm
          method={method}
          onAdd={handleAdd}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {scenarios.length === 0 && !showAddForm ? (
        <Card className="border border-dashed border-stone-300 rounded-[4px]">
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No test scenarios yet. Add one to verify your detector works
              correctly.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {scenarios.map((scenario) => (
            <ScenarioRow
              key={scenario.id}
              scenario={scenario}
              method={method}
              runResult={runResults.get(scenario.id)}
              onDelete={() => {
                void handleDelete(scenario.id);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
