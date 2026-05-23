"use client";

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Plus, Trash2, Play, AlertTriangle } from "lucide-react";
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
import { AiAssistedCard } from "@/components/ai-assisted-card";
import {
  VerticalCustomDetectorStepperNav,
  HorizontalCustomDetectorStepperNav,
} from "@/components/custom-detector-stepper";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

// ── Types ──────────────────────────────────────────────────────────────────

type RegexStepId = "identity" | "patterns" | "test";

type SeverityLevel = "critical" | "high" | "medium" | "low" | "info" | "";

interface RegexPatternState {
  name: string;
  pattern: string;
  description: string;
  severity: SeverityLevel;
  case_sensitive: boolean;
  dot_nl: boolean;
  group: number;
}

interface TestMatch {
  patternName: string;
  value: string;
  start: number;
  end: number;
  groupValue?: string;
}

export interface RegexDetectorEditorProps {
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

export interface RegexDetectorEditorHandle {
  submit: () => Promise<void>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseInitialPatterns(
  raw?: Record<string, unknown>,
): RegexPatternState[] {
  const result: RegexPatternState[] = [];
  const rawPatterns = raw?.patterns;
  if (rawPatterns && typeof rawPatterns === "object") {
    for (const [name, defn] of Object.entries(
      rawPatterns as Record<string, Record<string, unknown>>,
    )) {
      if (defn && typeof defn === "object") {
        result.push({
          name,
          pattern: typeof defn.pattern === "string" ? defn.pattern : "",
          description: typeof defn.description === "string" ? defn.description : "",
          severity: typeof defn.severity === "string" ? (defn.severity as SeverityLevel) : "",
          case_sensitive: defn.case_sensitive !== false,
          dot_nl: defn.dot_nl === true,
          group: typeof defn.group === "number" ? defn.group : 0,
        });
      }
    }
  }
  return result;
}

function toApiSchema(patterns: RegexPatternState[]): Record<string, unknown> {
  const apiPatterns: Record<string, unknown> = {};
  for (const p of patterns) {
    const key = p.name.trim().replace(/\s+/g, "_").toLowerCase();
    if (!key) continue;
    const entry: Record<string, unknown> = { pattern: p.pattern };
    if (p.description) entry.description = p.description;
    if (p.severity) entry.severity = p.severity;
    if (!p.case_sensitive) entry.case_sensitive = false;
    if (p.dot_nl) entry.dot_nl = true;
    if (p.group > 0) entry.group = p.group;
    apiPatterns[key] = entry;
  }
  return { type: "REGEX", patterns: apiPatterns };
}

function runTestMatches(
  patterns: RegexPatternState[],
  text: string,
): TestMatch[] {
  if (!text.trim()) return [];
  const matches: TestMatch[] = [];

  for (const p of patterns) {
    if (!p.pattern) continue;
    const patternKey = p.name.trim().replace(/\s+/g, "_").toLowerCase() || "unnamed";
    try {
      let flags = "g";
      if (!p.case_sensitive) flags += "i";
      if (p.dot_nl) flags += "s";
      const rx = new RegExp(p.pattern, flags);
      let m: RegExpExecArray | null;
      let safety = 0;
      while ((m = rx.exec(text)) !== null && safety < 500) {
        safety++;
        const groupIdx = p.group;
        const groupValue = groupIdx > 0 && m[groupIdx] !== undefined ? m[groupIdx] : undefined;
        matches.push({
          patternName: patternKey,
          value: m[0],
          start: m.index,
          end: m.index + m[0].length,
          groupValue: groupValue ?? undefined,
        });
        if (m[0].length === 0) {
          rx.lastIndex++;
        }
      }
    } catch {
      // invalid regex — skip
    }
  }

  return matches.sort((a, b) => a.start - b.start);
}

// ── Severity badge ─────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  critical: "border-red-500/40 text-red-600 bg-red-500/5",
  high: "border-orange-500/40 text-orange-600 bg-orange-500/5",
  medium: "border-amber-500/40 text-amber-600 bg-amber-500/5",
  low: "border-blue-500/40 text-blue-600 bg-blue-500/5",
  info: "border-slate-400/40 text-slate-500 bg-slate-400/5",
};

function SeverityBadge({ severity }: { severity: string }) {
  const colors = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.info;
  return (
    <span
      className={`inline-flex rounded-[3px] border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-[0.08em] ${colors}`}
    >
      {severity}
    </span>
  );
}

// ── Section label ──────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="mb-4">
      <h2 className="font-serif text-2xl font-black uppercase tracking-[0.06em]">
        {label}
      </h2>
    </div>
  );
}

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

