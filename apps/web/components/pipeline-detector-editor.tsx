"use client";

import * as React from "react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  Plus,
  Trash2,
  Info,
  Upload,
  X,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import {
  Badge,
  Button,
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
import { AiAssistedCard } from "@/components/ai-assisted-card";
import { StickyActionToolbar } from "@/components/sticky-action-toolbar";
import {
  VerticalCustomDetectorStepperNav,
  HorizontalCustomDetectorStepperNav,
  type CustomDetectorStepId,
} from "@/components/custom-detector-stepper";
import { api } from "@workspace/api-client";
import type {
  TrainingExampleItem,
  TrainingExampleDto,
} from "@workspace/api-client";
import type { ParseTrainingExamplesResponseDto } from "@workspace/api-client";
import { preserveDetectorScope } from "@/lib/detector-scope";

// ── Types ──────────────────────────────────────────────────────────────────

interface EntityDefinition {
  description: string;
  required: boolean;
}

interface ClassificationDefinition {
  labels: string[];
  /** Plain-language description per label; the model reads it with the label. */
  descriptions: Record<string, string>;
  multi_label: boolean;
  /** "start" judges only the opening of a long text, where it says what it is. */
  read_from: "whole" | "start";
}

type SeverityLevel = "critical" | "high" | "medium" | "low" | "info";

interface SeverityRule {
  id: string;
  pattern: string;
  severity: SeverityLevel;
}

interface ValidationRule {
  id: string;
  field: string;
  type: "regex" | "required" | "min_confidence";
  pattern?: string;
  threshold?: number;
}

interface PipelineSchemaState {
  model: { name: string; path: string | null };
  entities: Record<string, EntityDefinition>;
  classification: Record<string, ClassificationDefinition>;
  validation: {
    confidence_threshold: number;
    rules: ValidationRule[];
  };
  severity_map: SeverityRule[];
}

export interface PipelineDetectorEditorProps {
  mode: "create" | "edit";
  submitLabel: string;
  isSubmitting?: boolean;
  detectorId?: string;
  initialName?: string;
  initialKey?: string;
  initialDescription?: string;
  initialIsActive?: boolean;
  initialPipelineSchema?: Record<string, unknown>;
  embedded?: boolean;
  onSubmit: (payload: {
    name: string;
    key?: string;
    description?: string;
    isActive?: boolean;
    pipelineSchema: Record<string, unknown>;
  }) => void | Promise<void>;
}

export interface PipelineDetectorEditorHandle {
  submit: () => Promise<void>;
}

const DEFAULT_MODEL = "fastino/gliner2.5-base-v1";

/** Checkpoints offered in the model picker; any other Hugging Face id still works. */
const MODEL_PRESETS: { id: string; label: string; hint: string }[] = [
  {
    id: "fastino/gliner2.5-base-v1",
    label: "GLiNER2.5 base",
    hint: "English. The default: accurate and fast on CPU.",
  },
  {
    id: "fastino/gliner2.5-multi-v1",
    label: "GLiNER2.5 multilingual",
    hint: "German, French and 100+ other languages. Slower and less precise on English.",
  },
  {
    id: "fastino/gliner2.5-small-v1",
    label: "GLiNER2.5 small",
    hint: "English. The fastest; use it when volume matters more than the last points of accuracy.",
  },
  {
    id: "fastino/gliner2-base-v1",
    label: "GLiNER2 base",
    hint: "Previous generation, English.",
  },
  {
    id: "fastino/gliner2-large-v1",
    label: "GLiNER2 large",
    hint: "Previous generation, English, larger.",
  },
];
const CUSTOM_MODEL = "__custom__";
const SEVERITY_LEVELS: SeverityLevel[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

function uuid4(): string {
  return crypto.randomUUID();
}

function parseInitialSchema(
  raw?: Record<string, unknown>,
): PipelineSchemaState {
  const entities: Record<string, EntityDefinition> = {};
  const rawEntities = raw?.entities;
  if (rawEntities && typeof rawEntities === "object") {
    for (const [label, defn] of Object.entries(
      rawEntities as Record<string, unknown>,
    )) {
      if (defn && typeof defn === "object") {
        const d = defn as Record<string, unknown>;
        entities[label] = {
          description: typeof d.description === "string" ? d.description : "",
          required: d.required === true,
        };
      }
    }
  }

  const classification: Record<string, ClassificationDefinition> = {};
  const rawClass = raw?.classification;
  if (rawClass && typeof rawClass === "object") {
    for (const [task, defn] of Object.entries(
      rawClass as Record<string, unknown>,
    )) {
      if (defn && typeof defn === "object") {
        const d = defn as Record<string, unknown>;
        const rawDescriptions =
          d.descriptions && typeof d.descriptions === "object"
            ? (d.descriptions as Record<string, unknown>)
            : {};
        classification[task] = {
          labels: Array.isArray(d.labels) ? d.labels.map(String) : [],
          descriptions: Object.fromEntries(
            Object.entries(rawDescriptions).filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === "string",
            ),
          ),
          multi_label: d.multi_label === true,
          read_from: d.read_from === "start" ? "start" : "whole",
        };
      }
    }
  }

  const rawValidation = raw?.validation as Record<string, unknown> | undefined;
  const rawRules = Array.isArray(rawValidation?.rules)
    ? rawValidation!.rules
    : [];
  const rules: ValidationRule[] = rawRules.map(
    (r: Record<string, unknown>) => ({
      id: uuid4(),
      field: typeof r.field === "string" ? r.field : "",
      type: (r.type as ValidationRule["type"]) ?? "regex",
      pattern: typeof r.pattern === "string" ? r.pattern : undefined,
      threshold: typeof r.threshold === "number" ? r.threshold : undefined,
    }),
  );

  const rawModel = raw?.model as Record<string, unknown> | undefined;
  const rawSeverity = Array.isArray(raw?.severity_map) ? raw!.severity_map : [];
  const severityMap: SeverityRule[] = (rawSeverity as Record<string, unknown>[])
    .filter((r) => typeof r?.pattern === "string")
    .map((r) => ({
      id: uuid4(),
      pattern: r.pattern as string,
      severity: SEVERITY_LEVELS.includes(r.severity as SeverityLevel)
        ? (r.severity as SeverityLevel)
        : "info",
    }));

  return {
    model: {
      name: typeof rawModel?.name === "string" ? rawModel.name : DEFAULT_MODEL,
      path: typeof rawModel?.path === "string" ? rawModel.path : null,
    },
    entities,
    classification,
    validation: {
      confidence_threshold:
        typeof rawValidation?.confidence_threshold === "number"
          ? rawValidation.confidence_threshold
          : 0.7,
      rules,
    },
    severity_map: severityMap,
  };
}

function toApiSchema(state: PipelineSchemaState): Record<string, unknown> {
  const entities: Record<string, unknown> = {};
  for (const [label, defn] of Object.entries(state.entities)) {
    entities[label] = {
      description: defn.description,
      required: defn.required,
    };
  }

  const classification: Record<string, unknown> = {};
  for (const [task, defn] of Object.entries(state.classification)) {
    const descriptions = Object.fromEntries(
      defn.labels
        .map(
          (label) => [label, (defn.descriptions[label] ?? "").trim()] as const,
        )
        .filter(([, text]) => text.length > 0),
    );
    classification[task] = {
      labels: defn.labels,
      ...(Object.keys(descriptions).length > 0 ? { descriptions } : {}),
      multi_label: defn.multi_label,
      read_from: defn.read_from,
    };
  }

  return {
    type: "GLINER2",
    model: state.model,
    entities,
    classification,
    validation: {
      confidence_threshold: state.validation.confidence_threshold,
      rules: state.validation.rules.map(({ id: _id, ...r }) => r),
    },
    severity_map: state.severity_map
      .filter((r) => r.pattern.trim().length > 0)
      .map(({ id: _id, pattern, severity }) => ({
        pattern: pattern.trim(),
        severity,
      })),
  };
}

// ── Entities section ───────────────────────────────────────────────────────

function EntitiesSection({
  entities,
  onChange,
}: {
  entities: Record<string, EntityDefinition>;
  onChange: (next: Record<string, EntityDefinition>) => void;
}) {
  const [newLabel, setNewLabel] = useState("");

  const addEntity = () => {
    const label = newLabel.trim().replace(/\s+/g, "_").toLowerCase();
    if (!label || label in entities) return;
    onChange({ ...entities, [label]: { description: "", required: false } });
    setNewLabel("");
  };

  const updateEntity = (label: string, patch: Partial<EntityDefinition>) => {
    onChange({ ...entities, [label]: { ...entities[label]!, ...patch } });
  };

  const removeEntity = (label: string) => {
    const next = { ...entities };
    delete next[label];
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Name the facts to pull out of the text. Each one becomes a finding with
        the exact words and their position. A one-line description with an
        example (e.g. <em>&ldquo;Order ID like ORD-123&rdquo;</em>) is the
        model&rsquo;s only instruction.
      </p>

      {Object.entries(entities).map(([label, defn]) => (
        <div
          key={label}
          className="rounded-[4px] border border-border bg-background p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm font-bold">{label}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeEntity(label)}
              className="h-7 w-7 p-0 text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide">
              Description
            </Label>
            <Input
              data-testid={`gliner2-entity-desc-${label}`}
              value={defn.description}
              onChange={(e) =>
                updateEntity(label, { description: e.target.value })
              }
              placeholder='e.g. "Order ID like ORD-123"'
              className="h-9 text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Include format examples — this is your model prompt.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id={`req-${label}`}
              checked={defn.required}
              onCheckedChange={(checked) =>
                updateEntity(label, { required: checked })
              }
            />
            <Label htmlFor={`req-${label}`} className="text-xs">
              Required — suppress all findings if this entity is absent
            </Label>
          </div>
        </div>
      ))}

      <div className="flex gap-2">
        <Input
          data-testid="gliner2-entity-label-input"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addEntity()}
          placeholder="entity_label (e.g. order_id)"
          className="h-9 font-mono text-sm"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addEntity}
          data-testid="gliner2-add-entity-btn"
          className="h-9 whitespace-nowrap"
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add Entity
        </Button>
      </div>
    </div>
  );
}

