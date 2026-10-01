/**
 * Glossary file formats (SL1 R12): CSV and SKOS JSON-LD, both directions.
 *
 * Pure functions over plain objects, so round trips can be tested without a
 * database. The service turns a parsed file into a plan (creates, updates,
 * skips, conflicts) and applies it.
 */

export const CSV_COLUMNS = [
  'key',
  'term',
  'kind',
  'scheme',
  'status',
  'entity_type',
  'definition',
  'aliases',
  'codes',
  'hidden_aliases',
  'broader',
  'related',
  'instance_of',
  'steward',
  'notes',
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

/** One term as files carry it, keyed by term key for relations. */
export interface ImportTerm {
  /** 1-based row (CSV) or node index (SKOS), for the report. */
  row: number;
  key?: string;
  term: string;
  kind: 'CONCEPT' | 'ENTITY';
  schemeKey?: string;
  status?: 'DRAFT' | 'APPROVED' | 'DEPRECATED';
  entityType?: string;
  definition?: string;
  aliases: string[];
  codes: string[];
  hiddenAliases: string[];
  broader: string[];
  related: string[];
  instanceOf: string[];
  /** Custom verbs, SKOS `classifyre:relation` only. */
  custom: Array<{ to: string; label: string }>;
  steward?: string;
  notes?: string;
  sourceIri?: string;
}

export interface ImportScheme {
  key: string;
  name: string;
  description?: string;
  sourceIri?: string;
}

export interface ParsedGlossaryFile {
  schemes: ImportScheme[];
  terms: ImportTerm[];
  /** Rows refused while parsing, with the reason. */
  refused: Array<{ row: number; reason: string }>;
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** RFC 4180 parser: quoted fields, doubled quotes, CRLF or LF, BOM tolerated. */
export function parseCsvRows(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function splitMulti(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Parse a glossary CSV. Unknown columns are refused, naming the column. */
export function parseGlossaryCsv(text: string): ParsedGlossaryFile {
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    throw new Error('The CSV file is empty');
  }
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const unknown = header.filter(
    (column) => !(CSV_COLUMNS as readonly string[]).includes(column),
  );
  if (unknown.length) {
    throw new Error(
      `Unknown column(s): ${unknown.join(', ')}. Allowed: ${CSV_COLUMNS.join(', ')}`,
    );
  }
  if (!header.includes('term')) {
    throw new Error('The CSV needs a "term" column');
  }
  const index = new Map(header.map((column, i) => [column, i]));
  const cell = (cells: string[], column: CsvColumn): string | undefined => {
    const i = index.get(column);
    if (i === undefined) return undefined;
    const value = cells[i]?.trim();
    return value ? value : undefined;
  };
  const terms: ImportTerm[] = [];
  const refused: ParsedGlossaryFile['refused'] = [];
  const schemes = new Map<string, ImportScheme>();
  rows.slice(1).forEach((cells, offset) => {
    const row = offset + 2;
    const term = cell(cells, 'term');
    if (!term) {
      refused.push({ row, reason: 'Empty term' });
      return;
    }
    const kindRaw = (cell(cells, 'kind') ?? 'CONCEPT').toUpperCase();
    if (kindRaw !== 'CONCEPT' && kindRaw !== 'ENTITY') {
      refused.push({ row, reason: `Unknown kind "${kindRaw}"` });
      return;
    }
    const statusRaw = cell(cells, 'status')?.toUpperCase();
    if (
      statusRaw &&
      !['DRAFT', 'APPROVED', 'DEPRECATED'].includes(statusRaw)
    ) {
      refused.push({ row, reason: `Unknown status "${statusRaw}"` });
      return;
    }
    const scheme = cell(cells, 'scheme');
    let schemeKey: string | undefined;
    if (scheme) {
      schemeKey = scheme.toLowerCase();
      if (!schemes.has(schemeKey)) {
        schemes.set(schemeKey, { key: schemeKey, name: scheme });
      }
    }
    terms.push({
      row,
      key: cell(cells, 'key')?.toLowerCase(),
      term,
      kind: kindRaw,
      schemeKey,
      status: statusRaw as ImportTerm['status'],
      entityType: cell(cells, 'entity_type')?.toUpperCase(),
      definition: cell(cells, 'definition'),
      aliases: splitMulti(cell(cells, 'aliases')),
      codes: splitMulti(cell(cells, 'codes')),
      hiddenAliases: splitMulti(cell(cells, 'hidden_aliases')),
      broader: splitMulti(cell(cells, 'broader')).map((k) => k.toLowerCase()),
      related: splitMulti(cell(cells, 'related')).map((k) => k.toLowerCase()),
      instanceOf: splitMulti(cell(cells, 'instance_of')).map((k) =>
        k.toLowerCase(),
      ),
      custom: [],
      steward: cell(cells, 'steward'),
      notes: cell(cells, 'notes'),
    });
  });
  return { schemes: [...schemes.values()], terms, refused };
}

export interface ExportTerm {
  key: string;
  term: string;
  kind: 'CONCEPT' | 'ENTITY';
  schemeKey: string | null;
  schemeName: string | null;
  status: string;
  entityType: string;
  definition: string | null;
  aliases: string[];
  codes: string[];
  hiddenAliases: string[];
  broader: string[];
  related: string[];
  instanceOf: string[];
  custom: Array<{ to: string; label: string }>;
  steward: string | null;
  notes: string | null;
  sourceIri: string | null;
}

export interface ExportScheme {
  key: string;
  name: string;
  description: string | null;
}

export function toGlossaryCsv(terms: ExportTerm[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const term of terms) {
    const values: Record<CsvColumn, string> = {
      key: term.key,
      term: term.term,
      kind: term.kind,
      scheme: term.schemeKey ?? '',
      status: term.status,
      entity_type: term.entityType,
      definition: term.definition ?? '',
      aliases: term.aliases.join('|'),
      codes: term.codes.join('|'),
      hidden_aliases: term.hiddenAliases.join('|'),
      broader: term.broader.join('|'),
      related: term.related.join('|'),
      instance_of: term.instanceOf.join('|'),
      steward: term.steward ?? '',
      notes: term.notes ?? '',
    };
    lines.push(CSV_COLUMNS.map((column) => csvEscape(values[column])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

// ── SKOS JSON-LD ─────────────────────────────────────────────────────────────

const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const CLASSIFYRE = 'https://classifyre.io/ns/glossary#';

type JsonLdValue =
  | string
  | number
  | boolean
  | null
  | { '@value'?: unknown; '@language'?: string; '@id'?: string }
  | JsonLdValue[]
  | Record<string, unknown>;

type JsonLdNode = Record<string, unknown>;

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Property lookup tolerant of `skos:x`, `x` and the full IRI. */
function prop(node: JsonLdNode, name: string, ns = SKOS): unknown[] {
  const prefix = ns === SKOS ? 'skos' : 'classifyre';
  return [
    ...asArray(node[`${prefix}:${name}`]),
    ...asArray(node[name]),
    ...asArray(node[`${ns}${name}`]),
  ];
}

function literal(value: unknown): { text: string; lang?: string } | null {
  if (typeof value === 'string') return { text: value };
  if (typeof value === 'number') return { text: String(value) };
  if (value && typeof value === 'object' && '@value' in value) {
    const v = value as { '@value'?: unknown; '@language'?: string };
    if (v['@value'] === undefined || v['@value'] === null) return null;
    return { text: String(v['@value']), lang: v['@language'] };
  }
  return null;
}

function idOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && '@id' in value) {
    const id = (value as { '@id'?: unknown })['@id'];
    return typeof id === 'string' ? id : null;
  }
  return null;
}

function types(node: JsonLdNode): string[] {
  return [...asArray(node['@type']), ...asArray(node.type)]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.replace(SKOS, 'skos:').replace(/^Concept/, 'skos:Concept'));
}

/** The slugified local part of an IRI (the segment after `#` or the last `/`). */
export function localPartKey(iri: string): string {
  const local = iri.split('#').pop()?.split('/').filter(Boolean).pop() ?? iri;
  return local
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+$/, '')
    .slice(0, 100);
}

/**
 * Parse SKOS JSON-LD. `prefLabel` in `language` becomes the term; prefLabels
 * in other languages and every `altLabel` become aliases; `hiddenLabel`
 * becomes hidden aliases; `notation` becomes codes. `broader`, `narrower`
 * (inverted) and `related` become relations; `inScheme` the scheme.
 */
export function parseSkosJsonLd(
  text: string,
  language = 'en',
): ParsedGlossaryFile {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const nodes: JsonLdNode[] = [];
  const collect = (value: unknown) => {
    for (const item of asArray(value)) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const node = item as JsonLdNode;
        if (node['@graph']) collect(node['@graph']);
        if (node['@id'] || node['@type']) nodes.push(node);
      }
    }
  };
  collect(doc);

  const schemeNodes = nodes.filter((node) =>
    types(node).some((type) => type === 'skos:ConceptScheme'),
  );
  const conceptNodes = nodes.filter((node) =>
    types(node).some((type) => type === 'skos:Concept'),
  );

  const pickLabel = (values: unknown[]): string | undefined => {
    const labels = values
      .map(literal)
      .filter((label): label is { text: string; lang?: string } =>
        Boolean(label),
      );
    return (
      labels.find((label) => label.lang === language)?.text ??
      labels.find((label) => !label.lang)?.text ??
      labels[0]?.text
    );
  };

  const schemes: ImportScheme[] = schemeNodes.map((node) => {
    const iri = String(node['@id'] ?? '');
    const name =
      pickLabel([...prop(node, 'prefLabel'), ...prop(node, 'title', 'http://purl.org/dc/terms/')]) ??
      localPartKey(iri);
    return {
      key: localPartKey(iri) || 'scheme',
      name,
      description: pickLabel(prop(node, 'definition')),
      sourceIri: iri || undefined,
    };
  });
  const schemeKeyByIri = new Map(
    schemes.map((scheme) => [scheme.sourceIri ?? '', scheme.key]),
  );

  const iriToKey = new Map<string, string>();
  for (const node of conceptNodes) {
    const iri = String(node['@id'] ?? '');
    const explicit = literal(prop(node, 'key', CLASSIFYRE)[0])?.text;
    iriToKey.set(iri, explicit ?? localPartKey(iri));
  }

  const refused: ParsedGlossaryFile['refused'] = [];
  const terms: ImportTerm[] = [];
  const narrowerOf = new Map<string, string[]>();
  conceptNodes.forEach((node, index) => {
    const iri = String(node['@id'] ?? '');
    const prefLabels = prop(node, 'prefLabel')
      .map(literal)
      .filter((label): label is { text: string; lang?: string } =>
        Boolean(label),
      );
    const term = pickLabel(prop(node, 'prefLabel'));
    if (!term) {
      refused.push({ row: index + 1, reason: `${iri || 'A concept'} has no prefLabel` });
      return;
    }
    const otherPrefLabels = prefLabels
      .filter((label) => label.text !== term)
      .map((label) => label.text);
    const kindText = literal(prop(node, 'kind', CLASSIFYRE)[0])?.text;
    const keyOf = (value: unknown) => {
      const id = idOf(value);
      return id ? (iriToKey.get(id) ?? localPartKey(id)) : null;
    };
    for (const narrower of prop(node, 'narrower')) {
      const key = keyOf(narrower);
      if (key) {
        narrowerOf.set(key, [...(narrowerOf.get(key) ?? []), iriToKey.get(iri)!]);
      }
    }
    const custom = prop(node, 'relation', CLASSIFYRE)
      .map((value) => {
        if (!value || typeof value !== 'object') return null;
        const record = value as Record<string, unknown>;
        const to = keyOf(record['classifyre:to'] ?? record.to ?? record['@id']);
        const label = literal(record['classifyre:label'] ?? record.label)?.text;
        return to && label ? { to, label } : null;
      })
      .filter((value): value is { to: string; label: string } => Boolean(value));
    const inScheme = idOf(prop(node, 'inScheme')[0]);
    terms.push({
      row: index + 1,
      key: iriToKey.get(iri) || undefined,
      term,
      kind: kindText === 'ENTITY' ? 'ENTITY' : 'CONCEPT',
      schemeKey: inScheme ? (schemeKeyByIri.get(inScheme) ?? localPartKey(inScheme)) : undefined,
      definition: pickLabel(prop(node, 'definition')),
      aliases: [
        ...otherPrefLabels,
        ...prop(node, 'altLabel')
          .map(literal)
          .filter((label): label is { text: string } => Boolean(label))
          .map((label) => label.text),
      ],
      codes: prop(node, 'notation')
        .map(literal)
        .filter((label): label is { text: string } => Boolean(label))
        .map((label) => label.text),
      hiddenAliases: prop(node, 'hiddenLabel')
        .map(literal)
        .filter((label): label is { text: string } => Boolean(label))
        .map((label) => label.text),
      broader: prop(node, 'broader')
        .map(keyOf)
        .filter((key): key is string => Boolean(key)),
      related: prop(node, 'related')
        .map(keyOf)
        .filter((key): key is string => Boolean(key)),
      instanceOf: prop(node, 'instanceOf', CLASSIFYRE)
        .map(keyOf)
        .filter((key): key is string => Boolean(key)),
      custom,
      notes: pickLabel(prop(node, 'scopeNote')),
      sourceIri: iri || undefined,
    });
  });
  // `narrower` is the inverse of `broader`.
  for (const term of terms) {
    const extra = term.key ? (narrowerOf.get(term.key) ?? []) : [];
    for (const parent of extra) {
      if (!term.broader.includes(parent)) term.broader.push(parent);
    }
  }
  // Schemes referenced by concepts but not declared still get created.
  for (const term of terms) {
    if (term.schemeKey && !schemes.some((s) => s.key === term.schemeKey)) {
      schemes.push({ key: term.schemeKey, name: term.schemeKey });
    }
  }
  return { schemes, terms, refused };
}

/**
 * SKOS JSON-LD export: one `skos:ConceptScheme` per scheme; concepts carry
 * labels, notation, definition, broader, related and inScheme. Custom
 * relations go out as `classifyre:relation`.
 */
export function toSkosJsonLd(input: {
  baseIri: string;
  schemes: ExportScheme[];
  terms: ExportTerm[];
  language?: string;
}): Record<string, unknown> {
  const base = input.baseIri.replace(/\/+$/, '');
  const termIri = (key: string) => `${base}/glossary/terms/${key}`;
  const schemeIri = (key: string) => `${base}/glossary/schemes/${key}`;
  const lang = input.language ?? 'en';
  const label = (text: string) => ({ '@value': text, '@language': lang });
  const graph: Record<string, unknown>[] = [];
  for (const scheme of input.schemes) {
    graph.push({
      '@id': schemeIri(scheme.key),
      '@type': 'skos:ConceptScheme',
      'skos:prefLabel': label(scheme.name),
      ...(scheme.description
        ? { 'skos:definition': label(scheme.description) }
        : {}),
      'classifyre:key': scheme.key,
    });
  }
  for (const term of input.terms) {
    const node: Record<string, unknown> = {
      '@id': termIri(term.key),
      '@type': 'skos:Concept',
      'classifyre:key': term.key,
      'skos:prefLabel': label(term.term),
    };
    if (term.kind === 'ENTITY') node['classifyre:kind'] = 'ENTITY';
    if (term.aliases.length) node['skos:altLabel'] = term.aliases.map(label);
    if (term.hiddenAliases.length) {
      node['skos:hiddenLabel'] = term.hiddenAliases.map(label);
    }
    if (term.codes.length) node['skos:notation'] = term.codes;
    if (term.definition) node['skos:definition'] = label(term.definition);
    if (term.notes) node['skos:scopeNote'] = label(term.notes);
    if (term.schemeKey) node['skos:inScheme'] = { '@id': schemeIri(term.schemeKey) };
    if (term.broader.length) {
      node['skos:broader'] = term.broader.map((key) => ({ '@id': termIri(key) }));
    }
    if (term.related.length) {
      node['skos:related'] = term.related.map((key) => ({ '@id': termIri(key) }));
    }
    if (term.instanceOf.length) {
      node['classifyre:instanceOf'] = term.instanceOf.map((key) => ({
        '@id': termIri(key),
      }));
    }
    if (term.custom.length) {
      node['classifyre:relation'] = term.custom.map((relation) => ({
        'classifyre:to': { '@id': termIri(relation.to) },
        'classifyre:label': relation.label,
      }));
    }
    if (term.status !== 'APPROVED') node['classifyre:status'] = term.status;
    graph.push(node);
  }
  return {
    '@context': {
      skos: SKOS,
      classifyre: CLASSIFYRE,
    },
    '@graph': graph,
  };
}

export type { JsonLdValue };
