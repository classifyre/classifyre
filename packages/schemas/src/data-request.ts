import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Data Request spec, deterministic SQL generator, and case-card sketch builder
// (docs/prd/DR-data-requests.md §4.2)
//
// Self-contained single file with no extension-less relative imports: the API
// loads this file directly under Node type-stripping at runtime.
// ─────────────────────────────────────────────────────────────────────────────

export const DATA_REQUEST_MAX_TABLES = 12;
export const DATA_REQUEST_MAX_SOURCES = 8;
export const DATA_REQUEST_MAX_JOINS = 48;
export const DATA_REQUEST_MAX_FILTERS_PER_TABLE = 32;
export const DATA_REQUEST_MAX_PINS = 64;
export const DATA_REQUEST_MAX_GROUPS = 24;

export const SCHEMA_TABLE_COLORS = [
  "gray",
  "green",
  "amber",
  "blue",
  "violet",
  "pink",
  "yellow",
  "red",
] as const;
export type SchemaTableColor = (typeof SCHEMA_TABLE_COLORS)[number];

export const DATA_REQUEST_JOIN_TYPES = ["INNER", "LEFT", "RIGHT", "FULL"] as const;
export type DataRequestJoinType = (typeof DATA_REQUEST_JOIN_TYPES)[number];

export const DATA_REQUEST_CARDINALITIES = ["1-1", "1-N", "N-1", "N-N"] as const;
export type DataRequestCardinality = (typeof DATA_REQUEST_CARDINALITIES)[number];

export const DATA_REQUEST_JOIN_ORIGINS = ["manual", "fk", "inferred"] as const;
export type DataRequestJoinOrigin = (typeof DATA_REQUEST_JOIN_ORIGINS)[number];

export const DATA_REQUEST_FILTER_OPS = [
  "=",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "LIKE",
  "ILIKE",
  "IN",
  "NOT IN",
  "IS NULL",
  "IS NOT NULL",
] as const;
export type DataRequestFilterOp = (typeof DATA_REQUEST_FILTER_OPS)[number];

const ScalarFilterValueSchema = z.union([z.string().max(1000), z.number().finite(), z.boolean()]);

export const DataRequestFilterSchema = z.strictObject({
  id: z.string().min(1).max(64).optional(),
  column: z.string().min(1).max(255),
  op: z.enum(DATA_REQUEST_FILTER_OPS),
  value: ScalarFilterValueSchema.nullable().optional(),
  values: z.array(ScalarFilterValueSchema).max(100).optional(),
});
export type DataRequestFilter = z.infer<typeof DataRequestFilterSchema>;

export const DataRequestTableSchema = z.strictObject({
  id: z.string().min(1).max(64),
  assetId: z.string().min(1).max(128),
  sqlName: z.string().min(1).max(255),
  alias: z.string().min(1).max(64),
  x: z.number().finite(),
  y: z.number().finite(),
  keep: z.array(z.string().min(1).max(255)).max(500),
  filters: z.array(DataRequestFilterSchema).max(DATA_REQUEST_MAX_FILTERS_PER_TABLE).default([]),
  color: z.enum(SCHEMA_TABLE_COLORS).optional(),
  height: z.number().finite().min(120).max(960).optional(),
  collapsed: z.boolean().optional(),
  hidden: z.boolean().optional(),
});
export type DataRequestTable = z.infer<typeof DataRequestTableSchema>;

export const DataRequestJoinEndpointSchema = z.strictObject({
  tableId: z.string().min(1).max(64),
  column: z.string().min(1).max(255),
});
export type DataRequestJoinEndpoint = z.infer<typeof DataRequestJoinEndpointSchema>;

export const DataRequestJoinSchema = z.strictObject({
  id: z.string().min(1).max(64),
  left: DataRequestJoinEndpointSchema,
  right: DataRequestJoinEndpointSchema,
  type: z.enum(DATA_REQUEST_JOIN_TYPES).default("INNER"),
  cardinality: z.enum(DATA_REQUEST_CARDINALITIES).optional(),
  constraintName: z.string().min(1).max(255).optional(),
  origin: z.enum(DATA_REQUEST_JOIN_ORIGINS).optional(),
});
export type DataRequestJoin = z.infer<typeof DataRequestJoinSchema>;

