import type { RuleInput, Threshold } from './quality-rules';
import { OPERATORS } from './quality-rules';

/**
 * An asset as an Open Data Contract Standard v3.2 contract, and back
 * (docs/prd/GOV-governed-data-assets.md §5.5, R10). Pure: the service gathers
 * the asset's governance and applies what an imported contract asks for.
 */
export const ODCS_VERSION = 'v3.2.0';
const TERM_URN = 'term://glossary/';
const CLASSIFYRE_ENGINE = 'classifyre';

export interface ContractMember {
  username: string;
  name?: string;
  role: 'owner' | 'steward' | 'custodian';
  dateIn?: string;
  dateOut?: string;
  replacedByUsername?: string;
}

export interface ContractRule {
  key: string;
  name: string;
  description: string | null;
  columnName: string | null;
  dimension: string;
  type: string;
  metric: string;
  arguments: Record<string, unknown>;
  operator: string;
  threshold: Threshold;
  unit: string;
  severity: string;
  businessImpact: string | null;
  schedule: string | null;
}

export interface ContractInput {
  id: string;
  version: string;
  name: string;
  domain: string | null;
  status: string | null;
  description: string | null;
  usage: string | null;
  limitations: string | null;
  legalBasis: string | null;
  retention: string | null;
  terms: string[];
  members: ContractMember[];
  table: string;
  physicalName: string;
  columns: {
    name: string;
    type: string;
    businessName: string | null;
    description: string | null;
    classification: string | null;
    criticalDataElement: boolean;
    termKey: string | null;
  }[];
  rules: ContractRule[];
  qualityScore: number | null;
  url: string | null;
}

/** DuckDB and source types → ODCS logicalType. */
export function logicalType(type: string): string {
  const t = type.toLowerCase();
  if (
    /^(tinyint|smallint|int|integer|bigint|long|hugeint|short|byte|int\d+|uint\d+)/.test(
      t,
    )
  )
    return 'integer';
  if (/^(double|float|real|decimal|numeric|number)/.test(t)) return 'number';
  if (/^bool/.test(t)) return 'boolean';
  if (/^timestamp/.test(t) || t === 'datetime') return 'timestamp';
  if (t === 'date') return 'date';
  if (t === 'time') return 'time';
  if (/^(struct|map|object|record|json)/.test(t)) return 'object';
  if (/^(list|array)/.test(t) || t.endsWith('[]')) return 'array';
  return 'string';
}

function quality(rule: ContractRule): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: rule.key,
    name: rule.name,
    ...(rule.description ? { description: rule.description } : {}),
    dimension: rule.dimension,
    severity: rule.severity.toLowerCase(),
    ...(rule.businessImpact ? { businessImpact: rule.businessImpact } : {}),
    [rule.operator]: rule.threshold,
    ...(rule.schedule ? { schedule: rule.schedule, scheduler: 'cron' } : {}),
  };
  if (rule.type === 'library') {
    const { query: _query, ...args } = rule.arguments;
    void _query;
    return {
      ...base,
      type: 'library',
      metric: rule.metric,
      unit: rule.unit,
      ...(Object.keys(args).length ? { arguments: args } : {}),
    };
  }
  if (rule.type === 'sql') {
    return { ...base, type: 'sql', query: rule.arguments.query };
  }
  // Detector and metadata rules are Classifyre's own: ODCS `custom`.
  return {
    ...base,
    type: 'custom',
    engine: CLASSIFYRE_ENGINE,
    unit: rule.unit,
    implementation: JSON.stringify({
      type: rule.type,
      metric: rule.metric,
      arguments: rule.arguments,
    }),
  };
}

const dropEmpty = (value: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(value).filter(
      ([, v]) =>
        v !== null &&
        v !== undefined &&
        !(Array.isArray(v) && v.length === 0) &&
        !(
          typeof v === 'object' &&
          !Array.isArray(v) &&
          Object.keys(v).length === 0
        ),
    ),
  );

