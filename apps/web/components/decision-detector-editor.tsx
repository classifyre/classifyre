"use client";

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
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
import { StickyActionToolbar } from "@/components/sticky-action-toolbar";
import { VerticalCustomDetectorStepperNav } from "@/components/custom-detector-stepper";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { getDetectorExamples } from "@/lib/detector-examples-loader";
import {
  DECISION_MAX_QUESTIONS,
  DECISION_OPTION_BOUNDS,
  DECISION_PROVIDER_PRESETS,
  DECISION_QUESTION_TYPES,
  DECISION_SEVERITIES,
  blankOption,
  blankQuestion,
  decisionProviderPreset,
  draftProblems,
  draftToSchema,
  isDecisionSchema,
  questionFindingTypes,
  schemaToDraft,
  storedKeyIsKept,
  suggestQuestionName,
  withProvider,
  withQuestionType,
  type DecisionDraft,
  type DecisionOptionDraft,
  type DecisionProblem,
  type DecisionProviderId,
  type DecisionQuestionDraft,
  type DecisionQuestionType,
  type DecisionSeverity,
  type OptionFinding,
} from "@/lib/decision-detector";

// ── Props ──────────────────────────────────────────────────────────────────

type DecisionStepId = "identity" | "model" | "questions";

export interface DecisionDetectorEditorProps {
  mode: "create" | "edit";
  detectorId?: string;
  submitLabel: string;
  isSubmitting?: boolean;
  initialName?: string;
  initialKey?: string;
  initialDescription?: string;
  initialIsActive?: boolean;
  initialPipelineSchema?: Record<string, unknown>;
  /** Names of the secrets the detector already holds; values never arrive. */
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

export interface DecisionDetectorEditorHandle {
  submit: () => Promise<void>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

const DETECTOR_PROBLEMS: DecisionProblem[] = [
  "modelMissing",
  "modelFormat",
  "apiKeyMissing",
  "apiBaseMissing",
  "apiBaseFormat",
  "headerName",
  "contentLimit",
  "noQuestions",
  "tooManyQuestions",
];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-serif font-black uppercase tracking-wide text-base">
      {children}
    </h2>
  );
}