export const DataRequestGroupSchema = z.strictObject({
  id: z.string().min(1).max(64),
  label: z.string().max(120),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().min(80).max(4000),
  h: z.number().finite().min(60).max(4000),
  color: z.enum(SCHEMA_TABLE_COLORS).optional(),
});
export type DataRequestGroup = z.infer<typeof DataRequestGroupSchema>;

export const DataRequestPinAnchorSchema = z.strictObject({
  tableId: z.string().min(1).max(64),
  column: z.string().min(1).max(255).optional(),
});
export type DataRequestPinAnchor = z.infer<typeof DataRequestPinAnchorSchema>;

export const DataRequestPinSchema = z.strictObject({
  threadId: z.string().min(1).max(128),
  anchor: DataRequestPinAnchorSchema.nullable(),
  x: z.number().finite(),
  y: z.number().finite(),
});
export type DataRequestPin = z.infer<typeof DataRequestPinSchema>;

export const DataRequestSpecSchema = z.strictObject({
  tables: z.array(DataRequestTableSchema).max(DATA_REQUEST_MAX_TABLES + 4).default([]),
  joins: z.array(DataRequestJoinSchema).max(DATA_REQUEST_MAX_JOINS).default([]),
  pins: z.array(DataRequestPinSchema).max(DATA_REQUEST_MAX_PINS).default([]),
  groups: z.array(DataRequestGroupSchema).max(DATA_REQUEST_MAX_GROUPS).optional(),
});
export type DataRequestSpec = z.infer<typeof DataRequestSpecSchema>;