/** The contract object, ready for YAML or JSON. */
export function toContract(input: ContractInput): Record<string, unknown> {
  const objectRules = input.rules.filter((r) => !r.columnName);
  const sla = [
    ...input.rules
      .filter(
        (r) => r.metric === 'freshness' && typeof r.threshold === 'number',
      )
      .map((r) => ({
        property: 'latency',
        value: r.threshold,
        unit: 'h',
        driver: 'operational',
        description: `${r.name} (hours since the last scan)`,
      })),
    ...(input.retention
      ? [
          {
            property: 'retention',
            value: input.retention,
            driver: 'regulatory',
          },
        ]
      : []),
  ];
  return dropEmpty({
    apiVersion: ODCS_VERSION,
    kind: 'DataContract',
    id: input.id,
    version: input.version,
    name: input.name,
    domain: input.domain,
    status: input.status ?? 'proposed',
    description: dropEmpty({
      purpose: input.description,
      usage: input.usage,
      limitations: input.limitations,
    }),
    authoritativeDefinitions: input.terms.map((key) => ({
      type: 'businessDefinition',
      url: `${TERM_URN}${key}`,
    })),
    team: input.members.length
      ? {
          name: `${input.name} team`,
          members: input.members.map((m) => dropEmpty({ ...m })),
        }
      : null,
    schema: [
      dropEmpty({
        name: input.table,
        physicalName: input.physicalName,
        physicalType: 'table',
        logicalType: 'object',
        quality: objectRules.map(quality),
        properties: input.columns.map((column) =>
          dropEmpty({
            name: column.name,
            physicalType: column.type || null,
            logicalType: logicalType(column.type || 'string'),
            businessName: column.businessName,
            description: column.description,
            classification: column.classification,
            criticalDataElement: column.criticalDataElement || null,
            authoritativeDefinitions: column.termKey
              ? [
                  {
                    type: 'businessDefinition',
                    url: `${TERM_URN}${column.termKey}`,
                  },
                ]
              : [],
            quality: input.rules
              .filter((r) => r.columnName === column.name)
              .map(quality),
          }),
        ),
      }),
    ],
    slaProperties: sla,
    customProperties: [
      ...(input.legalBasis
        ? [{ property: 'legalBasis', value: input.legalBasis }]
        : []),
      ...(input.qualityScore !== null
        ? [{ property: 'qualityScore', value: input.qualityScore }]
        : []),
      ...(input.url ? [{ property: 'classifyreAsset', value: input.url }] : []),
    ],
  });
}

// ── Import ────────────────────────────────────────────────────────────────────

export interface ContractPlan {
  status: string | null;
  description: string | null | undefined;
  usage: string | null | undefined;
  limitations: string | null | undefined;
  retention: string | null | undefined;
  legalBasis: string | null | undefined;
  members: { username: string; role: 'OWNER' | 'STEWARD' | 'CUSTODIAN' }[];
  columns: {
    name: string;
    businessName?: string | null;
    description?: string | null;
    classification?: string | null;
    criticalDataElement?: boolean;
    termKey?: string | null;
  }[];
  rules: (RuleInput & { key: string })[];
  skipped: { path: string; reason: string }[];
}

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const ROLE: Record<string, 'OWNER' | 'STEWARD' | 'CUSTODIAN'> = {
  owner: 'OWNER',
  'data owner': 'OWNER',
  steward: 'STEWARD',
  'data steward': 'STEWARD',
  custodian: 'CUSTODIAN',
  'data custodian': 'CUSTODIAN',
};

function termKey(definitions: unknown): string | null {
  if (!Array.isArray(definitions)) return null;
  for (const d of definitions) {
    const url = (d as { url?: unknown })?.url;
    if (typeof url === 'string' && url.startsWith(TERM_URN)) {
      return url.slice(TERM_URN.length);
    }
  }
  return null;
}

function rule(
  raw: Record<string, unknown>,
  column: string | null,
  path: string,
  skipped: ContractPlan['skipped'],
): (RuleInput & { key: string }) | null {
  const key = asText(raw.id) ?? asText(raw.name);
  if (!key) {
    skipped.push({ path, reason: 'A quality rule needs an id or a name.' });
    return null;
  }
  const operator = OPERATORS.find((op) => op in raw);
  if (!operator) {
    skipped.push({ path, reason: `${key}: no mustBe… comparison.` });
    return null;
  }
  const type = asText(raw.type) ?? (raw.metric ? 'library' : null);
  const common = {
    key: key
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64),
    name: asText(raw.name) ?? key,
    description: asText(raw.description),
    columnName: column,
    dimension: (asText(raw.dimension) ?? 'accuracy').toLowerCase(),
    operator,
    threshold: raw[operator],
    severity: (asText(raw.severity) ?? 'medium').toUpperCase(),
    businessImpact: asText(raw.businessImpact),
    schedule: asText(raw.schedule),
  };
  if (type === 'library') {
    return {
      ...common,
      type: 'library',
      metric: raw.metric,
      unit: raw.unit,
      arguments: raw.arguments ?? {},
    };
  }
  if (type === 'sql') {
    return {
      ...common,
      type: 'sql',
      metric: 'query',
      arguments: { query: raw.query },
    };
  }
  if (type === 'custom' && asText(raw.engine) === CLASSIFYRE_ENGINE) {
    try {
      const implementation =
        typeof raw.implementation === 'string'
          ? raw.implementation
          : JSON.stringify(raw.implementation ?? {});
      const impl = JSON.parse(implementation) as {
        type?: string;
        metric?: string;
        arguments?: Record<string, unknown>;
      };
      return {
        ...common,
        type: impl.type,
        metric: impl.metric,
        arguments: impl.arguments ?? {},
      };
    } catch {
      skipped.push({ path, reason: `${key}: its implementation is not JSON.` });
      return null;
    }
  }
  skipped.push({
    path,
    reason: `${key}: ${type === 'custom' ? `engine ${String(raw.engine)}` : `type ${String(type)}`} is not evaluated here.`,
  });
  return null;
}

