import { createHash } from 'node:crypto';

/**
 * Data quality rules as ODCS writes them (docs/prd/GOV-governed-data-assets.md
 * §5.4), and the arithmetic around them, free of the database.
 */
export const DIMENSIONS = [
  'accuracy',
  'completeness',
  'conformity',
  'consistency',
  'coverage',
  'timeliness',
  'uniqueness',
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const OPERATORS = [
  'mustBe',
  'mustNotBe',
  'mustBeGreaterThan',
  'mustBeGreaterOrEqualTo',
  'mustBeLessThan',
  'mustBeLessOrEqualTo',
  'mustBeBetween',
  'mustNotBeBetween',
] as const;
export type Operator = (typeof OPERATORS)[number];

/** What each rule type can measure, and the unit it is measured in. */
export const METRICS = {
  detector: { openFindings: 'findings' },
  metadata: { rowCount: 'rows', freshness: 'hours' },
  /** ODCS library metrics, measured over the whole table (G-4). */
  library: {
    nullValues: 'rows',
    missingValues: 'rows',
    invalidValues: 'rows',
    duplicateValues: 'rows',
    rowCount: 'rows',
  },
  /** ODCS sql: the one number a SELECT returns. */
  sql: { query: 'value' },
} as const;

/** Rules measured by a query over the whole table (a system query job). */
export const TABLE_RULE_TYPES: readonly string[] = ['library', 'sql'];

/** Library metrics about one column; the others are about the table. */
const COLUMN_METRICS = new Set([
  'nullValues',
  'missingValues',
  'invalidValues',
]);
export type RuleType = keyof typeof METRICS;
export const RULE_TYPES = Object.keys(METRICS) as RuleType[];

export const SEVERITIES = [
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
  'INFO',
] as const;
export type QualitySeverity = (typeof SEVERITIES)[number];

/** How much a failing rule of each severity weighs in the score. */
export const SEVERITY_WEIGHT: Record<QualitySeverity, number> = {
  CRITICAL: 8,
  HIGH: 4,
  MEDIUM: 2,
  LOW: 1,
  INFO: 0,
};

export type Threshold = number | [number, number];

export interface DetectorArguments {
  /** library: values counted as missing besides null (ODCS missingValues). */
  missingValues?: (string | number)[];
  /** library: the only values allowed (ODCS validValues). */
  validValues?: (string | number)[];
  /** library: a regular expression valid values match (ODCS pattern). */
  pattern?: string;
  /** library duplicateValues on the table: the columns that must be unique together. */
  properties?: string[];
  /** sql: one SELECT returning one number; `{object}` and `{property}` are substituted. */
  query?: string;
  detectorType?: string;
  customDetectorKey?: string;
  findingType?: string;
  category?: string;
}

export interface RuleInput {
  key?: unknown;
  name?: unknown;
  description?: unknown;
  columnName?: unknown;
  dimension?: unknown;
  type?: unknown;
  metric?: unknown;
  arguments?: unknown;
  operator?: unknown;
  threshold?: unknown;
  severity?: unknown;
  businessImpact?: unknown;
  enabled?: unknown;
  unit?: unknown;
  schedule?: unknown;
}

export interface ValidRule {
  key: string;
  name: string;
  description: string | null;
  columnName: string | null;
  dimension: Dimension;
  type: RuleType;
  metric: string;
  arguments: DetectorArguments;
  operator: Operator;
  threshold: Threshold;
  unit: string;
  severity: QualitySeverity;
  businessImpact: string | null;
  enabled: boolean;
  schedule: string | null;
}

export class RuleError extends Error {}

const KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function text(value: unknown, max: number, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new RuleError(`${field} is text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new RuleError(`${field} is at most ${max} characters.`);
  }
  return trimmed || null;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (
    typeof value !== 'string' ||
    !(allowed as readonly string[]).includes(value)
  ) {
    throw new RuleError(`${field} is one of ${allowed.join(', ')}.`);
  }
  return value as T;
}

/** `Null values in email` → `null-values-in-email`. */
export function keyFrom(name: string): string {
  const key = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return key || 'rule';
}

/**
 * Check and normalise a rule as a person or an ODCS import wrote it. Throws
 * {@link RuleError} with a sentence for the person; `current` fills fields a
 * partial update leaves out.
 */
export function validateRule(input: RuleInput, current?: ValidRule): ValidRule {
  const pick = <K extends keyof RuleInput>(key: K) =>
    key in input ? input[key] : current?.[key];

  const name = text(pick('name'), 200, 'name');
  if (!name) throw new RuleError('A rule needs a name.');
  const keyRaw = pick('key');
  const key =
    typeof keyRaw === 'string' && keyRaw.trim()
      ? keyRaw.trim()
      : (current?.key ?? keyFrom(name));
  if (!KEY_RE.test(key)) {
    throw new RuleError(
      'key is lower-case letters, digits, - and _, starting with a letter or digit.',
    );
  }
  const type = oneOf(pick('type'), RULE_TYPES, 'type');
  const metrics = METRICS[type] as Record<string, string>;
  const metric = oneOf(pick('metric'), Object.keys(metrics), 'metric');
  const dimension = oneOf(pick('dimension'), DIMENSIONS, 'dimension');
  const operator = oneOf(pick('operator'), OPERATORS, 'operator');
  const thresholdRaw = pick('threshold');
  let threshold: Threshold;
  if (operator === 'mustBeBetween' || operator === 'mustNotBeBetween') {
    if (
      !Array.isArray(thresholdRaw) ||
      thresholdRaw.length !== 2 ||
      !thresholdRaw.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
      (thresholdRaw[0] as number) > (thresholdRaw[1] as number)
    ) {
      throw new RuleError(
        `${operator} takes [low, high], two numbers with low ≤ high.`,
      );
    }
    threshold = [thresholdRaw[0] as number, thresholdRaw[1] as number];
  } else {
    if (typeof thresholdRaw !== 'number' || !Number.isFinite(thresholdRaw)) {
      throw new RuleError(`${operator} takes one number.`);
    }
    threshold = thresholdRaw;
  }
  const severity = oneOf(pick('severity') ?? 'MEDIUM', SEVERITIES, 'severity');
  const argsRaw = pick('arguments') ?? {};
  if (
    typeof argsRaw !== 'object' ||
    argsRaw === null ||
    Array.isArray(argsRaw)
  ) {
    throw new RuleError('arguments is an object.');
  }
  const args: DetectorArguments = {};
  if (type === 'detector') {
    for (const field of [
      'detectorType',
      'customDetectorKey',
      'findingType',
      'category',
    ] as const) {
      const value = text(
        (argsRaw as Record<string, unknown>)[field],
        200,
        `arguments.${field}`,
      );
      if (value) args[field] = value;
    }
  }
  const args_ = argsRaw as Record<string, unknown>;
  const values = (field: 'missingValues' | 'validValues') => {
    const raw = args_[field];
    if (raw === undefined || raw === null) return undefined;
    if (
      !Array.isArray(raw) ||
      raw.length > 200 ||
      !raw.every(
        (v) =>
          (typeof v === 'string' && v.length <= 200) ||
          (typeof v === 'number' && Number.isFinite(v)),
      )
    ) {
      throw new RuleError(
        `arguments.${field} is a list of at most 200 texts or numbers.`,
      );
    }
    return raw as (string | number)[];
  };
  if (type === 'library') {
    const missing = values('missingValues');
    const valid = values('validValues');
    const pattern = text(args_.pattern, 500, 'arguments.pattern');
    if (missing) args.missingValues = missing;
    if (valid) args.validValues = valid;
    if (pattern) args.pattern = pattern;
    const properties = args_.properties;
    if (properties !== undefined && properties !== null) {
      if (
        !Array.isArray(properties) ||
        !properties.length ||
        properties.length > 20 ||
        !properties.every((p) => typeof p === 'string' && p.trim())
      ) {
        throw new RuleError('arguments.properties is a list of column names.');
      }
      args.properties = (properties as string[]).map((p) => p.trim());
    }
    if (metric === 'invalidValues' && !valid?.length && !pattern) {
      throw new RuleError(
        'invalidValues needs arguments.validValues or arguments.pattern.',
      );
    }
  }
  if (type === 'sql') {
    const query = text(args_.query, 10_000, 'arguments.query');
    if (!query || !/^\s*(select|with)\b/i.test(query)) {
      throw new RuleError('A sql rule needs one SELECT in arguments.query.');
    }
    if (query.includes(';')) {
      throw new RuleError('arguments.query is one statement, without ";".');
    }
    args.query = query;
  }
  const columnName = text(pick('columnName'), 200, 'columnName');
  if (columnName && type === 'metadata') {
    throw new RuleError('Row count and freshness are about the whole table.');
  }
  if (type === 'library' && COLUMN_METRICS.has(metric) && !columnName) {
    throw new RuleError(`${metric} is measured on one column: name it.`);
  }
  if (type === 'library' && metric === 'rowCount' && columnName) {
    throw new RuleError('rowCount is about the whole table.');
  }
  if (
    type === 'library' &&
    metric === 'duplicateValues' &&
    !columnName &&
    !args.properties?.length
  ) {
    throw new RuleError(
      'duplicateValues needs a column, or arguments.properties for the table.',
    );
  }
  if (type === 'sql' && args.query?.includes('{property}') && !columnName) {
    throw new RuleError('The query uses {property}: name the column.');
  }
  // ODCS unit: rows (default) or percent of the table's rows, for counts.
  // An update that leaves the unit out keeps percent, else takes the metric's.
  const unitRaw =
    'unit' in input
      ? input.unit
      : current?.unit === 'percent'
        ? 'percent'
        : undefined;
  let unit: string = metrics[metric];
  if (unitRaw === 'percent') {
    if (type !== 'library' || metric === 'rowCount') {
      throw new RuleError('Only library counts can be in percent.');
    }
    unit = 'percent';
  } else if (
    unitRaw !== undefined &&
    unitRaw !== null &&
    unitRaw !== '' &&
    unitRaw !== metrics[metric]
  ) {
    throw new RuleError(`unit is ${metrics[metric]} or percent.`);
  }
  const schedule = validSchedule(pick('schedule'));
  const enabled = pick('enabled');
  return {
    key,
    name,
    description: text(pick('description'), 2_000, 'description'),
    columnName,
    dimension,
    type,
    metric,
    arguments: args,
    operator,
    threshold,
    unit,
    severity,
    businessImpact: text(pick('businessImpact'), 2_000, 'businessImpact'),
    enabled: typeof enabled === 'boolean' ? enabled : true,
    schedule,
  };
}

/** Named schedules the UI offers; any 5-field cron at most hourly is accepted. */
export const SCHEDULE_PRESETS: Record<string, string> = {
  hourly: '0 * * * *',
  daily: '0 6 * * *',
  weekly: '0 6 * * 1',
};

/**
 * A rule's schedule: null (after each scan and on request), a preset name,
 * or a 5-field cron in UTC whose minute is one fixed number — at most hourly,
 * since a whole-table query is not free.
 */
export function validSchedule(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new RuleError('schedule is text.');
  const cron = SCHEDULE_PRESETS[value] ?? value.trim();
  const fields = cron.split(/\s+/);
  if (fields.length !== 5) {
    throw new RuleError('schedule is hourly, daily, weekly or a 5-field cron.');
  }
  if (!/^\d{1,2}$/.test(fields[0]) || Number(fields[0]) > 59) {
    throw new RuleError(
      'A schedule runs at most hourly: its minute field is one number (0–59).',
    );
  }
  return cron;
}

/** Whether `value` meets the rule; between bounds are inclusive. */
export function meets(
  operator: Operator,
  value: number,
  threshold: Threshold,
): boolean {
  const n = typeof threshold === 'number' ? threshold : NaN;
  const [low, high] = Array.isArray(threshold) ? threshold : [NaN, NaN];
  switch (operator) {
    case 'mustBe':
      return value === n;
    case 'mustNotBe':
      return value !== n;
    case 'mustBeGreaterThan':
      return value > n;
    case 'mustBeGreaterOrEqualTo':
      return value >= n;
    case 'mustBeLessThan':
      return value < n;
    case 'mustBeLessOrEqualTo':
      return value <= n;
    case 'mustBeBetween':
      return value >= low && value <= high;
    case 'mustNotBeBetween':
      return value < low || value > high;
  }
}

const OPERATOR_TEXT: Record<Operator, string> = {
  mustBe: 'must be',
  mustNotBe: 'must not be',
  mustBeGreaterThan: 'must be more than',
  mustBeGreaterOrEqualTo: 'must be at least',
  mustBeLessThan: 'must be less than',
  mustBeLessOrEqualTo: 'must be at most',
  mustBeBetween: 'must be between',
  mustNotBeBetween: 'must not be between',
};

/** `email: 3 findings (must be 0)` — the finding's matched content. */
export function failureText(
  rule: Pick<
    ValidRule,
    'columnName' | 'operator' | 'threshold' | 'unit' | 'name'
  >,
  value: number,
): string {
  const bound = Array.isArray(rule.threshold)
    ? `${rule.threshold[0]} and ${rule.threshold[1]}`
    : String(rule.threshold);
  const where = rule.columnName ? `${rule.columnName}: ` : '';
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1);
  const unit =
    value === 1 && rule.unit.endsWith('s') ? rule.unit.slice(0, -1) : rule.unit;
  return `${where}${shown} ${unit} (${OPERATOR_TEXT[rule.operator]} ${bound}) — ${rule.name}`;
}

/** The detection identity of a rule's finding: one per rule, ever (R9). */
export function qualityIdentity(ruleId: string): string {
  return createHash('sha256').update(`quality:${ruleId}`).digest('hex');
}

/**
 * The share of rules passing on their latest result, weighted by severity
 * (CRITICAL 8 … LOW 1; INFO rules do not count). Null when no rule has a
 * result yet: no rules is not the same as a perfect score.
 */
export function qualityScore(
  rules: readonly { severity: string; passed: boolean | null }[],
): number | null {
  let total = 0;
  let passed = 0;
  for (const rule of rules) {
    if (rule.passed === null) continue;
    const weight = SEVERITY_WEIGHT[rule.severity as QualitySeverity] ?? 1;
    total += weight;
    if (rule.passed) passed += weight;
  }
  return total ? Math.round((passed / total) * 100) : null;
}