export const EMPTY_DATA_REQUEST_SPEC: DataRequestSpec = {
  tables: [],
  joins: [],
  pins: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// SQL generation
// ─────────────────────────────────────────────────────────────────────────────

export type RequestSqlDiagnosticCode =
  | "no_tables"
  | "no_columns"
  | "too_many_tables"
  | "too_many_sources"
  | "table_missing"
  | "invalid_table_name"
  | "invalid_alias"
  | "duplicate_alias"
  | "invalid_join"
  | "disconnected_table"
  | "unknown_column"
  | "invalid_filter_value";

export interface RequestSqlDiagnostic {
  level: "error" | "warning";
  code: RequestSqlDiagnosticCode;
  message: string;
  tableId?: string;
  joinId?: string;
  column?: string;
}

export interface RequestTableColumnMeta {
  name: string;
  type?: string | null;
}

export interface RequestTableMeta {
  sqlName?: string;
  exists?: boolean;
  columns?: readonly RequestTableColumnMeta[];
}

export type RequestTableLookup =
  | ReadonlyMap<string, RequestTableMeta>
  | Readonly<Record<string, RequestTableMeta | undefined>>
  | ((assetId: string) => RequestTableMeta | null | undefined);

export interface GenerateRequestSqlResult {
  sql: string;
  diagnostics: RequestSqlDiagnostic[];
}

const PLAIN_IDENT = /^[a-z_][a-z0-9_]*$/;
const THREE_PART_TABLE = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;
const NUMERIC_LITERAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Common SQL/DuckDB reserved words that must be double-quoted as column or alias identifiers. */
const SQL_RESERVED_WORDS = new Set([
  "all",
  "alter",
  "analyze",
  "and",
  "any",
  "array",
  "as",
  "asc",
  "asymmetric",
  "both",
  "by",
  "case",
  "cast",
  "check",
  "collate",
  "column",
  "constraint",
  "create",
  "cross",
  "current_catalog",
  "current_date",
  "current_role",
  "current_time",
  "current_timestamp",
  "current_user",
  "default",
  "deferrable",
  "desc",
  "distinct",
  "do",
  "else",
  "end",
  "except",
  "false",
  "fetch",
  "for",
  "foreign",
  "from",
  "full",
  "grant",
  "group",
  "having",
  "in",
  "initially",
  "inner",
  "intersect",
  "into",
  "is",
  "join",
  "lateral",
  "leading",
  "left",
  "like",
  "limit",
  "localtime",
  "localtimestamp",
  "natural",
  "not",
  "null",
  "offset",
  "on",
  "only",
  "or",
  "order",
  "outer",
  "over",
  "placing",
  "primary",
  "references",
  "returning",
  "right",
  "select",
  "session_user",
  "similar",
  "some",
  "symmetric",
  "table",
  "then",
  "to",
  "trailing",
  "true",
  "union",
  "unique",
  "user",
  "using",
  "values",
  "variadic",
  "when",
  "where",
  "window",
  "with",
]);

function resolveLookup(
  lookup: RequestTableLookup | undefined,
  assetId: string,
): RequestTableMeta | null | undefined {
  if (!lookup) return undefined;
  if (typeof lookup === "function") return lookup(assetId);
  if (lookup instanceof Map) return lookup.get(assetId);
  return (lookup as Readonly<Record<string, RequestTableMeta | undefined>>)[assetId];
}

/** Quote a column or output alias only when not a plain lower-case identifier or when reserved. */
export function quoteSqlIdent(name: string): string {
  if (PLAIN_IDENT.test(name) && !SQL_RESERVED_WORDS.has(name)) {
    return name;
  }
  return `"${name.replace(/"/g, '""')}"`;
}

/** Derive a deterministic, safe short alias for a table's sqlName (avoiding taken aliases). */
export function suggestTableAlias(sqlName: string, taken: ReadonlySet<string>): string {
  const leaf = (sqlName.split(".").pop() ?? "t").toLowerCase().replace(/[^a-z0-9_]/g, "");
  const base =
    leaf.length > 0 && /^[a-z]/.test(leaf)
      ? leaf[0]!
      : "t";
  if (!taken.has(base) && !SQL_RESERVED_WORDS.has(base)) return base;
  const word = leaf.length > 0 && /^[a-z_]/.test(leaf) ? leaf.slice(0, 12) : "tbl";
  if (!taken.has(word) && !SQL_RESERVED_WORDS.has(word)) return word;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base}${i}`;
    if (!taken.has(candidate) && !SQL_RESERVED_WORDS.has(candidate)) {
      return candidate;
    }
  }
  return `t_${taken.size + 1}`;
}

function classifyColumnType(rawType?: string | null): "number" | "boolean" | "string" {
  if (!rawType) return "string";
  const t = rawType.trim().toLowerCase().split("(")[0]?.trim() ?? "";
  if (
    t === "bool" ||
    t === "boolean"
  ) {
    return "boolean";
  }
  if (
    t === "int" ||
    t === "int2" ||
    t === "int4" ||
    t === "int8" ||
    t === "integer" ||
    t === "bigint" ||
    t === "smallint" ||
    t === "tinyint" ||
    t === "hugeint" ||
    t === "uinteger" ||
    t === "ubigint" ||
    t === "usmallint" ||
    t === "utinyint" ||
    t === "decimal" ||
    t === "numeric" ||
    t === "real" ||
    t === "float" ||
    t === "float4" ||
    t === "float8" ||
    t === "double" ||
    t === "double precision" ||
    t === "number"
  ) {
    return "number";
  }
  return "string";
}

function formatSqlLiteral(
  value: string | number | boolean,
  rawType?: string | null,
): { literal: string } | { error: string } {
  const kind = classifyColumnType(rawType);
  if (kind === "number") {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return { error: "Filter value must be a finite number." };
      return { literal: String(value) };
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed && NUMERIC_LITERAL.test(trimmed) && Number.isFinite(Number(trimmed))) {
        return { literal: trimmed };
      }
    }
    return { error: `Expected a numeric value, got "${String(value)}".` };
  }
  if (kind === "boolean") {
    if (typeof value === "boolean") return { literal: value ? "TRUE" : "FALSE" };
    if (typeof value === "number" && (value === 0 || value === 1)) {
      return { literal: value === 1 ? "TRUE" : "FALSE" };
    }
    if (typeof value === "string") {
      const lower = value.trim().toLowerCase();
      if (lower === "true" || lower === "1" || lower === "yes") return { literal: "TRUE" };
      if (lower === "false" || lower === "0" || lower === "no") return { literal: "FALSE" };
    }
    return { error: `Expected a boolean value (true/false), got "${String(value)}".` };
  }
  const text = String(value).replace(/\0/g, "");
  return { literal: `'${text.replace(/'/g, "''")}'` };
}

export interface GenerateRequestSqlOptions {
  /** Override max table limit (e.g. for Data Query explore mode). Defaults to DATA_REQUEST_MAX_TABLES. */
  maxTables?: number;
}