/** What an imported contract asks to change; nothing is applied here. */
export function fromContract(doc: unknown): ContractPlan {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('A contract is a YAML or JSON object.');
  }
  const c = doc as Record<string, unknown>;
  if (c.kind !== 'DataContract') {
    throw new Error('kind must be DataContract (an ODCS contract).');
  }
  const skipped: ContractPlan['skipped'] = [];
  const description = (c.description ?? {}) as Record<string, unknown>;
  const team = c.team as { members?: unknown } | unknown[] | undefined;
  const memberList = Array.isArray(team)
    ? team
    : Array.isArray((team as { members?: unknown })?.members)
      ? (team as { members: unknown[] }).members
      : [];
  const members: ContractPlan['members'] = [];
  memberList.forEach((m, i) => {
    const member = m as Record<string, unknown>;
    if (member.dateOut) return; // history, not a current role
    const username = asText(member.username);
    const role = ROLE[(asText(member.role) ?? '').toLowerCase()];
    if (!username || !role) {
      skipped.push({
        path: `team.members[${i}]`,
        reason: 'Needs a username and the role owner, steward or custodian.',
      });
      return;
    }
    members.push({ username, role });
  });

  const schema = Array.isArray(c.schema) ? c.schema : [];
  if (schema.length > 1) {
    skipped.push({
      path: 'schema',
      reason:
        'Only the first object applies: this contract describes one table.',
    });
  }
  const object = (schema[0] ?? {}) as Record<string, unknown>;
  const rules: ContractPlan['rules'] = [];
  (Array.isArray(object.quality) ? object.quality : []).forEach((q, i) => {
    const r = rule(
      q as Record<string, unknown>,
      null,
      `schema[0].quality[${i}]`,
      skipped,
    );
    if (r) rules.push(r);
  });
  const columns: ContractPlan['columns'] = [];
  (Array.isArray(object.properties) ? object.properties : []).forEach(
    (p, i) => {
      const prop = p as Record<string, unknown>;
      const name = asText(prop.name);
      if (!name) {
        skipped.push({
          path: `schema[0].properties[${i}]`,
          reason: 'A property needs a name.',
        });
        return;
      }
      columns.push({
        name,
        ...('businessName' in prop
          ? { businessName: asText(prop.businessName) }
          : {}),
        ...('description' in prop
          ? { description: asText(prop.description) }
          : {}),
        ...('classification' in prop
          ? {
              classification:
                asText(prop.classification)?.toLowerCase() ?? null,
            }
          : {}),
        ...('criticalDataElement' in prop
          ? { criticalDataElement: prop.criticalDataElement === true }
          : {}),
        ...('authoritativeDefinitions' in prop
          ? { termKey: termKey(prop.authoritativeDefinitions) }
          : {}),
      });
      (Array.isArray(prop.quality) ? prop.quality : []).forEach((q, j) => {
        const r = rule(
          q as Record<string, unknown>,
          name,
          `schema[0].properties[${i}].quality[${j}]`,
          skipped,
        );
        if (r) rules.push(r);
      });
    },
  );

  const custom = Array.isArray(c.customProperties) ? c.customProperties : [];
  const legal = custom.find(
    (p) => (p as { property?: unknown })?.property === 'legalBasis',
  ) as { value?: unknown } | undefined;
  const sla = Array.isArray(c.slaProperties) ? c.slaProperties : [];
  const retention = sla.find(
    (p) => (p as { property?: unknown })?.property === 'retention',
  ) as { value?: unknown; unit?: unknown } | undefined;

  return {
    status: asText(c.status)?.toLowerCase() ?? null,
    description:
      'purpose' in description ? asText(description.purpose) : undefined,
    usage: 'usage' in description ? asText(description.usage) : undefined,
    limitations:
      'limitations' in description
        ? asText(description.limitations)
        : undefined,
    retention: retention
      ? [retention.value, retention.unit].filter(Boolean).join(' ') || null
      : undefined,
    legalBasis: legal ? asText(legal.value) : undefined,
    members,
    columns,
    rules,
    skipped,
  };
}