// ── Classification section ─────────────────────────────────────────────────

function ClassificationSection({
  classification,
  onChange,
}: {
  classification: Record<string, ClassificationDefinition>;
  onChange: (next: Record<string, ClassificationDefinition>) => void;
}) {
  const [newTask, setNewTask] = useState("");
  const [labelInput, setLabelInput] = useState<Record<string, string>>({});

  const addTask = () => {
    const task = newTask.trim().replace(/\s+/g, "_").toLowerCase();
    if (!task || task in classification) return;
    onChange({
      ...classification,
      [task]: {
        labels: [],
        descriptions: {},
        multi_label: false,
        read_from: "whole",
      },
    });
    setNewTask("");
  };

  const removeTask = (task: string) => {
    const next = { ...classification };
    delete next[task];
    onChange(next);
  };

  const addLabel = (task: string) => {
    const label = (labelInput[task] ?? "").trim();
    if (!label) return;
    const current = classification[task]!;
    if (current.labels.includes(label)) return;
    onChange({
      ...classification,
      [task]: { ...current, labels: [...current.labels, label] },
    });
    setLabelInput((prev) => ({ ...prev, [task]: "" }));
  };

  const removeLabel = (task: string, label: string) => {
    const current = classification[task]!;
    const descriptions = { ...current.descriptions };
    delete descriptions[label];
    onChange({
      ...classification,
      [task]: {
        ...current,
        labels: current.labels.filter((l) => l !== label),
        descriptions,
      },
    });
  };

  const describeLabel = (task: string, label: string, text: string) => {
    const current = classification[task]!;
    onChange({
      ...classification,
      [task]: {
        ...current,
        descriptions: { ...current.descriptions, [label]: text },
      },
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Define zero-shot classification tasks. Each task gets a set of candidate
        labels; the model scores them in the same pass as the entities. A short
        description per label tells the model what the label means and is the
        cheapest way to raise accuracy.
      </p>

      {Object.entries(classification).map(([task, defn]) => (
        <div
          key={task}
          className="rounded-[4px] border border-border bg-background p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm font-bold">{task}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeTask(task)}
              className="h-7 w-7 p-0 text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide">Labels</Label>
            <div className="mb-2 space-y-1.5">
              {defn.labels.map((label) => (
                <div key={label} className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="w-40 shrink-0 justify-start truncate rounded-[4px] font-mono text-xs"
                    title={label}
                  >
                    {label}
                  </Badge>
                  <Input
                    data-testid={`gliner2-label-desc-${task}-${label}`}
                    value={defn.descriptions[label] ?? ""}
                    onChange={(e) => describeLabel(task, label, e.target.value)}
                    placeholder="What this label means (optional)"
                    className="h-8 text-sm"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeLabel(task, label)}
                    aria-label={`Remove label ${label}`}
                    className="h-8 w-8 shrink-0 p-0 text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={labelInput[task] ?? ""}
                onChange={(e) =>
                  setLabelInput((prev) => ({ ...prev, [task]: e.target.value }))
                }
                onKeyDown={(e) => e.key === "Enter" && addLabel(task)}
                placeholder="e.g. refund"
                className="h-8 font-mono text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addLabel(task)}
                className="h-8"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id={`ml-${task}`}
              checked={defn.multi_label}
              onCheckedChange={(checked) =>
                onChange({
                  ...classification,
                  [task]: { ...defn, multi_label: checked },
                })
              }
            />
            <Label htmlFor={`ml-${task}`} className="text-xs">
              Multi-label — every label above the threshold becomes its own
              finding
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id={`start-${task}`}
              data-testid={`gliner2-read-start-${task}`}
              checked={defn.read_from === "start"}
              onCheckedChange={(checked) =>
                onChange({
                  ...classification,
                  [task]: { ...defn, read_from: checked ? "start" : "whole" },
                })
              }
            />
            <Label htmlFor={`start-${task}`} className="text-xs">
              Judge from the opening only — best for the type of a document,
              which its title and first paragraphs state
            </Label>
          </div>
        </div>
      ))}

      <div className="flex gap-2">
        <Input
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTask()}
          placeholder="task_name (e.g. intent)"
          className="h-9 font-mono text-sm"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addTask}
          className="h-9 whitespace-nowrap"
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add Task
        </Button>
      </div>
    </div>
  );
}

// ── Validation section ─────────────────────────────────────────────────────

function ValidationSection({
  validation,
  onChange,
}: {
  validation: PipelineSchemaState["validation"];
  onChange: (next: PipelineSchemaState["validation"]) => void;
}) {
  const addRule = () => {
    onChange({
      ...validation,
      rules: [
        ...validation.rules,
        { id: uuid4(), field: "", type: "regex", pattern: "" },
      ],
    });
  };

  const removeRule = (id: string) => {
    onChange({
      ...validation,
      rules: validation.rules.filter((r) => r.id !== id),
    });
  };

  const updateRule = (id: string, patch: Partial<ValidationRule>) => {
    onChange({
      ...validation,
      rules: validation.rules.map((r) =>
        r.id === id ? { ...r, ...patch } : r,
      ),
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Post-processing rules applied after extraction. Use these for business
        logic — not for the model.
      </p>

      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wide">
          Global confidence threshold
        </Label>
        <div className="flex items-center gap-3">
          <Input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={validation.confidence_threshold}
            onChange={(e) =>
              onChange({
                ...validation,
                confidence_threshold: Math.min(
                  1,
                  Math.max(0, Number(e.target.value)),
                ),
              })
            }
            className="h-9 w-32"
          />
          <span className="text-xs text-muted-foreground">
            Entities and classifications below this score are discarded.
          </span>
        </div>
      </div>

      {validation.rules.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide">Rules</Label>
          {validation.rules.map((rule) => (
            <div
              key={rule.id}
              className="rounded-[4px] border border-border bg-background p-3 space-y-2"
            >
              <div className="flex items-center gap-2">
                <Input
                  placeholder="field (e.g. order_id)"
                  value={rule.field}
                  onChange={(e) =>
                    updateRule(rule.id, { field: e.target.value })
                  }
                  className="h-8 font-mono text-sm"
                />
                <Select
                  value={rule.type}
                  onValueChange={(value) =>
                    updateRule(rule.id, {
                      type: value as ValidationRule["type"],
                    })
                  }
                >
                  <SelectTrigger className="h-8 w-44 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="regex">Regex pattern</SelectItem>
                    <SelectItem value="required">Required field</SelectItem>
                    <SelectItem value="min_confidence">
                      Min confidence
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeRule(rule.id)}
                  className="h-8 w-8 p-0 text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {rule.type === "regex" && (
                <Input
                  placeholder="regex pattern (e.g. ^ORD-\d+$)"
                  value={rule.pattern ?? ""}
                  onChange={(e) =>
                    updateRule(rule.id, { pattern: e.target.value })
                  }
                  className="h-8 font-mono text-sm"
                />
              )}
              {rule.type === "min_confidence" && (
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  placeholder="0.8"
                  value={rule.threshold ?? ""}
                  onChange={(e) =>
                    updateRule(rule.id, { threshold: Number(e.target.value) })
                  }
                  className="h-8 w-32"
                />
              )}
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addRule}
        className="h-9"
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        Add validation rule
      </Button>
    </div>
  );
}

// ── Severity section ───────────────────────────────────────────────────────

function SeveritySection({
  rules,
  onChange,
}: {
  rules: SeverityRule[];
  onChange: (next: SeverityRule[]) => void;
}) {
  const update = (id: string, patch: Partial<SeverityRule>) =>
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Severity is set by what was found, not by how sure the model is. Each
        rule matches an entity label, a classification task or a chosen label
        (case insensitive); the first match wins. Findings that match no rule
        are <code className="font-mono text-xs">info</code>.
      </p>
      {rules.map((rule) => (
        <div key={rule.id} className="flex items-center gap-2">
          <Input
            data-testid="gliner2-severity-pattern"
            value={rule.pattern}
            onChange={(e) => update(rule.id, { pattern: e.target.value })}
            placeholder="label or task (e.g. notice_period)"
            className="h-8 font-mono text-sm"
          />
          <Select
            value={rule.severity}
            onValueChange={(value) =>
              update(rule.id, { severity: value as SeverityLevel })
            }
          >
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEVERITY_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(rules.filter((r) => r.id !== rule.id))}
            aria-label="Remove severity rule"
            className="h-8 w-8 p-0 text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([...rules, { id: uuid4(), pattern: "", severity: "medium" }])
        }
        className="h-9"
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        Add severity rule
      </Button>
    </div>
  );
}

// ── Model section ──────────────────────────────────────────────────────────

function ModelSection({
  model,
  onChange,
}: {
  model: PipelineSchemaState["model"];
  onChange: (next: PipelineSchemaState["model"]) => void;
}) {
  const preset = MODEL_PRESETS.find((p) => p.id === model.name);
  const [custom, setCustom] = useState(!preset);
  const selected = custom ? CUSTOM_MODEL : model.name;

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground flex items-start gap-2">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          The model runs inside the scan on CPU; no text leaves your
          infrastructure. Both GLiNER2.5 and GLiNER2 checkpoints load, as do
          fine-tunes of either.
        </span>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wide">Model</Label>
        <Select
          value={selected}
          onValueChange={(value) => {
            if (value === CUSTOM_MODEL) {
              setCustom(true);
              return;
            }
            setCustom(false);
            onChange({ ...model, name: value });
          }}
        >
          <SelectTrigger
            data-testid="gliner2-model-select"
            className="h-9 text-sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODEL_PRESETS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_MODEL}>
              Other Hugging Face model…
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          {custom
            ? "Any GLiNER2-family checkpoint on the Hugging Face Hub."
            : preset?.hint}
        </p>
      </div>
      {custom && (
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wide">
            Hugging Face model ID
          </Label>
          <Input
            data-testid="gliner2-model-id"
            value={model.name}
            onChange={(e) => onChange({ ...model, name: e.target.value })}
            placeholder={DEFAULT_MODEL}
            className="h-9 font-mono text-sm"
          />
        </div>
      )}
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wide">
          Local model path (optional)
        </Label>
        <Input
          value={model.path ?? ""}
          onChange={(e) => onChange({ ...model, path: e.target.value || null })}
          placeholder="/path/to/model — overrides the model above when set"
          className="h-9 font-mono text-sm"
        />
      </div>
    </div>
  );
}

// ── Training section ───────────────────────────────────────────────────────

type TrainingState = {
  /** Examples staged in the UI (parsed from upload, not yet saved) */
  staged: TrainingExampleItem[];
  /** Examples already persisted in the API */
  saved: TrainingExampleDto[];
  parseResult: ParseTrainingExamplesResponseDto | null;
  isParsing: boolean;
  isSaving: boolean;
  isTraining: boolean;
  lastTrainedAt: string | null;
  error: string | null;
};

function TrainingSection({
  detectorId,
  pipelineSchema,
}: {
  detectorId: string | undefined;
  pipelineSchema: Record<string, unknown>;
}) {
  const [state, setState] = useState<TrainingState>({
    staged: [],
    saved: [],
    parseResult: null,
    isParsing: false,
    isSaving: false,
    isTraining: false,
    lastTrainedAt: null,
    error: null,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load persisted examples when detector ID is known
  useEffect(() => {
    if (!detectorId) return;
    api
      .listTrainingExamples(detectorId)
      .then((examples) => setState((s) => ({ ...s, saved: examples })))
      .catch(() => undefined);
  }, [detectorId]);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setState((s) => ({
        ...s,
        isParsing: true,
        error: null,
        parseResult: null,
      }));
      try {
        const result = await api.parseCustomDetectorTrainingExamples(
          file,
          file.name,
        );
        const staged: TrainingExampleItem[] = result.examples.map((ex) => ({
          label: ex.label,
          text: ex.text,
          accepted: ex.accepted,
          source: ex.source ?? file.name,
        }));
        setState((s) => ({
          ...s,
          isParsing: false,
          parseResult: result,
          staged,
        }));
      } catch (err) {
        setState((s) => ({
          ...s,
          isParsing: false,
          error: err instanceof Error ? err.message : "Upload failed",
        }));
      }
      // Reset file input so re-uploading same file re-triggers
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [],
  );

  const handleSaveExamples = useCallback(async () => {
    if (!detectorId || state.staged.length === 0) return;
    setState((s) => ({ ...s, isSaving: true, error: null }));
    try {
      await api.saveTrainingExamples(detectorId, state.staged, false);
      const refreshed = await api.listTrainingExamples(detectorId);
      setState((s) => ({
        ...s,
        isSaving: false,
        saved: refreshed,
        staged: [],
        parseResult: null,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        isSaving: false,
        error: err instanceof Error ? err.message : "Failed to save examples",
      }));
    }
  }, [detectorId, state.staged]);

  const handleClearAll = useCallback(async () => {
    if (!detectorId) return;
    setState((s) => ({ ...s, isSaving: true, error: null }));
    try {
      await api.clearTrainingExamples(detectorId);
      setState((s) => ({
        ...s,
        isSaving: false,
        saved: [],
        staged: [],
        parseResult: null,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        isSaving: false,
        error: err instanceof Error ? err.message : "Failed to clear examples",
      }));
    }
  }, [detectorId]);

  const handleDeleteSaved = useCallback(
    async (exampleId: string) => {
      if (!detectorId) return;
      try {
        await api.deleteTrainingExample(detectorId, exampleId);
        setState((s) => ({
          ...s,
          saved: s.saved.filter((e) => e.id !== exampleId),
        }));
      } catch {
        /* ignore */
      }
    },
    [detectorId],
  );

  const handleTrain = useCallback(async () => {
    if (!detectorId) return;
    setState((s) => ({ ...s, isTraining: true, error: null }));
    try {
      const run = await api.trainCustomDetector(detectorId, {});
      setState((s) => ({
        ...s,
        isTraining: false,
        lastTrainedAt: run.completedAt
          ? new Date(run.completedAt).toLocaleString()
          : null,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        isTraining: false,
        error: err instanceof Error ? err.message : "Training failed",
      }));
    }
  }, [detectorId]);

  const toggleStaged = (index: number) => {
    setState((s) => ({
      ...s,
      staged: s.staged.map((ex, i) =>
        i === index ? { ...ex, accepted: !ex.accepted } : ex,
      ),
    }));
  };

  const removeStagedItem = (index: number) => {
    setState((s) => ({ ...s, staged: s.staged.filter((_, i) => i !== index) }));
  };

  const entityLabels = Object.keys(
    (pipelineSchema.entities as Record<string, unknown>) ?? {},
  );
  const classLabels: string[] = Object.values(
    (pipelineSchema.classification as Record<string, { labels: string[] }>) ??
      {},
  ).flatMap((t) => t.labels ?? []);
  const knownLabels = new Set([...entityLabels, ...classLabels]);

  const totalSaved = state.saved.length;
  const positiveSaved = state.saved.filter((e) => e.accepted).length;

  return (
    <div className="space-y-6">
      {/* Info */}
      <p className="text-sm text-muted-foreground">
        Upload labeled examples to fine-tune GLiNER2 for entities (include the
        exact span value) or SetFit for classification tasks. Training is
        optional — the detector works zero-shot without any examples.
      </p>

      {/* Format reference */}
      <div className="rounded-[4px] border border-border bg-muted/30 p-3 text-xs font-mono space-y-1 text-muted-foreground">
        <div className="font-bold text-foreground uppercase tracking-wide text-[10px] mb-2">
          Expected CSV columns
        </div>
        <div>
          <span className="text-foreground">text</span> — context passage
          (required)
        </div>
        <div>
          <span className="text-foreground">label</span> — entity label or
          classification label (required)
        </div>
        <div>
          <span className="text-foreground">value</span> — exact entity span
          text, e.g. "ORD-123" (NER only)
        </div>
      </div>

      {/* Upload */}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.txt,.json,.xlsx,.md,.log"
          className="hidden"
          data-testid="gliner2-training-file-input"
          onChange={(e) => void handleFileChange(e)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={state.isParsing}
          className="h-9 gap-2"
        >
          {state.isParsing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          {state.isParsing ? "Parsing…" : "Upload CSV / TSV / XLSX / JSON"}
        </Button>
        {state.parseResult && (
          <p
            data-testid="gliner2-parse-result"
            className="mt-1.5 text-[11px] text-muted-foreground"
          >
            Parsed {state.parseResult.importedRows} rows
            {state.parseResult.skippedRows > 0 &&
              `, ${state.parseResult.skippedRows} skipped`}{" "}
            from <span className="font-mono">{state.parseResult.format}</span>
          </p>
        )}
      </div>

      {/* Staged examples preview */}
      {state.staged.length > 0 && (
        <div data-testid="gliner2-staged-examples" className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs uppercase tracking-wide">
              Staged — {state.staged.length} examples
            </Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={() =>
                  setState((s) => ({ ...s, staged: [], parseResult: null }))
                }
              >
                Discard
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={state.isSaving || !detectorId}
                onClick={() => void handleSaveExamples()}
                className="h-7 text-xs"
              >
                {state.isSaving ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : null}
                Save {state.staged.length} examples
              </Button>
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto rounded-[4px] border border-border divide-y divide-border">
            {state.staged.map((ex, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2 text-xs">
                <button
                  type="button"
                  onClick={() => toggleStaged(i)}
                  className="mt-0.5 shrink-0"
                  title={ex.accepted ? "Mark as negative" : "Mark as positive"}
                >
                  {ex.accepted ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-destructive" />
                  )}
                </button>
                <span
                  className={`font-mono shrink-0 rounded-[3px] border px-1 py-0.5 text-[10px] ${
                    knownLabels.has(ex.label)
                      ? "border-border bg-muted"
                      : "border-amber-300 bg-amber-50 text-amber-700"
                  }`}
                >
                  {ex.label}
                  {!knownLabels.has(ex.label) && " ⚠"}
                </span>
                {ex.value && (
                  <span className="font-mono text-foreground shrink-0 rounded-[3px] bg-primary/10 px-1 py-0.5 text-[10px]">
                    {ex.value}
                  </span>
                )}
                <span className="text-muted-foreground truncate flex-1">
                  {ex.text}
                </span>
                <button
                  type="button"
                  onClick={() => removeStagedItem(i)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Saved examples */}
      {state.saved.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs uppercase tracking-wide">
              Saved — {positiveSaved} positive · {totalSaved - positiveSaved}{" "}
              negative
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => void handleClearAll()}
              disabled={state.isSaving}
            >
              Clear all
            </Button>
          </div>
          <div className="max-h-48 overflow-y-auto rounded-[4px] border border-border divide-y divide-border">
            {state.saved.map((ex) => (
              <div
                key={ex.id}
                className="flex items-start gap-2 px-3 py-2 text-xs"
              >
                {ex.accepted ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5 text-green-600" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-destructive" />
                )}
                <span
                  className={`font-mono shrink-0 rounded-[3px] border px-1 py-0.5 text-[10px] ${
                    knownLabels.has(ex.label)
                      ? "border-border bg-muted"
                      : "border-amber-300 bg-amber-50 text-amber-700"
                  }`}
                >
                  {ex.label}
                </span>
                {ex.value && (
                  <span className="font-mono shrink-0 rounded-[3px] bg-primary/10 px-1 py-0.5 text-[10px]">
                    {ex.value}
                  </span>
                )}
                <span className="text-muted-foreground truncate flex-1">
                  {ex.text}
                </span>
                <button
                  type="button"
                  onClick={() => void handleDeleteSaved(ex.id)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      {/* Train button */}
      {detectorId && (
        <div className="flex items-center gap-4 pt-2 border-t border-border">
          <Button
            type="button"
            onClick={() => void handleTrain()}
            disabled={state.isTraining || totalSaved === 0}
            className="h-9 gap-2"
          >
            {state.isTraining && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            {state.isTraining ? "Training…" : "Fine-tune detector"}
          </Button>
          {totalSaved === 0 && (
            <p className="text-xs text-muted-foreground">
              Save examples first to enable training
            </p>
          )}
          {state.lastTrainedAt && (
            <p className="text-xs text-muted-foreground">
              Last trained: {state.lastTrainedAt}
            </p>
          )}
        </div>
      )}

      {!detectorId && (
        <p className="text-sm text-muted-foreground italic">
          Save the detector first to upload training examples and trigger
          fine-tuning.
        </p>
      )}
    </div>
  );
}

// ── Error block ────────────────────────────────────────────────────────────

function ErrorBlock({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="mt-3 rounded-[4px] border-2 border-destructive bg-destructive/5 p-4 space-y-1">
      {errors.map((err) => (
        <p key={err} className="text-sm text-destructive">
          {err}
        </p>
      ))}
    </div>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="mb-4">
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-0.5">
        GLiNER2 Extraction
      </div>
      <h2 className="font-serif text-2xl font-black uppercase tracking-[0.06em]">
        {label}
      </h2>
    </div>
  );
}

// ── Main editor ────────────────────────────────────────────────────────────

export const PipelineDetectorEditor = React.forwardRef<
  PipelineDetectorEditorHandle,
  PipelineDetectorEditorProps
>(function PipelineDetectorEditor(
  {
    mode,
    submitLabel,
    isSubmitting = false,
    detectorId,
    initialName = "",
    initialKey = "",
    initialDescription = "",
    initialIsActive = true,
    initialPipelineSchema,
    embedded,
    onSubmit,
  },
  ref,
) {
  const [name, setName] = useState(initialName);
  const [key, setKey] = useState(initialKey);
  const [description, setDescription] = useState(initialDescription);
  const [isActive, setIsActive] = useState(initialIsActive);
  const [pipeline, setPipeline] = useState<PipelineSchemaState>(() =>
    parseInitialSchema(initialPipelineSchema),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [activeStepId, setActiveStepId] =
    useState<CustomDetectorStepId>("identity");

  const identityRef = useRef<HTMLDivElement>(null);
  const entitiesRef = useRef<HTMLDivElement>(null);
  const classificationRef = useRef<HTMLDivElement>(null);
  const validationRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const trainingRef = useRef<HTMLDivElement>(null);

  const sectionRefs: Record<
    CustomDetectorStepId,
    RefObject<HTMLDivElement | null>
  > = {
    identity: identityRef,
    entities: entitiesRef,
    classification: classificationRef,
    validation: validationRef,
    model: modelRef,
    training: trainingRef,
  };

  // Scroll-spy: highlight whichever section top edge crosses 40% from top of viewport
  useEffect(() => {
    const stepIds: CustomDetectorStepId[] = [
      "identity",
      "entities",
      "classification",
      "validation",
      "model",
      "training",
    ];
    const els = stepIds
      .map((id) => ({ id, el: sectionRefs[id].current }))
      .filter(
        (x): x is { id: CustomDetectorStepId; el: HTMLDivElement } =>
          x.el !== null,
      );

    const map = new Map<Element, CustomDetectorStepId>(
      els.map(({ id, el }) => [el, id]),
    );

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = map.get(entry.target);
            if (id) setActiveStepId(id);
          }
        }
      },
      { rootMargin: "0px 0px -60% 0px", threshold: 0 },
    );

    els.forEach(({ el }) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrollToSection = (id: CustomDetectorStepId) => {
    sectionRefs[id].current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const validate = (): string[] => {
    const errs: string[] = [];
    if (!name.trim()) errs.push("Detector name is required");
    for (const [label, defn] of Object.entries(pipeline.entities)) {
      if (!defn.description.trim()) {
        errs.push(`Entity "${label}" is missing a description`);
      }
    }
    for (const [task, defn] of Object.entries(pipeline.classification)) {
      if (defn.labels.length === 0) {
        errs.push(`Classification task "${task}" must have at least one label`);
      }
    }
    if (
      Object.keys(pipeline.entities).length === 0 &&
      Object.keys(pipeline.classification).length === 0
    ) {
      errs.push("Define at least one entity or one classification task");
    }
    return errs;
  };

  const handleSubmit = async () => {
    const errs = validate();
    setErrors(errs);
    if (errs.length > 0) {
      if (errs.some((e) => e.toLowerCase().includes("name"))) {
        scrollToSection("identity");
      } else if (errs.some((e) => e.toLowerCase().includes("entit"))) {
        scrollToSection("entities");
      } else if (errs.some((e) => e.toLowerCase().includes("classif"))) {
        scrollToSection("classification");
      }
      throw new Error("Validation failed");
    }

    await onSubmit({
      name: name.trim(),
      key: key.trim() || undefined,
      description: description.trim() || undefined,
      isActive,
      pipelineSchema: preserveDetectorScope(
        initialPipelineSchema,
        toApiSchema(pipeline),
      ),
    });
  };

  React.useImperativeHandle(ref, () => ({
    submit: handleSubmit,
  }));

  const identityErrors = errors.filter((e) => e.toLowerCase().includes("name"));
  const entityErrors = errors.filter((e) => e.toLowerCase().includes("entit"));
  const classErrors = errors.filter((e) => e.toLowerCase().includes("classif"));

  const entityCount = Object.keys(pipeline.entities).length;
  const classCount = Object.keys(pipeline.classification).length;
  const ruleCount = pipeline.validation.rules.length;

  const badge = (count: number, singular: string, plural = `${singular}s`) =>
    count > 0 ? `${count} ${count === 1 ? singular : plural}` : undefined;

  return (
    <div>
      {/* Mobile sticky horizontal nav */}
      <div className="sticky top-0 z-20 -mx-4 mb-6 border-b-2 border-border bg-background/95 px-4 py-2 backdrop-blur-sm md:hidden">
        <HorizontalCustomDetectorStepperNav
          activeStepId={activeStepId}
          onNavigate={scrollToSection}
        />
      </div>

      {/* Desktop: content + right sticky sidebar */}
      <div className="flex gap-8 lg:gap-12">
        {/* Scrollable content */}
        <div className="min-w-0 flex-1 space-y-16 pb-32">
          {/* ── Identity ── */}
          <section ref={identityRef}>
            <SectionLabel label="Identity" />
            <AiAssistedCard
              title="Detector identity"
              description="Give your detector a name, stable key, and optional description."
            >
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="detector-name"
                      className="text-xs uppercase tracking-wide"
                    >
                      Name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="detector-name"
                      data-testid="gliner2-name"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        if (errors.length > 0) setErrors(validate());
                      }}
                      placeholder="Support Ticket Extractor"
                      className={`h-9 ${identityErrors.some((e) => e.includes("name")) ? "border-destructive" : ""}`}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="detector-key"
                      className="text-xs uppercase tracking-wide"
                    >
                      Key{" "}
                      <span className="text-muted-foreground text-[10px]">
                        (auto-generated if empty)
                      </span>
                    </Label>
                    <Input
                      id="detector-key"
                      data-testid="gliner2-key"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      placeholder="cust_support_ticket_extractor"
                      className="h-9 font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="detector-description"
                    className="text-xs uppercase tracking-wide"
                  >
                    Description
                  </Label>
                  <Textarea
                    id="detector-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Extracts order IDs, amounts, and intent from support tickets"
                    rows={2}
                    className="text-sm resize-none"
                  />
                </div>

                {mode === "edit" && (
                  <div className="flex items-center gap-2 pt-1">
                    <Switch
                      id="detector-active"
                      checked={isActive}
                      onCheckedChange={setIsActive}
                    />
                    <Label htmlFor="detector-active" className="text-sm">
                      Active — available for source configuration
                    </Label>
                  </div>
                )}
              </div>
            </AiAssistedCard>
            <ErrorBlock errors={identityErrors} />
          </section>

          {/* ── Entities ── */}
          <section ref={entitiesRef}>
            <SectionLabel label="Entities" />
            <AiAssistedCard
              title="Named entity extraction"
              description={
                badge(entityCount, "entity", "entities") ??
                "No entities defined yet"
              }
            >
              <EntitiesSection
                entities={pipeline.entities}
                onChange={(entities) =>
                  setPipeline((p) => ({ ...p, entities }))
                }
              />
            </AiAssistedCard>
            <ErrorBlock errors={entityErrors} />
          </section>

          {/* ── Classification ── */}
          <section ref={classificationRef}>
            <SectionLabel label="Classification" />
            <AiAssistedCard
              title="Zero-shot classification"
              description={
                badge(classCount, "task") ??
                "No classification tasks defined yet"
              }
            >
              <ClassificationSection
                classification={pipeline.classification}
                onChange={(classification) =>
                  setPipeline((p) => ({ ...p, classification }))
                }
              />
            </AiAssistedCard>
            <ErrorBlock errors={classErrors} />
          </section>

          {/* ── Validation ── */}
          <section ref={validationRef}>
            <SectionLabel label="Validation" />
            <AiAssistedCard
              title="Post-processing rules"
              description={
                badge(ruleCount, "rule") ?? "Confidence threshold only"
              }
            >
              <ValidationSection
                validation={pipeline.validation}
                onChange={(validation) =>
                  setPipeline((p) => ({ ...p, validation }))
                }
              />
            </AiAssistedCard>
            <div className="mt-4">
              <AiAssistedCard
                title="Severity"
                description={
                  badge(pipeline.severity_map.length, "rule") ??
                  "Everything is info"
                }
              >
                <SeveritySection
                  rules={pipeline.severity_map}
                  onChange={(severity_map) =>
                    setPipeline((p) => ({ ...p, severity_map }))
                  }
                />
              </AiAssistedCard>
            </div>
          </section>

          {/* ── Model ── */}
          <section ref={modelRef}>
            <SectionLabel label="Model" />
            <AiAssistedCard
              title="Extraction model"
              description={pipeline.model.name}
            >
              <ModelSection
                model={pipeline.model}
                onChange={(model) => setPipeline((p) => ({ ...p, model }))}
              />
            </AiAssistedCard>
          </section>

          {/* ── Training ── */}
          <section ref={trainingRef}>
            <SectionLabel label="Training" />
            <AiAssistedCard
              title="Fine-tuning examples"
              description={
                detectorId
                  ? "Upload labeled examples to improve accuracy"
                  : "Save detector first to enable training"
              }
            >
              <TrainingSection
                detectorId={detectorId}
                pipelineSchema={toApiSchema(pipeline)}
              />
            </AiAssistedCard>
          </section>
        </div>

        {/* Right sticky sidebar — desktop only */}
        <aside className="hidden self-start md:sticky md:top-6 md:block md:w-44 lg:w-52">
          <VerticalCustomDetectorStepperNav
            activeStepId={activeStepId}
            onNavigate={scrollToSection}
          />
        </aside>
      </div>

      {/* Sticky bottom action toolbar — shared with source create/edit */}
      {!embedded && (
        <StickyActionToolbar
          onSaveAndRun={() => void handleSubmit()}
          saveAndRunLabel={isSubmitting ? "Saving…" : submitLabel}
          hint={
            errors.length > 0 ? (
              <span className="text-sm text-destructive">
                {errors.length === 1
                  ? errors[0]
                  : `${errors.length} errors — fix them before saving`}
              </span>
            ) : undefined
          }
          isBusy={isSubmitting}
          saveAndRunTestId="gliner2-submit-btn"
          className="mt-6"
        />
      )}
    </div>
  );
});