export function generateRequestSql(
  spec: DataRequestSpec,
  lookup?: RequestTableLookup,
  options?: GenerateRequestSqlOptions,
): GenerateRequestSqlResult {
  const diagnostics: RequestSqlDiagnostic[] = [];
  const maxTables = options?.maxTables ?? DATA_REQUEST_MAX_TABLES;

  if (!spec.tables.length) {
    diagnostics.push({
      level: "error",
      code: "no_tables",
      message: "Place at least one table on the canvas.",
    });
    return { sql: "", diagnostics };
  }

  if (spec.tables.length > maxTables) {
    diagnostics.push({
      level: "error",
      code: "too_many_tables",
      message: `A data request can include at most ${maxTables} tables.`,
    });
  }

  const tablesById = new Map<string, DataRequestTable>();
  const resolvedSqlName = new Map<string, string>();
  const colTypesByTable = new Map<string, Map<string, string | null>>();
  const knownColsByTable = new Map<string, Set<string>>();
  const seenAliases = new Set<string>();
  const sources = new Set<string>();

  for (const table of spec.tables) {
    tablesById.set(table.id, table);

    const meta = resolveLookup(lookup, table.assetId);
    if (lookup && (!meta || meta.exists === false)) {
      diagnostics.push({
        level: "error",
        code: "table_missing",
        tableId: table.id,
        message: `Table ${table.sqlName} no longer exists in the catalog.`,
      });
    }

    const sqlName = (meta?.sqlName ?? table.sqlName).trim().toLowerCase();
    resolvedSqlName.set(table.id, sqlName);

    if (!THREE_PART_TABLE.test(sqlName)) {
      diagnostics.push({
        level: "error",
        code: "invalid_table_name",
        tableId: table.id,
        message: `Table name "${sqlName}" must be an unquoted three-part identifier (source.schema.table).`,
      });
    } else {
      const src = sqlName.split(".")[0];
      if (src) sources.add(src);
    }

    const alias = table.alias.trim().toLowerCase();
    if (!PLAIN_IDENT.test(alias) || SQL_RESERVED_WORDS.has(alias)) {
      diagnostics.push({
        level: "error",
        code: "invalid_alias",
        tableId: table.id,
        message: `Alias "${table.alias}" is not a valid SQL alias.`,
      });
    } else if (seenAliases.has(alias)) {
      diagnostics.push({
        level: "error",
        code: "duplicate_alias",
        tableId: table.id,
        message: `Duplicate table alias "${alias}".`,
      });
    } else {
      seenAliases.add(alias);
    }

    if (meta?.columns) {
      const typeMap = new Map<string, string | null>();
      const colSet = new Set<string>();
      for (const col of meta.columns) {
        typeMap.set(col.name.toLowerCase(), col.type ?? null);
        colSet.add(col.name.toLowerCase());
      }
      colTypesByTable.set(table.id, typeMap);
      knownColsByTable.set(table.id, colSet);
    }
  }

  if (sources.size > DATA_REQUEST_MAX_SOURCES) {
    diagnostics.push({
      level: "error",
      code: "too_many_sources",
      message: `A query can read from at most ${DATA_REQUEST_MAX_SOURCES} sources (found ${sources.size}).`,
    });
  }

  // Validate joins and build BFS join order from spec.tables[0].
  const validJoins: DataRequestJoin[] = [];
  for (const join of spec.joins) {
    const leftTable = tablesById.get(join.left.tableId);
    const rightTable = tablesById.get(join.right.tableId);
    if (!leftTable || !rightTable) {
      diagnostics.push({
        level: "error",
        code: "invalid_join",
        joinId: join.id,
        message: "Join references a table that is not on the canvas.",
      });
      continue;
    }
    if (leftTable.id === rightTable.id) {
      diagnostics.push({
        level: "error",
        code: "invalid_join",
        joinId: join.id,
        message: "A table cannot join directly to itself; place a second copy of the table to self-join.",
      });
      continue;
    }
    if (!join.left.column.trim() || !join.right.column.trim()) {
      diagnostics.push({
        level: "error",
        code: "invalid_join",
        joinId: join.id,
        message: "Join must specify a column on both sides.",
      });
      continue;
    }
    validJoins.push(join);
  }

  const root = spec.tables[0]!;
  const visited = new Set<string>([root.id]);
  const usedJoinIds = new Set<string>();
  const queue: string[] = [root.id];

  interface JoinStep {
    table: DataRequestTable;
    type: DataRequestJoinType;
    conditions: {
      leftAlias: string;
      leftColumn: string;
      rightAlias: string;
      rightColumn: string;
    }[];
  }
  const joinSteps: JoinStep[] = [];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    // Find unvisited neighbor table IDs in deterministic spec.joins order
    const neighborIds: string[] = [];
    for (const join of validJoins) {
      if (usedJoinIds.has(join.id)) continue;
      let nextId: string | null = null;
      if (join.left.tableId === currentId && !visited.has(join.right.tableId)) {
        nextId = join.right.tableId;
      } else if (join.right.tableId === currentId && !visited.has(join.left.tableId)) {
        nextId = join.left.tableId;
      }
      if (nextId && !neighborIds.includes(nextId)) {
        neighborIds.push(nextId);
      }
    }

    for (const nextId of neighborIds) {
      // Collect every unused join between nextId and ANY already-visited table
      // so multi-column joins between the same pair become one ON with AND,
      // and cycle joins are attached deterministically too.
      const attachedJoins: DataRequestJoin[] = [];
      for (const join of validJoins) {
        if (usedJoinIds.has(join.id)) continue;
        const connectsNextToVisited =
          (join.left.tableId === nextId && visited.has(join.right.tableId)) ||
          (join.right.tableId === nextId && visited.has(join.left.tableId));
        if (connectsNextToVisited) {
          attachedJoins.push(join);
          usedJoinIds.add(join.id);
        }
      }

      visited.add(nextId);
      queue.push(nextId);

      const targetTable = tablesById.get(nextId)!;
      const joinType: DataRequestJoinType = attachedJoins[0]?.type ?? "INNER";
      const conditions = attachedJoins.map((j) => {
        // Order condition deterministically: already-visited side on the left, newly joined table on the right
        const leftIsTarget = j.left.tableId === nextId;
        const lhs = leftIsTarget ? j.right : j.left;
        const rhs = leftIsTarget ? j.left : j.right;
        return {
          leftAlias: tablesById.get(lhs.tableId)!.alias.trim().toLowerCase(),
          leftColumn: lhs.column,
          rightAlias: tablesById.get(rhs.tableId)!.alias.trim().toLowerCase(),
          rightColumn: rhs.column,
        };
      });
      joinSteps.push({ table: targetTable, type: joinType, conditions });
    }
  }

  for (const table of spec.tables) {
    if (!visited.has(table.id)) {
      diagnostics.push({
        level: "error",
        code: "disconnected_table",
        tableId: table.id,
        message: `Table ${resolvedSqlName.get(table.id) ?? table.sqlName} is not joined to the other tables.`,
      });
    }
  }

  // SELECT list + collision detection across kept columns
  const columnCounts = new Map<string, number>();
  for (const table of spec.tables) {
    const knownCols = knownColsByTable.get(table.id);
    for (const col of table.keep) {
      const key = col.toLowerCase();
      columnCounts.set(key, (columnCounts.get(key) ?? 0) + 1);
      if (knownCols && !knownCols.has(key)) {
        diagnostics.push({
          level: "warning",
          code: "unknown_column",
          tableId: table.id,
          column: col,
          message: `Column "${col}" was not found on ${resolvedSqlName.get(table.id) ?? table.sqlName}.`,
        });
      }
    }
  }

  const selectItems: string[] = [];
  for (const table of spec.tables) {
    const alias = table.alias.trim().toLowerCase();
    for (const col of table.keep) {
      const ref = `${alias}.${quoteSqlIdent(col)}`;
      if ((columnCounts.get(col.toLowerCase()) ?? 0) > 1) {
        const outAlias = `${alias}_${col}`;
        selectItems.push(`${ref} AS ${quoteSqlIdent(outAlias)}`);
      } else {
        selectItems.push(ref);
      }
    }
  }

  if (selectItems.length === 0) {
    diagnostics.push({
      level: "error",
      code: "no_columns",
      message: "Select at least one column to include in the dataset.",
    });
  }

  // WHERE clauses
  const whereItems: string[] = [];
  for (const table of spec.tables) {
    const alias = table.alias.trim().toLowerCase();
    const typeMap = colTypesByTable.get(table.id);
    const knownCols = knownColsByTable.get(table.id);
    for (const filter of table.filters) {
      if (knownCols && !knownCols.has(filter.column.toLowerCase())) {
        diagnostics.push({
          level: "warning",
          code: "unknown_column",
          tableId: table.id,
          column: filter.column,
          message: `Filter column "${filter.column}" was not found on ${resolvedSqlName.get(table.id) ?? table.sqlName}.`,
        });
      }
      const colRef = `${alias}.${quoteSqlIdent(filter.column)}`;
      const colType = typeMap?.get(filter.column.toLowerCase()) ?? null;

      if (filter.op === "IS NULL" || filter.op === "IS NOT NULL") {
        whereItems.push(`${colRef} ${filter.op}`);
        continue;
      }

      if (filter.op === "IN" || filter.op === "NOT IN") {
        const rawList =
          filter.values && filter.values.length > 0
            ? filter.values
            : filter.value !== undefined && filter.value !== null
              ? [filter.value]
              : [];
        if (rawList.length === 0) {
          diagnostics.push({
            level: "error",
            code: "invalid_filter_value",
            tableId: table.id,
            column: filter.column,
            message: `Filter on ${filter.column} (${filter.op}) needs at least one value.`,
          });
          continue;
        }
        const formatted: string[] = [];
        let ok = true;
        for (const item of rawList) {
          const res = formatSqlLiteral(item, colType);
          if ("error" in res) {
            diagnostics.push({
              level: "error",
              code: "invalid_filter_value",
              tableId: table.id,
              column: filter.column,
              message: `Filter on ${filter.column}: ${res.error}`,
            });
            ok = false;
            break;
          }
          formatted.push(res.literal);
        }
        if (ok) {
          whereItems.push(`${colRef} ${filter.op} (${formatted.join(", ")})`);
        }
        continue;
      }

      if (filter.value === undefined || filter.value === null) {
        diagnostics.push({
          level: "error",
          code: "invalid_filter_value",
          tableId: table.id,
          column: filter.column,
          message: `Filter on ${filter.column} (${filter.op}) needs a value.`,
        });
        continue;
      }

      const effectiveType =
        filter.op === "LIKE" || filter.op === "ILIKE" ? "string" : colType;
      const res = formatSqlLiteral(filter.value, effectiveType);
      if ("error" in res) {
        diagnostics.push({
          level: "error",
          code: "invalid_filter_value",
          tableId: table.id,
          column: filter.column,
          message: `Filter on ${filter.column}: ${res.error}`,
        });
        continue;
      }
      whereItems.push(`${colRef} ${filter.op} ${res.literal}`);
    }
  }

  if (diagnostics.some((d) => d.level === "error")) {
    return { sql: "", diagnostics };
  }

  const lines: string[] = [
    "SELECT",
    selectItems.map((item) => `  ${item}`).join(",\n"),
    `FROM ${resolvedSqlName.get(root.id)!} ${root.alias.trim().toLowerCase()}`,
  ];

  for (const step of joinSteps) {
    const targetSqlName = resolvedSqlName.get(step.table.id)!;
    const targetAlias = step.table.alias.trim().toLowerCase();
    const joinClause = step.type === "FULL" ? "FULL OUTER JOIN" : `${step.type} JOIN`;
    lines.push(`${joinClause} ${targetSqlName} ${targetAlias}`);
    step.conditions.forEach((cond, idx) => {
      const prefix = idx === 0 ? "  ON" : "  AND";
      lines.push(
        `${prefix} ${cond.leftAlias}.${quoteSqlIdent(cond.leftColumn)} = ${cond.rightAlias}.${quoteSqlIdent(cond.rightColumn)}`,
      );
    });
  }

  if (whereItems.length > 0) {
    lines.push("WHERE");
    whereItems.forEach((clause, idx) => {
      lines.push(idx === 0 ? `  ${clause}` : `  AND ${clause}`);
    });
  }

  return {
    sql: lines.join("\n"),
    diagnostics,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Case-card sketch builder (compatible with @workspace/schemas/case-board BoardSketch)
// ─────────────────────────────────────────────────────────────────────────────

export type DataRequestSketchNode =
  | { t: "h"; x: number; y: number; w: number; h: number; c: string; l?: string }
  | { t: "p"; x: number; y: number };

export interface DataRequestSketchEdge {
  a: number;
  b: number;
  t: "l" | "s";
}

export interface DataRequestSketch {
  v: 1;
  w: number;
  h: number;
  nodes: DataRequestSketchNode[];
  edges: DataRequestSketchEdge[];
}

const TABLE_CARD_WIDTH = 220;
const TABLE_CARD_BASE_HEIGHT = 84;
const TABLE_CARD_ROW_HEIGHT = 18;
const TABLE_CARD_MAX_HEIGHT = 210;
const SKETCH_PAD = 32;
const DEFAULT_TABLE_ACCENT_HEX = "#0a0a0a";

export const SCHEMA_TABLE_COLOR_HEX: Readonly<Record<SchemaTableColor, string>> = {
  gray: "#737373",
  green: "#16a34a",
  amber: "#d97706",
  blue: "#2563eb",
  violet: "#7c3aed",
  pink: "#db2777",
  yellow: "#eab308",
  red: "#dc2626",
};

function tableCardHeight(table: DataRequestTable): number {
  const rows = Math.max(2, Math.min(7, table.keep.length || 3));
  return Math.min(TABLE_CARD_MAX_HEIGHT, TABLE_CARD_BASE_HEIGHT + rows * TABLE_CARD_ROW_HEIGHT);
}

/**
 * Turn a data-request canvas spec into a v1 BoardSketch for `BoardSketchCanvas`
 * thumbnails on case cards. Returns null when the canvas has no visible tables or pins.
 */
export function specToSketch(spec: DataRequestSpec): DataRequestSketch | null {
  const visibleTables = spec.tables.filter((t) => !t.hidden);
  if (!visibleTables.length && !spec.pins.length) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const table of visibleTables) {
    const h = tableCardHeight(table);
    minX = Math.min(minX, table.x);
    minY = Math.min(minY, table.y);
    maxX = Math.max(maxX, table.x + TABLE_CARD_WIDTH);
    maxY = Math.max(maxY, table.y + h);
  }
  for (const pin of spec.pins) {
    minX = Math.min(minX, pin.x - 12);
    minY = Math.min(minY, pin.y - 12);
    maxX = Math.max(maxX, pin.x + 12);
    maxY = Math.max(maxY, pin.y + 12);
  }

  const offsetX = SKETCH_PAD - minX;
  const offsetY = SKETCH_PAD - minY;
  const width = Math.max(1, Math.round(maxX - minX + SKETCH_PAD * 2));
  const height = Math.max(1, Math.round(maxY - minY + SKETCH_PAD * 2));

  const nodes: DataRequestSketchNode[] = [];
  const indexByTableId = new Map<string, number>();

  for (const table of visibleTables) {
    const idx = nodes.length;
    indexByTableId.set(table.id, idx);
    const label = (table.sqlName.split(".").pop() ?? table.sqlName).slice(0, 80);
    const colorHex = table.color ? SCHEMA_TABLE_COLOR_HEX[table.color] : DEFAULT_TABLE_ACCENT_HEX;
    nodes.push({
      t: "h",
      x: Math.max(0, Math.round(table.x + offsetX)),
      y: Math.max(0, Math.round(table.y + offsetY)),
      w: TABLE_CARD_WIDTH,
      h: tableCardHeight(table),
      c: colorHex,
      l: label,
    });
  }

  for (const pin of spec.pins) {
    nodes.push({
      t: "p",
      x: Math.max(0, Math.round(pin.x + offsetX)),
      y: Math.max(0, Math.round(pin.y + offsetY)),
    });
  }

  const seenPairs = new Set<string>();
  const edges: DataRequestSketchEdge[] = [];
  for (const join of spec.joins) {
    const a = indexByTableId.get(join.left.tableId);
    const b = indexByTableId.get(join.right.tableId);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    edges.push({
      a,
      b,
      t: join.type === "INNER" ? "l" : "s",
    });
  }

  return {
    v: 1,
    w: width,
    h: height,
    nodes,
    edges,
  };
}
