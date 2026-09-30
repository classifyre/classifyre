"use client";

import * as React from "react";
import {
  api,
  type AssetFixtureDto,
  type TestScenarioDto,
} from "@workspace/api-client";
import { Loader2, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
  Textarea,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { SAMPLE_ASSET_FIXTURE } from "@/lib/code-detector";

/** A scenario the preview offers to keep: the asset it saw, the findings it made. */
export interface CapturedScenario {
  name: string;
  fixture: AssetFixtureDto;
  findings: Array<{ finding_type: string; identity_key?: string }>;
}

type InputMode = "text" | "asset";

const SHOULD_NOT_MATCH = { shouldMatch: false };

function expectedFrom(
  findings: CapturedScenario["findings"],
): Record<string, unknown> {
  if (findings.length === 0) return SHOULD_NOT_MATCH;
  return {
    findings: findings.slice(0, 20).map((finding) => ({
      label: finding.finding_type,
      ...(finding.identity_key ? { identity: finding.identity_key } : {}),
    })),
    match: "exact",
  };
}

function statusClass(status?: string): string {
  if (status === "PASS") return "border-green-600 text-green-700 dark:text-green-400";
  if (status === "FAIL") return "border-red-600 text-red-700 dark:text-red-400";
  if (status === "ERROR") return "border-orange-500 text-orange-600";
  return "text-muted-foreground";
}

/**
 * Test scenarios for a code detector. A scenario is an input -- text, or a
 * whole asset fixture with rows, pages and metadata -- plus the findings the
 * rule must (or must not) produce. They run through the same evaluation job
 * as every other detector's tests.
 */
export function CodeDetectorTests({
  detectorId,
  captured,
  onCapturedConsumed,
}: {
  detectorId: string;
  captured?: CapturedScenario | null;
  onCapturedConsumed?: () => void;
}) {
  const { t } = useTranslation();
  const [scenarios, setScenarios] = React.useState<TestScenarioDto[]>([]);
  const [running, setRunning] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [name, setName] = React.useState("");
  const [mode, setMode] = React.useState<InputMode>("asset");
  const [inputText, setInputText] = React.useState("");
  const [fixtureJson, setFixtureJson] = React.useState(
    JSON.stringify(SAMPLE_ASSET_FIXTURE, null, 2),
  );
  const [expectedJson, setExpectedJson] = React.useState(
    JSON.stringify({ findings: [{ label: "" }], match: "subset" }, null, 2),
  );
  const [formError, setFormError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setScenarios(await api.listTestScenarios(detectorId));
    } catch {
      setScenarios([]);
    }
  }, [detectorId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!captured) return;
    setAdding(true);
    setMode("asset");
    setName(captured.name);
    setFixtureJson(JSON.stringify(captured.fixture, null, 2));
    setExpectedJson(JSON.stringify(expectedFrom(captured.findings), null, 2));
    onCapturedConsumed?.();
  }, [captured, onCapturedConsumed]);

  const save = async () => {
    setFormError(null);
    let expectedOutcome: Record<string, unknown>;
    let inputAsset: AssetFixtureDto | undefined;
    try {
      expectedOutcome = JSON.parse(expectedJson) as Record<string, unknown>;
      if (mode === "asset") {
        inputAsset = JSON.parse(fixtureJson) as AssetFixtureDto;
      }
    } catch (error) {
      setFormError(
        t("detectors.code.testsInvalidJson", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      return;
    }
    if (!name.trim() || (mode === "text" && !inputText.trim())) {
      setFormError(t("detectors.code.testsIncomplete"));
      return;
    }
    setSaving(true);
    try {
      await api.createTestScenario(detectorId, {
        name: name.trim(),
        ...(mode === "text" ? { inputText } : { inputAsset }),
        expectedOutcome,
      });
      toast.success(t("detectors.scenarioAdded"));
      setAdding(false);
      setName("");
      setInputText("");
      await load();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : t("detectors.failedToAddScenario"),
      );
    } finally {
      setSaving(false);
    }
  };

  const runAll = async () => {
    setRunning(true);
    try {
      const result = await api.runTestScenarios(detectorId);
      if (result.summary.failed + result.summary.errored === 0) {
        toast.success(t("detectors.allTestsPassed"));
      } else {
        toast.error(
          t("detectors.code.testsSummary", {
            passed: result.summary.passed,
            total: result.summary.total,
          }),
        );
      }
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("detectors.failedToRunTests"),
      );
    } finally {
      setRunning(false);
    }
  };

  const remove = async (scenario: TestScenarioDto) => {
    try {
      await api.deleteTestScenario(detectorId, scenario.id);
      await load();
    } catch {
      toast.error(t("detectors.failedToDeleteScenario"));
    }
  };

  return (
    <Card className="p-6 space-y-4 border-2 border-border" data-testid="code-detector-tests">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif font-black uppercase tracking-wide text-base">
            {t("detectors.code.testsTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("detectors.code.testsHint")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAdding((value) => !value)}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {t("detectors.code.testsAdd")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void runAll()}
            disabled={running || scenarios.length === 0}
            data-testid="code-tests-run"
          >
            {running ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-1.5 h-4 w-4" />
            )}
            {t("detectors.code.testsRun")}
          </Button>
        </div>
      </div>

      {adding ? (
        <div className="space-y-3 rounded-[4px] border border-border p-4">
          <div className="space-y-1.5">
            <Label>{t("detectors.code.testsName")}</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="flex gap-2">
            {(["asset", "text"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={mode === value ? "default" : "outline"}
                onClick={() => setMode(value)}
              >
                {t(`detectors.code.testsMode.${value}`)}
              </Button>
            ))}
          </div>
          {mode === "text" ? (
            <Textarea
              rows={5}
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              placeholder={t("detectors.code.testsTextPlaceholder")}
            />
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                {t("detectors.code.testsFixtureHint")}
              </p>
              <Textarea
                rows={10}
                className="font-mono text-xs"
                value={fixtureJson}
                onChange={(event) => setFixtureJson(event.target.value)}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Label>{t("detectors.code.testsExpected")}</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setExpectedJson(JSON.stringify(SHOULD_NOT_MATCH, null, 2))
                }
              >
                {t("detectors.code.testsExpectNothing")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("detectors.code.testsExpectedHint")}
            </p>
            <Textarea
              rows={6}
              className="font-mono text-xs"
              value={expectedJson}
              onChange={(event) => setExpectedJson(event.target.value)}
            />
          </div>
          {formError ? (
            <p className="text-sm text-destructive">{formError}</p>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => void save()} disabled={saving}>
              {t("common.save")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAdding(false)}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {scenarios.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("detectors.code.testsEmpty")}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-[4px] border border-border">
          {scenarios.map((scenario) => (
            <li key={scenario.id} className="space-y-1 px-3 py-2">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={`text-[10px] uppercase ${statusClass(scenario.lastResult?.status)}`}
                >
                  {scenario.lastResult?.status ?? t("detectors.code.testsNotRun")}
                </Badge>
                <span className="text-sm font-medium">{scenario.name}</span>
                <Badge variant="outline" className="text-[10px]">
                  {scenario.inputAsset
                    ? t("detectors.code.testsMode.asset")
                    : t("detectors.code.testsMode.text")}
                </Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => void remove(scenario)}
                  aria-label={t("common.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <code className="block break-words font-mono text-xs text-muted-foreground">
                {JSON.stringify(scenario.expectedOutcome)}
              </code>
              {scenario.lastResult?.errorMessage ? (
                <p className="whitespace-pre-wrap break-words text-xs text-destructive">
                  {scenario.lastResult.errorMessage}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