function FieldProblem({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium text-destructive" role="alert">
      {children}
    </p>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * A decision detector: pick a decision model, then write the questions it
 * answers about every piece of content. Each answer comes back as a
 * probability; the form says, next to every question, which findings that
 * answer turns into.
 */
export const DecisionDetectorEditor = React.forwardRef<
  DecisionDetectorEditorHandle,
  DecisionDetectorEditorProps
>(function DecisionDetectorEditor(
  {
    mode,
    submitLabel,
    isSubmitting,
    initialName = "",
    initialKey = "",
    initialDescription = "",
    initialIsActive = true,
    initialPipelineSchema,
    initialSecretKeys,
    embedded,
    onSubmit,
  },
  ref,
) {
  const { t } = useTranslation();
  const tx = useCallback(
    (key: string, vars?: Record<string, string | number>) =>
      t(`detectors.decision.${key}` as TranslationKey, vars),
    [t],
  );

  const steps: Array<{ id: DecisionStepId; title: string; description: string }> = [
    { id: "identity", title: tx("stepIdentity"), description: tx("stepIdentityDesc") },
    { id: "model", title: tx("stepModel"), description: tx("stepModelDesc") },
    { id: "questions", title: tx("stepQuestions"), description: tx("stepQuestionsDesc") },
  ];

  const [name, setName] = useState(initialName);
  const [key, setKey] = useState(initialKey);
  const [description, setDescription] = useState(initialDescription);
  const [isActive, setIsActive] = useState(initialIsActive);
  const [draft, setDraft] = useState<DecisionDraft>(() =>
    schemaToDraft(initialPipelineSchema, initialSecretKeys ?? []),
  );
  const [editingKey, setEditingKey] = useState(!draft.hasStoredKey);
  const [showProblems, setShowProblems] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(
    () =>
      draft.headers.length > 0 ||
      draft.contentLimit !== "" ||
      (draft.apiBase !== "" &&
        decisionProviderPreset(draft.providerId).apiBase === "optional"),
  );
  const [activeStep, setActiveStep] = useState<DecisionStepId>("identity");

  // A save returns the detector with its new secret names; pick them up so the
  // form shows "a key is stored" instead of an empty field it then re-requires.
  const secretKeysSignature = (initialSecretKeys ?? []).join(",");
  useEffect(() => {
    if (mode !== "edit") return;
    const next = schemaToDraft(initialPipelineSchema, initialSecretKeys ?? []);
    setDraft(next);
    setEditingKey(!next.hasStoredKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPipelineSchema, secretKeysSignature]);

  const identityRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const questionsRef = useRef<HTMLDivElement>(null);
  const sectionRefs: Record<DecisionStepId, RefObject<HTMLDivElement | null>> = {
    identity: identityRef,
    model: modelRef,
    questions: questionsRef,
  };

  useEffect(() => {
    const elements = (Object.keys(sectionRefs) as DecisionStepId[])
      .map((id) => ({ id, el: sectionRefs[id].current }))
      .filter((x): x is { id: DecisionStepId; el: HTMLDivElement } => x.el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const matched = elements.find((x) => x.el === entry.target);
          if (matched) setActiveStep(matched.id);
        }
      },
      { threshold: 0.3 },
    );
    for (const { el } of elements) observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preset = decisionProviderPreset(draft.providerId);
  const problems = useMemo(() => draftProblems(draft), [draft]);
  const detectorProblems = problems
    .filter((entry) => entry.question === undefined)
    .map((entry) => entry.problem);
  const questionProblems = (index: number): DecisionProblem[] =>
    problems.filter((entry) => entry.question === index).map((entry) => entry.problem);
  const hasProblem = (problem: DecisionProblem) =>
    showProblems && detectorProblems.includes(problem);

  const examples = useMemo(
    () =>
      getDetectorExamples("CUSTOM").filter((example) =>
        isDecisionSchema(example.config?.pipeline_schema),
      ),
    [],
  );

  const update = (delta: Partial<DecisionDraft>) =>
    setDraft((current) => ({ ...current, ...delta }));

  const updateQuestion = (index: number, delta: Partial<DecisionQuestionDraft>) =>
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question, i) =>
        i === index ? { ...question, ...delta } : question,
      ),
    }));

  const updateOption = (
    questionIndex: number,
    optionIndex: number,
    delta: Partial<DecisionOptionDraft>,
  ) =>
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question, i) =>
        i === questionIndex
          ? {
              ...question,
              options: question.options.map((option, j) =>
                j === optionIndex ? { ...option, ...delta } : option,
              ),
            }
          : question,
      ),
    }));

  const moveOption = (questionIndex: number, optionIndex: number, by: -1 | 1) =>
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question, i) => {
        if (i !== questionIndex) return question;
        const target = optionIndex + by;
        if (target < 0 || target >= question.options.length) return question;
        const options = [...question.options];
        [options[optionIndex], options[target]] = [options[target]!, options[optionIndex]!];
        return { ...question, options };
      }),
    }));

  const loadExample = (exampleName: string) => {
    const example = examples.find((entry) => entry.name === exampleName);
    const schema = example?.config?.pipeline_schema as Record<string, unknown> | undefined;
    if (!example || !schema) return;
    const loaded = schemaToDraft(schema, []);
    // Only what this section is about: the questions and their default
    // priority. The model, endpoint and key above are the author's own choice
    // and an example must not overwrite them.
    setDraft((current) => ({
      ...current,
      severity: loaded.severity,
      questions: loaded.questions,
    }));
    if (mode === "create" && !name.trim()) {
      setName(example.name);
      setKey(toSlug(example.name));
    }
    if (!description.trim() && typeof example.config.description === "string") {
      setDescription(example.config.description);
    }
  };

  const canSubmit = !isSubmitting && name.trim().length > 0 && problems.length === 0;

  async function handleSubmit() {
    if (!canSubmit) {
      setShowProblems(true);
      if (
        detectorProblems.some((problem) =>
          ["apiBaseFormat", "headerName", "contentLimit"].includes(problem),
        )
      ) {
        setAdvancedOpen(true);
      }
      throw new Error("Validation failed");
    }
    await onSubmit({
      name,
      key: key || toSlug(name),
      description,
      isActive,
      pipelineSchema: draftToSchema(draft, initialPipelineSchema),
    });
  }

  React.useImperativeHandle(ref, () => ({ submit: handleSubmit }));

  const keyIsKept = storedKeyIsKept(draft);
  const keyWillBeDropped = draft.hasStoredKey && !draft.removeStoredKey && !keyIsKept;
  const firstProblem = detectorProblems.find((problem) =>
    DETECTOR_PROBLEMS.includes(problem),
  );
  const firstQuestionProblem = problems.find((entry) => entry.question !== undefined);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_200px]">
      <div className="space-y-6 min-w-0">
        {/* ── Identity ── */}
        <div ref={identityRef} id="section-identity">
          <Card className="p-6 space-y-4 border-2 border-border">
            <SectionTitle>{tx("identityTitle")}</SectionTitle>
            <div className="space-y-1.5">
              <Label htmlFor="decision-name">{tx("name")} *</Label>
              <Input
                id="decision-name"
                data-testid="decision-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (mode === "create") setKey(toSlug(event.target.value));
                }}
                placeholder={tx("namePlaceholder")}
              />
              {showProblems && !name.trim() ? (
                <FieldProblem>{tx("problem.nameMissing")}</FieldProblem>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="decision-key">{tx("keyLabel")}</Label>
              <Input
                id="decision-key"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder="ticket_triage"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">{tx("keyHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="decision-description">{tx("descriptionLabel")}</Label>
              <Textarea
                id="decision-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={tx("descriptionPlaceholder")}
                rows={2}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch id="decision-active" checked={isActive} onCheckedChange={setIsActive} />
              <Label htmlFor="decision-active">{tx("activeLabel")}</Label>
            </div>
          </Card>
        </div>

        {/* ── Decision model ── */}
        <div ref={modelRef} id="section-model">
          <Card className="p-6 space-y-4 border-2 border-border">
            <div className="space-y-1">
              <SectionTitle>{tx("modelTitle")}</SectionTitle>
              <p className="text-sm text-muted-foreground">{tx("modelHint")}</p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{tx("provider")} *</Label>
                <Select
                  value={draft.providerId}
                  onValueChange={(value) =>
                    setDraft((current) => withProvider(current, value as DecisionProviderId))
                  }
                >
                  <SelectTrigger data-testid="decision-provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DECISION_PROVIDER_PRESETS.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {tx(`providers.${entry.id}.name`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {tx(`providers.${draft.providerId}.hint`)}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="decision-model">{tx("model")} *</Label>
                <Input
                  id="decision-model"
                  data-testid="decision-model"
                  list="decision-model-suggestions"
                  value={draft.model}
                  onChange={(event) => update({ model: event.target.value })}
                  placeholder={preset.models[0] ?? "provider/model"}
                  className="font-mono text-sm"
                  autoComplete="off"
                  spellCheck={false}
                />
                <datalist id="decision-model-suggestions">
                  {preset.models.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
                {hasProblem("modelMissing") ? (
                  <FieldProblem>{tx("problem.modelMissing")}</FieldProblem>
                ) : hasProblem("modelFormat") ? (
                  <FieldProblem>{tx("problem.modelFormat")}</FieldProblem>
                ) : (
                  <p className="text-xs text-muted-foreground">{tx("modelFieldHint")}</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="decision-api-key">
                {tx("apiKey")}
                {preset.apiKey === "required" ? " *" : ""}
              </Label>
              {draft.hasStoredKey && !editingKey ? (
                <div className="flex items-center gap-2">
                  <Input
                    id="decision-api-key"
                    className="cursor-pointer font-mono text-muted-foreground"
                    type="text"
                    readOnly
                    value={draft.removeStoredKey ? "" : "••••••••••••••••••••••••"}
                    placeholder={tx("apiKeyRemoved")}
                    onFocus={() => setEditingKey(true)}
                    onClick={() => setEditingKey(true)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-[4px] border-2 border-border"
                    onClick={() => update({ removeStoredKey: !draft.removeStoredKey })}
                  >
                    {draft.removeStoredKey ? tx("apiKeyKeep") : tx("apiKeyRemove")}
                  </Button>
                </div>
              ) : (
                <Input
                  id="decision-api-key"
                  data-testid="decision-api-key"
                  className="font-mono"
                  type="password"
                  placeholder={
                    draft.hasStoredKey ? tx("apiKeyReplacePlaceholder") : tx("apiKeyPlaceholder")
                  }
                  value={draft.apiKey}
                  onChange={(event) => update({ apiKey: event.target.value })}
                  autoComplete="off"
                />
              )}
              {hasProblem("apiKeyMissing") ? (
                <FieldProblem>{tx("problem.apiKeyMissing")}</FieldProblem>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {keyWillBeDropped && !draft.apiKey
                  ? tx("apiKeyWillBeDropped")
                  : keyIsKept && !draft.apiKey
                    ? tx("apiKeyStored")
                    : preset.apiKey === "optional"
                      ? tx("apiKeyOptionalHint")
                      : tx("apiKeyHint")}
              </p>
            </div>

            {/* Where the endpoint URL sits depends on the provider alone, never
                on whether it has a value: a field that moved once typed into
                would lose focus after the first character. */}
            {preset.apiBase === "required" ? (
              <ApiBaseField
                value={draft.apiBase}
                required
                placeholder={preset.apiBasePlaceholder}
                label={tx("apiBase")}
                hint={tx(`providers.${draft.providerId}.apiBaseHint`)}
                problem={
                  hasProblem("apiBaseMissing")
                    ? tx("problem.apiBaseMissing")
                    : hasProblem("apiBaseFormat")
                      ? tx("problem.apiBaseFormat")
                      : null
                }
                onChange={(apiBase) => update({ apiBase })}
              />
            ) : null}

            {/* ── Advanced ── */}
            <div className="border-t-2 border-border pt-4">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left text-sm font-semibold"
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((open) => !open)}
              >
                {tx("advancedTitle")}
                {advancedOpen ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
              {advancedOpen ? (
                <div className="mt-4 space-y-4">
                  {preset.apiBase === "optional" ? (
                    <ApiBaseField
                      value={draft.apiBase}
                      required={false}
                      placeholder={preset.apiBasePlaceholder}
                      label={tx("apiBase")}
                      hint={tx(`providers.${draft.providerId}.apiBaseHint`)}
                      problem={
                        hasProblem("apiBaseFormat") ? tx("problem.apiBaseFormat") : null
                      }
                      onChange={(apiBase) => update({ apiBase })}
                    />
                  ) : null}

                  <div className="space-y-2">
                    <Label>{tx("headers")}</Label>
                    <p className="text-xs text-muted-foreground">{tx("headersHint")}</p>
                    {draft.headers.map((header, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Input
                          value={header.name}
                          placeholder="x-team"
                          aria-label={tx("headerName")}
                          className="w-48 font-mono text-sm"
                          onChange={(event) =>
                            update({
                              headers: draft.headers.map((entry, i) =>
                                i === index ? { ...entry, name: event.target.value } : entry,
                              ),
                            })
                          }
                        />
                        <Input
                          value={header.value}
                          placeholder="risk"
                          aria-label={tx("headerValue")}
                          className="flex-1 font-mono text-sm"
                          onChange={(event) =>
                            update({
                              headers: draft.headers.map((entry, i) =>
                                i === index ? { ...entry, value: event.target.value } : entry,
                              ),
                            })
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={tx("removeHeader")}
                          onClick={() =>
                            update({ headers: draft.headers.filter((_, i) => i !== index) })
                          }
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    ))}
                    {hasProblem("headerName") ? (
                      <FieldProblem>{tx("problem.headerName")}</FieldProblem>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-[4px] border-2 border-border"
                      onClick={() =>
                        update({ headers: [...draft.headers, { name: "", value: "" }] })
                      }
                    >
                      <Plus className="mr-2 h-3.5 w-3.5" />
                      {tx("addHeader")}
                    </Button>
                  </div>

                  <div className="space-y-1.5 sm:max-w-xs">
                    <Label htmlFor="decision-content-limit">{tx("contentLimit")}</Label>
                    <Input
                      id="decision-content-limit"
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={draft.contentLimit}
                      placeholder="8000"
                      onChange={(event) => update({ contentLimit: event.target.value })}
                    />
                    {hasProblem("contentLimit") ? (
                      <FieldProblem>{tx("problem.contentLimit")}</FieldProblem>
                    ) : (
                      <p className="text-xs text-muted-foreground">{tx("contentLimitHint")}</p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </Card>
        </div>

        {/* ── Questions ── */}
        <div ref={questionsRef} id="section-questions">
          <Card className="p-6 space-y-5 border-2 border-border">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <SectionTitle>{tx("questionsTitle")}</SectionTitle>
                <p className="max-w-2xl text-sm text-muted-foreground">
                  {tx("questionsHint")}
                </p>
              </div>
              {examples.length > 0 ? (
                <Select value="" onValueChange={loadExample}>
                  <SelectTrigger className="w-[230px]" data-testid="decision-load-example">
                    <SelectValue placeholder={tx("loadExample")} />
                  </SelectTrigger>
                  <SelectContent>
                    {examples.map((example) => (
                      <SelectItem key={example.name} value={example.name}>
                        {example.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>

            <div className="space-y-1.5 sm:max-w-xs">
              <Label>{tx("defaultPriority")}</Label>
              <Select
                value={draft.severity}
                onValueChange={(value) => update({ severity: value as DecisionSeverity })}
              >
                <SelectTrigger className="font-mono text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DECISION_SEVERITIES.map((severity) => (
                    <SelectItem key={severity} value={severity} className="font-mono text-sm">
                      {severity}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{tx("defaultPriorityHint")}</p>
            </div>

            {draft.questions.map((question, index) => (
              <QuestionCard
                key={index}
                index={index}
                question={question}
                problems={showProblems ? questionProblems(index) : []}
                canRemove={draft.questions.length > 1}
                tx={tx}
                onChange={(delta) => updateQuestion(index, delta)}
                onTypeChange={(type) =>
                  setDraft((current) => ({
                    ...current,
                    questions: current.questions.map((entry, i) =>
                      i === index ? withQuestionType(entry, type) : entry,
                    ),
                  }))
                }
                onRemove={() =>
                  update({ questions: draft.questions.filter((_, i) => i !== index) })
                }
                onOptionChange={(optionIndex, delta) => updateOption(index, optionIndex, delta)}
                onOptionMove={(optionIndex, by) => moveOption(index, optionIndex, by)}
                onOptionAdd={() =>
                  updateQuestion(index, { options: [...question.options, blankOption()] })
                }
                onOptionRemove={(optionIndex) =>
                  updateQuestion(index, {
                    options: question.options.filter((_, i) => i !== optionIndex),
                  })
                }
              />
            ))}

            <div className="flex flex-wrap items-center gap-2">
              {DECISION_QUESTION_TYPES.map((type) => (
                <Button
                  key={type}
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid={`decision-add-${type}`}
                  disabled={draft.questions.length >= DECISION_MAX_QUESTIONS}
                  className="rounded-[4px] border-2 border-border"
                  onClick={() =>
                    update({ questions: [...draft.questions, blankQuestion(type)] })
                  }
                >
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  {tx(`add.${type}`)}
                </Button>
              ))}
            </div>
          </Card>
        </div>

        {!embedded && (
          <StickyActionToolbar
            onSaveAndRun={() => void handleSubmit().catch(() => undefined)}
            saveAndRunLabel={isSubmitting ? tx("saving") : submitLabel}
            hint={
              showProblems && !canSubmit ? (
                <Badge variant="secondary" className="font-mono text-xs">
                  {!name.trim()
                    ? tx("problem.nameMissing")
                    : firstProblem
                      ? tx(`problem.${firstProblem}`)
                      : firstQuestionProblem
                        ? tx("problem.inQuestion", {
                            number: (firstQuestionProblem.question ?? 0) + 1,
                          })
                        : null}
                </Badge>
              ) : undefined
            }
            isBusy={isSubmitting}
            saveAndRunTestId="decision-submit"
          />
        )}
      </div>

      <aside className="hidden lg:block">
        <div className="sticky top-6">
          <VerticalCustomDetectorStepperNav
            activeStepId={activeStep}
            onNavigate={(id) =>
              sectionRefs[id as DecisionStepId].current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              })
            }
            steps={steps}
          />
        </div>
      </aside>
    </div>
  );
});

// ── Endpoint URL ───────────────────────────────────────────────────────────

function ApiBaseField({
  value,
  required,
  placeholder,
  label,
  hint,
  problem,
  onChange,
}: {
  value: string;
  required: boolean;
  placeholder: string;
  label: string;
  hint: string;
  problem: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="decision-api-base">
        {label}
        {required ? " *" : ""}
      </Label>
      <Input
        id="decision-api-base"
        data-testid="decision-api-base"
        value={value}
        placeholder={placeholder}
        className="font-mono text-sm"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      {problem ? (
        <FieldProblem>{problem}</FieldProblem>
      ) : (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

// ── One question ───────────────────────────────────────────────────────────

const OPTION_FINDINGS: OptionFinding[] = ["none", "default", ...DECISION_SEVERITIES];

function QuestionCard({
  index,
  question,
  problems,
  canRemove,
  tx,
  onChange,
  onTypeChange,
  onRemove,
  onOptionChange,
  onOptionMove,
  onOptionAdd,
  onOptionRemove,
}: {
  index: number;
  question: DecisionQuestionDraft;
  problems: DecisionProblem[];
  canRemove: boolean;
  tx: (key: string, vars?: Record<string, string | number>) => string;
  onChange: (delta: Partial<DecisionQuestionDraft>) => void;
  onTypeChange: (type: DecisionQuestionType) => void;
  onRemove: () => void;
  onOptionChange: (optionIndex: number, delta: Partial<DecisionOptionDraft>) => void;
  onOptionMove: (optionIndex: number, by: -1 | 1) => void;
  onOptionAdd: () => void;
  onOptionRemove: (optionIndex: number) => void;
}) {
  const id = `decision-question-${index}`;
  const isPick = question.type !== "yes_no";
  const bounds = isPick
    ? DECISION_OPTION_BOUNDS[question.type as Exclude<DecisionQuestionType, "yes_no">]
    : null;
  const findingTypes = questionFindingTypes(question);
  const has = (problem: DecisionProblem) => problems.includes(problem);

  return (
    <div
      className="space-y-4 rounded-[4px] border-2 border-border p-4"
      data-testid={`decision-question-${index}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-2 font-mono text-xs text-muted-foreground">
            {tx("questionNumber", { number: index + 1 })}
          </span>
          {DECISION_QUESTION_TYPES.map((type) => (
            <Button
              key={type}
              type="button"
              size="sm"
              variant={question.type === type ? "default" : "outline"}
              aria-pressed={question.type === type}
              className="rounded-[4px] border-2 border-border"
              onClick={() => onTypeChange(type)}
            >
              {tx(`types.${type}.title`)}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={tx("removeQuestion")}
          disabled={!canRemove}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{tx(`types.${question.type}.hint`)}</p>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-instructions`}>{tx("instructions")} *</Label>
        <Textarea
          id={`${id}-instructions`}
          data-testid={`${id}-instructions`}
          value={question.instructions}
          rows={2}
          placeholder={tx(`types.${question.type}.placeholder`)}
          onChange={(event) => onChange({ instructions: event.target.value })}
          onBlur={() => {
            if (!question.name.trim() && question.instructions.trim()) {
              onChange({ name: suggestQuestionName(question.instructions) });
            }
          }}
        />
        {has("questionInstructions") ? (
          <FieldProblem>{tx("problem.questionInstructions")}</FieldProblem>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-name`}>{tx("questionName")} *</Label>
          <Input
            id={`${id}-name`}
            data-testid={`${id}-name`}
            value={question.name}
            placeholder="refund_request"
            className="font-mono text-sm"
            spellCheck={false}
            onChange={(event) => onChange({ name: event.target.value })}
          />
          {has("questionName") ? (
            <FieldProblem>{tx("problem.questionName")}</FieldProblem>
          ) : has("duplicateQuestion") ? (
            <FieldProblem>{tx("problem.duplicateQuestion")}</FieldProblem>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label>{tx("questionPriority")}</Label>
          <Select
            value={question.severity || "default"}
            onValueChange={(value) =>
              onChange({ severity: value === "default" ? "" : (value as DecisionSeverity) })
            }
          >
            <SelectTrigger className="font-mono text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default" className="text-sm">
                {tx("priorityDetectorDefault")}
              </SelectItem>
              {DECISION_SEVERITIES.map((severity) => (
                <SelectItem key={severity} value={severity} className="font-mono text-sm">
                  {severity}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-threshold`}>{tx("threshold")}</Label>
          <Input
            id={`${id}-threshold`}
            type="number"
            min={0}
            max={1}
            step={0.05}
            inputMode="decimal"
            value={question.threshold}
            placeholder={isPick ? "0" : "0.5"}
            onChange={(event) => onChange({ threshold: event.target.value })}
          />
          {has("threshold") ? (
            <FieldProblem>{tx("problem.threshold")}</FieldProblem>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {tx(isPick ? "thresholdPickHint" : "thresholdYesNoHint")}
      </p>

      {isPick && bounds ? (
        <div className="space-y-2">
          <Label>
            {tx(question.type === "score" ? "levels" : "choices")} *
          </Label>
          <p className="text-xs text-muted-foreground">
            {tx(question.type === "score" ? "levelsHint" : "choicesHint")}
          </p>
          {question.options.map((option, optionIndex) => (
            <div
              key={optionIndex}
              className="flex flex-wrap items-center gap-2 rounded-[4px] border border-border p-2"
            >
              {question.type === "score" ? (
                <div className="flex flex-col">
                  <button
                    type="button"
                    aria-label={tx("moveUp")}
                    disabled={optionIndex === 0}
                    className="text-muted-foreground disabled:opacity-30"
                    onClick={() => onOptionMove(optionIndex, -1)}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={tx("moveDown")}
                    disabled={optionIndex === question.options.length - 1}
                    className="text-muted-foreground disabled:opacity-30"
                    onClick={() => onOptionMove(optionIndex, 1)}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
              <Input
                value={option.label}
                placeholder={tx("optionLabelPlaceholder")}
                aria-label={tx("optionLabel")}
                data-testid={`${id}-option-${optionIndex}-label`}
                className="w-40 font-mono text-sm"
                spellCheck={false}
                onChange={(event) => onOptionChange(optionIndex, { label: event.target.value })}
              />
              <Input
                value={option.description}
                placeholder={tx("optionDescriptionPlaceholder")}
                aria-label={tx("optionDescription")}
                className="min-w-[10rem] flex-1 text-sm"
                onChange={(event) =>
                  onOptionChange(optionIndex, { description: event.target.value })
                }
              />
              <Select
                value={option.finding}
                onValueChange={(value) =>
                  onOptionChange(optionIndex, { finding: value as OptionFinding })
                }
              >
                <SelectTrigger
                  className="w-[150px] text-sm"
                  aria-label={tx("optionFinding")}
                  data-testid={`${id}-option-${optionIndex}-finding`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPTION_FINDINGS.map((finding) => (
                    <SelectItem key={finding} value={finding} className="text-sm">
                      {finding === "none"
                        ? tx("findingNone")
                        : finding === "default"
                          ? tx("findingDefault")
                          : finding}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={tx("removeOption")}
                disabled={question.options.length <= bounds[0]}
                onClick={() => onOptionRemove(optionIndex)}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          ))}
          {has("optionCount") ? (
            <FieldProblem>
              {tx("problem.optionCount", { min: bounds[0], max: bounds[1] })}
            </FieldProblem>
          ) : has("optionLabel") ? (
            <FieldProblem>{tx("problem.optionLabel")}</FieldProblem>
          ) : has("duplicateOption") ? (
            <FieldProblem>{tx("problem.duplicateOption")}</FieldProblem>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={question.options.length >= bounds[1]}
            className="rounded-[4px] border-2 border-border"
            onClick={onOptionAdd}
          >
            <Plus className="mr-2 h-3.5 w-3.5" />
            {tx(question.type === "score" ? "addLevel" : "addChoice")}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">{tx("becomes")}</span>
        {findingTypes.length > 0 ? (
          findingTypes.map((type) => (
            <Badge
              key={type}
              variant="secondary"
              className="font-mono text-xs normal-case tracking-normal"
            >
              {type}
            </Badge>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">{tx("becomesNothing")}</span>
        )}
      </div>
    </div>
  );
}