// ── Single pattern form ───────────────────────────────────────────────────

function PatternForm({
  pattern,
  index,
  canRemove,
  onChange,
  onRemove,
  t,
}: {
  pattern: RegexPatternState;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<RegexPatternState>) => void;
  onRemove: () => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const severityOptions: { value: SeverityLevel | "__auto__"; label: string }[] = [
    { value: "__auto__", label: t("detectors.regex.severityAuto") },
    { value: "critical", label: t("detectors.regex.severityCritical") },
    { value: "high", label: t("detectors.regex.severityHigh") },
    { value: "medium", label: t("detectors.regex.severityMedium") },
    { value: "low", label: t("detectors.regex.severityLow") },
    { value: "info", label: t("detectors.regex.severityInfo") },
  ];

  return (
    <div className="rounded-[4px] border border-border bg-background p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex-1 mr-3">
          <Label className="text-xs uppercase tracking-wide">
            {t("detectors.regex.patternName")} <span className="text-destructive">*</span>
          </Label>
          <Input
            data-testid={`regex-pattern-name-${index}`}
            value={pattern.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder={t("detectors.regex.patternNamePlaceholder")}
            className="h-9 font-mono text-sm mt-1"
          />
        </div>
        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="h-7 w-7 p-0 text-destructive shrink-0 mt-5"
            title={t("detectors.regex.removePattern")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wide">
          {t("detectors.regex.patternLabel")} <span className="text-destructive">*</span>
        </Label>
        <Input
          data-testid={`regex-pattern-${index}`}
          value={pattern.pattern}
          onChange={(e) => onChange({ pattern: e.target.value })}
          placeholder={t("detectors.regex.patternPlaceholder")}
          className="h-9 font-mono text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wide">
          {t("detectors.regex.descriptionLabel")}
        </Label>
        <Input
          value={pattern.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder={t("detectors.regex.patternDescriptionPlaceholder")}
          className="h-9 text-sm"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wide">
            {t("detectors.regex.severity")}
          </Label>
          <Select
            value={pattern.severity || "__auto__"}
            onValueChange={(v) =>
              onChange({ severity: v === "__auto__" ? "" : (v as SeverityLevel) })
            }
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {severityOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wide">
            {t("detectors.regex.captureGroup")}
          </Label>
          <Input
            type="number"
            min={0}
            value={pattern.group}
            onChange={(e) => onChange({ group: Math.max(0, parseInt(e.target.value) || 0) })}
            className="h-9 text-sm"
          />
          <p className="text-[10px] text-muted-foreground">
            {t("detectors.regex.captureGroupHint")}
          </p>
        </div>

        <div className="space-y-3 pt-5">
          <div className="flex items-center gap-2">
            <Switch
              id={`cs-${index}`}
              checked={pattern.case_sensitive}
              onCheckedChange={(v) => onChange({ case_sensitive: v })}
            />
            <Label htmlFor={`cs-${index}`} className="text-xs">
              {t("detectors.regex.caseSensitive")}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id={`dot-${index}`}
              checked={pattern.dot_nl}
              onCheckedChange={(v) => onChange({ dot_nl: v })}
            />
            <Label htmlFor={`dot-${index}`} className="text-xs">
              {t("detectors.regex.dotMatchesNewline")}
            </Label>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Patterns section ───────────────────────────────────────────────────────

function PatternsSection({
  patterns,
  onChange,
  t,
}: {
  patterns: RegexPatternState[];
  onChange: (next: RegexPatternState[]) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const update = (index: number, patch: Partial<RegexPatternState>) => {
    const next = [...patterns];
    next[index] = { ...next[index]!, ...patch };
    onChange(next);
  };

  const remove = (index: number) => {
    onChange(patterns.filter((_, i) => i !== index));
  };

  const addPattern = () => {
    onChange([
      ...patterns,
      {
        name: "",
        pattern: "",
        description: "",
        severity: "",
        case_sensitive: true,
        dot_nl: false,
        group: 0,
      },
    ]);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("detectors.regex.patternsHint")}
      </p>

      {patterns.map((p, i) => (
        <PatternForm
          key={i}
          pattern={p}
          index={i}
          canRemove={patterns.length > 1}
          onChange={(patch) => update(i, patch)}
          onRemove={() => remove(i)}
          t={t}
        />
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addPattern}
        data-testid="regex-add-pattern-btn"
        className="h-9 whitespace-nowrap"
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        {t("detectors.regex.addPattern")}
      </Button>
    </div>
  );
}

// ── Test playground ────────────────────────────────────────────────────────

function TestPlayground({
  patterns,
  t,
}: {
  patterns: RegexPatternState[];
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const [sampleText, setSampleText] = useState("");
  const [matches, setMatches] = useState<TestMatch[]>([]);

  const hasRe2Features = useMemo(
    () => patterns.some((p) => p.dot_nl || p.group > 0),
    [patterns],
  );

  const handleTest = useCallback(() => {
    setMatches(runTestMatches(patterns, sampleText));
  }, [patterns, sampleText]);

  useEffect(() => {
    if (!sampleText.trim()) {
      setMatches([]);
      return;
    }
    const timer = setTimeout(() => {
      setMatches(runTestMatches(patterns, sampleText));
    }, 200);
    return () => clearTimeout(timer);
  }, [patterns, sampleText]);

  const validPatternCount = patterns.filter((p) => p.pattern.trim()).length;
  const matchesByPattern = useMemo(() => {
    const grouped: Record<string, TestMatch[]> = {};
    for (const m of matches) {
      (grouped[m.patternName] ??= []).push(m);
    }
    return grouped;
  }, [matches]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("detectors.regex.testHint")}
      </p>

      {hasRe2Features && (
        <div className="flex items-start gap-2 rounded-[4px] border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t("detectors.regex.re2Warning")}
          </p>
        </div>
      )}

      <div>
        <Label className="text-xs uppercase tracking-wide mb-1.5 block">
          {t("detectors.regex.sampleText")}
        </Label>
        <Textarea
          data-testid="regex-test-input"
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value)}
          placeholder={t("detectors.regex.sampleTextPlaceholder")}
          rows={6}
          className="font-mono text-sm resize-y"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleTest}
          disabled={validPatternCount === 0}
          className="h-8"
        >
          <Play className="mr-1 h-3.5 w-3.5" />
          {t("detectors.regex.runTest")}
        </Button>
        <span className="text-xs text-muted-foreground">
          {t("detectors.regex.matchCount", {
            count: matches.length,
            patterns: Object.keys(matchesByPattern).length,
          })}
        </span>
      </div>

      {matches.length > 0 && (
        <div className="space-y-3">
          {Object.entries(matchesByPattern).map(([patternName, patternMatches]) => {
            const patternDef = patterns.find(
              (p) => (p.name.trim().replace(/\s+/g, "_").toLowerCase() || "unnamed") === patternName,
            );
            return (
              <div
                key={patternName}
                className="rounded-[4px] border border-border bg-background p-3"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-mono text-xs font-bold">{patternName}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {patternMatches.length} {patternMatches.length !== 1 ? t("detectors.regex.matchesLabel") : t("detectors.regex.matchLabel")}
                  </Badge>
                  {patternDef?.severity && (
                    <SeverityBadge severity={patternDef.severity} />
                  )}
                </div>
                <div className="space-y-1">
                  {patternMatches.map((m, i) => (
                    <div
                      key={`${m.start}-${m.end}-${i}`}
                      className="flex items-baseline gap-2 text-xs"
                    >
                      <span className="shrink-0 text-muted-foreground font-mono">
                        [{m.start}:{m.end}]
                      </span>
                      <code className="rounded bg-accent/20 px-1.5 py-0.5 font-mono text-foreground break-all">
                        {m.groupValue !== undefined ? m.groupValue : m.value}
                      </code>
                      {m.groupValue !== undefined && (
                        <span className="text-muted-foreground">
                          ({t("detectors.regex.fullMatch", { value: m.value })})
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {sampleText.trim() && matches.length === 0 && validPatternCount > 0 && (
        <div className="rounded-[4px] border border-border bg-muted/30 p-4 text-center">
          <p className="text-sm text-muted-foreground">
            {t("detectors.regex.noMatches")}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main editor ────────────────────────────────────────────────────────────

const DEFAULT_PATTERN: RegexPatternState = {
  name: "",
  pattern: "",
  description: "",
  severity: "",
  case_sensitive: true,
  dot_nl: false,
  group: 0,
};

export const RegexDetectorEditor = React.forwardRef<
  RegexDetectorEditorHandle,
  RegexDetectorEditorProps
>(function RegexDetectorEditor({
  mode,
  submitLabel,
  isSubmitting = false,
  initialName = "",
  initialKey = "",
  initialDescription = "",
  initialIsActive = true,
  initialPipelineSchema,
  embedded,
  onSubmit,
}, ref) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [key, setKey] = useState(initialKey);
  const [description, setDescription] = useState(initialDescription);
  const [isActive, setIsActive] = useState(initialIsActive);
  const [patterns, setPatterns] = useState<RegexPatternState[]>(() => {
    const initial = parseInitialPatterns(initialPipelineSchema);
    return initial.length > 0 ? initial : [{ ...DEFAULT_PATTERN }];
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [activeStepId, setActiveStepId] = useState<RegexStepId>("identity");

  const steps = useMemo(
    () => [
      { id: "identity", title: t("detectors.regex.stepIdentity"), description: t("detectors.regex.stepIdentityDesc") },
      { id: "patterns", title: t("detectors.regex.stepPatterns"), description: t("detectors.regex.stepPatternsDesc") },
      { id: "test", title: t("detectors.regex.stepTest"), description: t("detectors.regex.stepTestDesc") },
    ],
    [t],
  );

  const identityRef = useRef<HTMLDivElement>(null);
  const patternsRef = useRef<HTMLDivElement>(null);
  const testRef = useRef<HTMLDivElement>(null);

  const sectionRefs: Record<RegexStepId, RefObject<HTMLDivElement | null>> = {
    identity: identityRef,
    patterns: patternsRef,
    test: testRef,
  };

  useEffect(() => {
    const stepIds: RegexStepId[] = ["identity", "patterns", "test"];
    const els = stepIds
      .map((id) => ({ id, el: sectionRefs[id].current }))
      .filter((x): x is { id: RegexStepId; el: HTMLDivElement } => x.el !== null);

    const map = new Map<Element, RegexStepId>(els.map(({ id, el }) => [el, id]));

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

  const scrollToSection = (id: RegexStepId) => {
    sectionRefs[id].current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const validate = (): string[] => {
    const errs: string[] = [];
    if (!name.trim()) errs.push(t("detectors.regex.validationNameRequired"));
    const validPatterns = patterns.filter((p) => p.name.trim());
    if (validPatterns.length === 0) errs.push(t("detectors.regex.validationPatternRequired"));
    for (const p of patterns) {
      const pName = p.name.trim();
      if (!pName) continue;
      if (!p.pattern.trim()) errs.push(t("detectors.regex.validationPatternEmpty", { name: pName }));
      try {
        new RegExp(p.pattern);
      } catch {
        errs.push(t("detectors.regex.validationPatternInvalid", { name: pName }));
      }
    }
    return errs;
  };

  const handleSubmit = async () => {
    const errs = validate();
    setErrors(errs);
    if (errs.length > 0) {
      if (errs.some((e) => e === t("detectors.regex.validationNameRequired"))) {
        scrollToSection("identity");
      } else {
        scrollToSection("patterns");
      }
      throw new Error("Validation failed");
    }

    await onSubmit({
      name: name.trim(),
      key: key.trim() || undefined,
      description: description.trim() || undefined,
      isActive,
      pipelineSchema: toApiSchema(patterns),
    });
  };

  React.useImperativeHandle(ref, () => ({
    submit: handleSubmit,
  }));

  const identityErrors = errors.filter((e) => e === t("detectors.regex.validationNameRequired"));
  const patternErrors = errors.filter((e) => e !== t("detectors.regex.validationNameRequired"));
  const patternCount = patterns.filter((p) => p.name.trim()).length;

  return (
    <div>
      {/* Mobile sticky horizontal nav */}
      <div className="sticky top-0 z-20 -mx-4 mb-6 border-b-2 border-border bg-background/95 px-4 py-2 backdrop-blur-sm md:hidden">
        <HorizontalCustomDetectorStepperNav
          activeStepId={activeStepId}
          onNavigate={(id) => scrollToSection(id as RegexStepId)}
          steps={steps}
        />
      </div>

      {/* Desktop: content + right sticky sidebar */}
      <div className="flex gap-8 lg:gap-12">
        {/* Scrollable content */}
        <div className="min-w-0 flex-1 space-y-16 pb-32">

          {/* ── Identity ── */}
          <section ref={identityRef}>
            <SectionLabel label={t("detectors.regex.stepIdentity")} />
            <AiAssistedCard
              title={t("detectors.regex.identityTitle")}
              description={t("detectors.regex.identityDescription")}
            >
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="regex-detector-name" className="text-xs uppercase tracking-wide">
                      {t("detectors.regex.name")} <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="regex-detector-name"
                      data-testid="regex-name"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        if (errors.length > 0) setErrors(validate());
                      }}
                      placeholder={t("detectors.regex.namePlaceholder")}
                      className={`h-9 ${identityErrors.length > 0 ? "border-destructive" : ""}`}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="regex-detector-key" className="text-xs uppercase tracking-wide">
                      {t("detectors.regex.keyLabel")}{" "}
                      <span className="text-muted-foreground text-[10px]">({t("detectors.regex.keyHint")})</span>
                    </Label>
                    <Input
                      id="regex-detector-key"
                      data-testid="regex-key"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      placeholder={t("detectors.regex.keyPlaceholder")}
                      className="h-9 font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="regex-detector-description" className="text-xs uppercase tracking-wide">
                    {t("detectors.regex.descriptionLabel")}
                  </Label>
                  <Textarea
                    id="regex-detector-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t("detectors.regex.descriptionPlaceholder")}
                    rows={2}
                    className="text-sm resize-none"
                  />
                </div>

                {mode === "edit" && (
                  <div className="flex items-center gap-2 pt-1">
                    <Switch
                      id="regex-detector-active"
                      checked={isActive}
                      onCheckedChange={setIsActive}
                    />
                    <Label htmlFor="regex-detector-active" className="text-sm">
                      {t("detectors.regex.activeLabel")}
                    </Label>
                  </div>
                )}
              </div>
            </AiAssistedCard>
            <ErrorBlock errors={identityErrors} />
          </section>

          {/* ── Patterns ── */}
          <section ref={patternsRef}>
            <SectionLabel label={t("detectors.regex.stepPatterns")} />
            <AiAssistedCard
              title={t("detectors.regex.patternsTitle")}
              description={
                patternCount > 0
                  ? t("detectors.regex.patternsCount", { count: patternCount })
                  : t("detectors.regex.noPatternsYet")
              }
            >
              <PatternsSection patterns={patterns} onChange={setPatterns} t={t} />
            </AiAssistedCard>
            <ErrorBlock errors={patternErrors} />
          </section>

          {/* ── Test ── */}
          <section ref={testRef}>
            <SectionLabel label={t("detectors.regex.stepTest")} />
            <AiAssistedCard
              title={t("detectors.regex.testTitle")}
              description={t("detectors.regex.testDescription")}
            >
              <TestPlayground patterns={patterns} t={t} />
            </AiAssistedCard>
          </section>
        </div>

        {/* Right sticky sidebar — desktop only */}
        <aside className="hidden self-start md:sticky md:top-6 md:block md:w-44 lg:w-52">
          <VerticalCustomDetectorStepperNav
            activeStepId={activeStepId}
            onNavigate={(id) => scrollToSection(id as RegexStepId)}
            steps={steps}
          />
        </aside>
      </div>

      {/* Sticky bottom action toolbar */}
      {!embedded && (
        <Card className="sticky bottom-0 z-30 mt-6 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {errors.length > 0 && (
                <p className="text-sm text-destructive">
                  {errors.length === 1 ? errors[0] : t("detectors.regex.errorsCount", { count: errors.length })}
                </p>
              )}
            </div>
            <Button
              type="button"
              data-testid="regex-submit-btn"
              onClick={() => void handleSubmit()}
              disabled={isSubmitting}
              className="h-10 rounded-[4px] border-2 border-border bg-accent text-accent-foreground shadow-[4px_4px_0_var(--color-border)] hover:-translate-y-[1px] hover:shadow-[6px_6px_0_var(--color-border)] transition-all font-mono font-bold uppercase tracking-[0.12em]"
            >
              {isSubmitting ? t("detectors.regex.saving") : submitLabel}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
});
