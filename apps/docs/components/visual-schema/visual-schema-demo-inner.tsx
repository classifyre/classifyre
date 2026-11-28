"use client";

import "@xyflow/react/dist/style.css";
import "@workspace/case-board/board.css";
import "./visual-schema-demo.css";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionMode,
  getSmoothStepPath,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  useStore as useFlowStore,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Code2,
  EyeOff,
  FileCode2,
  Grid3x3,
  Hand,
  KeyRound,
  LayoutGrid,
  Link2,
  Lock,
  Map as MapIcon,
  Maximize2,
  MessageSquare,
  Minus,
  MousePointer2,
  Palette,
  Plus,
  RotateCcw,
  Shield,
  Sparkles,
  X,
} from "lucide-react";
import {
  generateRequestSql,
  SCHEMA_TABLE_COLOR_HEX,
  type DataRequestCardinality,
  type DataRequestJoin,
  type DataRequestSpec,
  type DataRequestTable,
  type SchemaTableColor,
} from "@workspace/schemas/data-request";
import { EdgeLabel } from "@workspace/case-board/components/edge-label";
import { cn } from "@workspace/ui/lib/utils";

export type VisualSchemaSceneName = "overview" | "data-request";

interface DemoColumn {
  name: string;
  type: string;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  nullable?: boolean;
  masked?: string;
}

interface DemoCatalogTable {
  assetId: string;
  sqlName: string;
  schema: string;
  table: string;
  canQuery: boolean;
  rowCount?: number;
  rowFilter?: boolean;
  hiddenColumns?: number;
  columns: DemoColumn[];
}

const DEMO_CATALOG: Record<string, DemoCatalogTable> = {
  "a-orders": {
    assetId: "a-orders",
    sqlName: "shop_db.public.orders",
    schema: "public",
    table: "orders",
    canQuery: true,
    rowCount: 142_000,
    hiddenColumns: 1,
    columns: [
      { name: "id", type: "BIGINT", isPrimaryKey: true, nullable: false },
      { name: "customer_id", type: "BIGINT", isForeignKey: true, nullable: false },
      { name: "amount", type: "NUMERIC", nullable: false },
      { name: "status", type: "VARCHAR", nullable: true },
    ],
  },
  "a-customers": {
    assetId: "a-customers",
    sqlName: "crm_db.public.customers",
    schema: "public",
    table: "customers",
    canQuery: false,
    rowFilter: true,
    columns: [
      { name: "id", type: "BIGINT", isPrimaryKey: true, nullable: false },
      { name: "region", type: "VARCHAR", nullable: false },
      { name: "email", type: "VARCHAR", nullable: false, masked: "Redacted" },
      { name: "tier", type: "VARCHAR", nullable: true },
    ],
  },
  "a-items": {
    assetId: "a-items",
    sqlName: "shop_db.public.order_items",
    schema: "public",
    table: "order_items",
    canQuery: true,
    rowCount: 410_000,
    columns: [
      { name: "id", type: "BIGINT", isPrimaryKey: true, nullable: false },
      { name: "order_id", type: "BIGINT", isForeignKey: true, nullable: false },
      { name: "sku", type: "VARCHAR", nullable: false },
      { name: "qty", type: "INTEGER", nullable: false },
    ],
  },
};

const CATALOG_FK_SUGGESTIONS: Array<{
  fromAsset: string;
  fromCol: string;
  toAsset: string;
  toCol: string;
  cardinality: DataRequestCardinality;
  constraintName: string;
}> = [
  {
    fromAsset: "a-orders",
    fromCol: "customer_id",
    toAsset: "a-customers",
    toCol: "id",
    cardinality: "N-1",
    constraintName: "fk_orders_customer",
  },
  {
    fromAsset: "a-items",
    fromCol: "order_id",
    toAsset: "a-orders",
    toCol: "id",
    cardinality: "N-1",
    constraintName: "fk_items_order",
  },
];

const SWATCH_CYCLE: Array<SchemaTableColor | undefined> = [
  undefined,
  "amber",
  "violet",
  "green",
  "blue",
];

const SWATCH_CSS: Record<SchemaTableColor, string> = {
  gray: "var(--cb-gray)",
  green: "var(--cb-green)",
  amber: "var(--cb-amber)",
  blue: "var(--cb-blue)",
  violet: "var(--cb-violet)",
  pink: "var(--cb-pink)",
  yellow: "var(--cb-yellow)",
  red: "var(--cb-red)",
};

const LOD_ZOOM = 0.45;

function colHandleId(side: "l" | "r", column: string): string {
  return `col:${side}:${column}`;
}

function parseColHandleId(id: string | null | undefined): string | null {
  if (!id || !id.startsWith("col:")) return null;
  const parts = id.split(":");
  return parts.length >= 3 ? parts.slice(2).join(":") : null;
}

function initialSpecFor(scene: VisualSchemaSceneName): DataRequestSpec {
  if (scene === "data-request") {
    return {
      tables: [
        {
          id: "t-orders",
          assetId: "a-orders",
          sqlName: "shop_db.public.orders",
          alias: "o",
          x: 40,
          y: 40,
          keep: ["id", "amount", "status"],
          filters: [{ id: "f1", column: "status", op: "=", value: "paid" }],
          color: "amber",
        },
        {
          id: "t-customers",
          assetId: "a-customers",
          sqlName: "crm_db.public.customers",
          alias: "c",
          x: 380,
          y: 40,
          keep: ["region", "email"],
          filters: [],
          color: "violet",
        },
      ],
      joins: [
        {
          id: "j-oc",
          left: { tableId: "t-orders", column: "customer_id" },
          right: { tableId: "t-customers", column: "id" },
          type: "INNER",
          cardinality: "N-1",
          origin: "fk",
          constraintName: "fk_orders_customer",
        },
      ],
      pins: [],
      groups: [],
    };
  }

  return {
    tables: [
      {
        id: "t-orders",
        assetId: "a-orders",
        sqlName: "shop_db.public.orders",
        alias: "o",
        x: 320,
        y: 40,
        keep: ["id", "amount", "status"],
        filters: [],
      },
      {
        id: "t-customers",
        assetId: "a-customers",
        sqlName: "crm_db.public.customers",
        alias: "c",
        x: 640,
        y: 40,
        keep: ["region", "email"],
        filters: [],
        color: "violet",
      },
      {
        id: "t-items",
        assetId: "a-items",
        sqlName: "shop_db.public.order_items",
        alias: "oi",
        x: 20,
        y: 120,
        keep: ["sku", "qty"],
        filters: [],
        color: "amber",
      },
    ],
    joins: [
      {
        id: "j-oc",
        left: { tableId: "t-orders", column: "customer_id" },
        right: { tableId: "t-customers", column: "id" },
        type: "INNER",
        cardinality: "N-1",
        origin: "fk",
        constraintName: "fk_orders_customer",
      },
    ],
    pins: [],
    groups: [],
  };
}

function buildDemoDbml(spec: DataRequestSpec): string {
  const tableById = new Map(spec.tables.map((t) => [t.id, t]));
  const blocks: string[] = [];
  for (const t of spec.tables) {
    const cat = DEMO_CATALOG[t.assetId];
    if (!cat) continue;
    const cols = cat.columns.map((c) => {
      const attrs: string[] = [];
      if (c.isPrimaryKey) attrs.push("pk");
      if (c.nullable === false) attrs.push("not null");
      return `  ${c.name} ${c.type}${attrs.length ? ` [${attrs.join(", ")}]` : ""}`;
    });
    blocks.push(`Table ${cat.schema}.${cat.table} as ${t.alias} {\n${cols.join("\n")}\n}`);
  }
  const refs: string[] = [];
  for (const j of spec.joins) {
    const lt = tableById.get(j.left.tableId);
    const rt = tableById.get(j.right.tableId);
    const lc = lt ? DEMO_CATALOG[lt.assetId] : undefined;
    const rc = rt ? DEMO_CATALOG[rt.assetId] : undefined;
    if (!lc || !rc) continue;
    const op = j.cardinality === "1-1" ? "-" : j.cardinality === "1-N" ? "<" : ">";
    const name = j.constraintName ? ` ${j.constraintName}` : "";
    refs.push(`Ref${name}: ${lc.schema}.${lc.table}.${j.left.column} ${op} ${rc.schema}.${rc.table}.${j.right.column}`);
  }
  if (refs.length) blocks.push(refs.join("\n"));
  return blocks.join("\n\n");
}

interface DemoNodeData extends Record<string, unknown> {
  table: DataRequestTable;
  catalog: DemoCatalogTable;
  joinedColumns: string[];
  hasError: boolean;
  onToggleColumn: (tableId: string, col: string) => void;
  onToggleCollapse: (tableId: string) => void;
  onCycleColor: (tableId: string) => void;
}

type DemoTableNodeType = Node<DemoNodeData, "demo-table">;

interface DemoPinData extends Record<string, unknown> {
  text: string;
  anchorLabel: string;
}

type DemoPinNodeType = Node<DemoPinData, "demo-pin">;

const DemoTableNode = React.memo(function DemoTableNode({
  data,
  selected,
}: NodeProps<DemoTableNodeType>) {
  const compact = useFlowStore((s) => s.transform[2] < LOD_ZOOM);
  const { table, catalog, joinedColumns, hasError, onToggleColumn, onToggleCollapse, onCycleColor } = data;
  const keepSet = React.useMemo(() => new Set(table.keep), [table.keep]);
  const joinedSet = React.useMemo(() => new Set(joinedColumns), [joinedColumns]);
  const accent = hasError
    ? "var(--destructive)"
    : table.color
      ? SWATCH_CSS[table.color]
      : "var(--foreground)";

  const prefix = table.sqlName.split(".").slice(0, -1).join(".");

  if (compact) {
    return (
      <div
        className={cn(
          "flex min-h-[58px] w-[240px] flex-col justify-center rounded-xs border border-border bg-card px-3 py-2 text-card-foreground",
          selected && "outline-2 outline-[var(--cb-select)] outline-offset-1",
          hasError && "border-destructive",
        )}
        style={{ borderLeftWidth: 4, borderLeftColor: accent }}
      >
        <div className="flex items-center gap-1.5">
          <span className="truncate font-mono text-sm font-bold">{catalog.table}</span>
          <span className="rounded-xs border border-border/50 bg-muted px-1 font-mono text-[10px] font-semibold">
            {table.alias}
          </span>
          {!catalog.canQuery && <Lock className="size-3 shrink-0 text-[var(--cb-amber)]" />}
        </div>
        <span className="truncate font-mono text-[10px] text-muted-foreground">{prefix}</span>
        {catalog.columns.map((col) => (
          <React.Fragment key={col.name}>
            <Handle type="source" position={Position.Left} id={colHandleId("l", col.name)} isConnectable={false} className="!pointer-events-none !h-1 !w-1 !border-0 !bg-transparent !opacity-0" />
            <Handle type="source" position={Position.Right} id={colHandleId("r", col.name)} isConnectable={false} className="!pointer-events-none !h-1 !w-1 !border-0 !bg-transparent !opacity-0" />
          </React.Fragment>
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative w-[246px] rounded-xs border border-border bg-card text-card-foreground",
        selected && "outline-2 outline-[var(--cb-select)] outline-offset-1",
        hasError && "border-destructive",
      )}
      style={{ borderTopWidth: 3, borderTopColor: accent }}
    >
      <div className="flex items-start gap-1 border-b border-border/50 bg-muted/30 px-2 py-1.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse(table.id);
          }}
          className="mt-0.5 rounded-xs p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title={table.collapsed ? "Expand table" : "Collapse table"}
        >
          {table.collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-xs font-semibold">{catalog.table}</span>
            <span className="shrink-0 rounded-xs border border-border/50 bg-muted px-1 font-mono text-[10px] font-semibold">
              {table.alias}
            </span>
            {!catalog.canQuery && (
              <span title="Locked table: visible in schema, requires Data Request to query">
                <Lock className="size-3 shrink-0 text-[var(--cb-amber)]" />
              </span>
            )}
            {catalog.rowFilter && (
              <span title="Row filter active">
                <Shield className="size-3 shrink-0 text-[var(--cb-amber)]" />
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <span className="truncate">{prefix}</span>
            {typeof catalog.rowCount === "number" && (
              <span className="ml-auto shrink-0 tabular-nums">~{Math.round(catalog.rowCount / 1000)}k</span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCycleColor(table.id);
          }}
          className="rounded-xs p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Cycle card color"
        >
          <Palette className="size-3.5" />
        </button>
      </div>

      {table.collapsed ? (
        <>
          {catalog.columns.map((col) => (
            <React.Fragment key={col.name}>
              <Handle type="source" position={Position.Left} id={colHandleId("l", col.name)} isConnectable={false} className="!pointer-events-none !h-1 !w-1 !border-0 !bg-transparent !opacity-0" />
              <Handle type="source" position={Position.Right} id={colHandleId("r", col.name)} isConnectable={false} className="!pointer-events-none !h-1 !w-1 !border-0 !bg-transparent !opacity-0" />
            </React.Fragment>
          ))}
        </>
      ) : (
        <div className="nodrag divide-y divide-border/30">
          {catalog.columns.map((col) => {
            const checked = keepSet.has(col.name);
            const isJoined = joinedSet.has(col.name);
            return (
              <div
                key={col.name}
                className={cn(
                  "relative flex items-center gap-1.5 px-2.5 py-1 text-xs hover:bg-muted/40",
                  isJoined && "bg-[color-mix(in_oklab,var(--cb-select)_12%,transparent)]",
                )}
              >
                <Handle
                  type="source"
                  position={Position.Left}
                  id={colHandleId("l", col.name)}
                  className={cn("vs-col-handle !-left-1.5", isJoined && "vs-col-handle-joined")}
                />
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleColumn(table.id, col.name)}
                  aria-label={`Include ${table.alias}.${col.name}`}
                  className="size-3 cursor-pointer accent-foreground"
                />
                {col.isPrimaryKey && (
                  <KeyRound className="size-3 shrink-0 text-[var(--cb-amber)]" aria-label="PK" />
                )}
                {col.isForeignKey && (
                  <Link2 className="size-3 shrink-0 text-[var(--cb-violet)]" aria-label="FK" />
                )}
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate font-mono text-[11px]",
                    !checked && "text-muted-foreground",
                  )}
                >
                  {col.name}
                </span>
                {col.masked && (
                  <span className="rounded-xs border border-[var(--cb-amber)]/60 bg-[var(--cb-amber-soft)] px-1 font-mono text-[8.5px] font-semibold uppercase text-foreground">
                    {col.masked}
                  </span>
                )}
                <span className="shrink-0 font-mono text-[9px] uppercase text-muted-foreground">
                  {col.type}
                  {col.nullable ? "?" : ""}
                </span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={colHandleId("r", col.name)}
                  className={cn("vs-col-handle !-right-1.5", isJoined && "vs-col-handle-joined")}
                />
              </div>
            );
          })}
          {table.filters.length > 0 && (
            <div className="bg-muted/20 px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
              WHERE {table.filters.map((f) => `${f.column} ${f.op} '${String(f.value ?? "")}'`).join(" AND ")}
            </div>
          )}
          {(catalog.hiddenColumns ?? 0) > 0 && (
            <div className="flex items-center gap-1 bg-muted/20 px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
              <EyeOff className="size-3 text-[var(--cb-amber)]" />
              <span>{catalog.hiddenColumns} hidden column</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

const DemoCommentPin = React.memo(function DemoCommentPin({ data }: NodeProps<DemoPinNodeType>) {
  return (
    <div className="max-w-[210px] rounded-xs border-2 border-border bg-card px-2.5 py-1.5 text-[11px] text-card-foreground">
      <div className="mb-0.5 flex items-center gap-1 font-mono text-[9.5px] font-semibold uppercase text-[var(--accent-ink)]">
        <MessageSquare className="size-3" />
        <span>{data.anchorLabel}</span>
      </div>
      <p className="m-0 leading-snug text-muted-foreground">{data.text}</p>
    </div>
  );
});

interface DemoEdgeData extends Record<string, unknown> {
  join: DataRequestJoin;
  onToggleType: (joinId: string) => void;
  onRemove: (joinId: string) => void;
}

type DemoEdgeType = Edge<DemoEdgeData, "demo-relation">;

const DemoRelationEdge = React.memo(function DemoRelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps<DemoEdgeType>) {
  const [hovered, setHovered] = React.useState(false);
  const compact = useFlowStore((s) => s.transform[2] < LOD_ZOOM);
  const join = data?.join;
  const highlighted = Boolean(selected || hovered);
  const isOuter = join?.type === "LEFT" || join?.type === "RIGHT" || join?.type === "FULL";
  const isInferred = join?.origin === "inferred";

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 6,
    offset: 24,
  });

  const strokeDasharray = isOuter ? "5 4" : isInferred ? "2 3" : undefined;
  const card = join?.cardinality?.split("-") ?? null;
  const srcDx = sourcePosition === Position.Left ? -14 : 14;
  const tgtDx = targetPosition === Position.Left ? -14 : 14;

  return (
    <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: highlighted ? "var(--cb-select)" : "var(--cb-edge)",
          strokeWidth: highlighted ? 2.25 : 1.5,
          strokeDasharray,
        }}
      />
      {card && card.length === 2 && (
        <>
          <text
            x={sourceX + srcDx}
            y={sourceY - 6}
            textAnchor="middle"
            className="vs-halo pointer-events-none select-none font-mono text-[10px] font-bold"
            fill={highlighted ? "var(--cb-select)" : "var(--foreground)"}
          >
            {card[0]}
          </text>
          <text
            x={targetX + tgtDx}
            y={targetY - 6}
            textAnchor="middle"
            className="vs-halo pointer-events-none select-none font-mono text-[10px] font-bold"
            fill={highlighted ? "var(--cb-select)" : "var(--foreground)"}
          >
            {card[1]}
          </text>
        </>
      )}
      {join && (!compact || highlighted) && (
        <EdgeLabel x={labelX} y={labelY} interactive>
          <div
            className={cn(
              "flex items-center gap-1 rounded-xs border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-foreground",
              highlighted && "border-[var(--cb-select)]",
            )}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                data?.onToggleType(join.id);
              }}
              className="cursor-pointer font-semibold uppercase hover:text-[var(--accent-ink)]"
              title="Click to cycle INNER / LEFT / RIGHT / FULL"
            >
              {join.type}
            </button>
            <span className="text-muted-foreground">
              {join.left.column} = {join.right.column}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                data?.onRemove(join.id);
              }}
              className="ml-0.5 rounded-xs p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label="Remove join"
            >
              <X className="size-2.5" />
            </button>
          </div>
        </EdgeLabel>
      )}
    </g>
  );
});

const NODE_TYPES = {
  "demo-table": DemoTableNode,
  "demo-pin": DemoCommentPin,
};

const EDGE_TYPES = {
  "demo-relation": DemoRelationEdge,
};

const JOIN_CYCLE: Array<DataRequestJoin["type"]> = ["INNER", "LEFT", "RIGHT", "FULL"];

function VisualSchemaCanvasInner({
  scene,
  height,
}: {
  scene: VisualSchemaSceneName;
  height: number;
}) {
  const rf = useReactFlow();
  const zoom = useFlowStore((s) => s.transform[2]);
  const [spec, setSpec] = React.useState<DataRequestSpec>(() => initialSpecFor(scene));
  const [mode, setMode] = React.useState<"pan" | "select">("pan");
  const [showGrid, setShowGrid] = React.useState(true);
  const [showMinimap, setShowMinimap] = React.useState(false);
  const [inspectorTab, setInspectorTab] = React.useState<"sql" | "dbml">("sql");
  const [statusNote, setStatusNote] = React.useState<string | null>(null);

  const generated = React.useMemo(() => {
    const lookup = new Map(
      Object.values(DEMO_CATALOG).map((c) => [
        c.assetId,
        {
          sqlName: c.sqlName,
          exists: true,
          columns: c.columns.map((col) => ({ name: col.name, type: col.type })),
        },
      ]),
    );
    return generateRequestSql(spec, lookup);
  }, [spec]);

  const dbmlText = React.useMemo(() => buildDemoDbml(spec), [spec]);

  const errorTableIds = React.useMemo(
    () => new Set(generated.diagnostics.filter((d) => d.level === "error" && d.tableId).map((d) => d.tableId!)),
    [generated.diagnostics],
  );

  const joinedColsByTable = React.useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const j of spec.joins) {
      (map.get(j.left.tableId) ?? map.set(j.left.tableId, new Set()).get(j.left.tableId)!).add(j.left.column);
      (map.get(j.right.tableId) ?? map.set(j.right.tableId, new Set()).get(j.right.tableId)!).add(j.right.column);
    }
    return map;
  }, [spec.joins]);

  const handleToggleColumn = React.useCallback((tableId: string, col: string) => {
    setSpec((prev) => ({
      ...prev,
      tables: prev.tables.map((t) =>
        t.id !== tableId
          ? t
          : { ...t, keep: t.keep.includes(col) ? t.keep.filter((c) => c !== col) : [...t.keep, col] },
      ),
    }));
  }, []);

  const handleToggleCollapse = React.useCallback((tableId: string) => {
    setSpec((prev) => ({
      ...prev,
      tables: prev.tables.map((t) => (t.id === tableId ? { ...t, collapsed: !t.collapsed } : t)),
    }));
  }, []);

  const handleCycleColor = React.useCallback((tableId: string) => {
    setSpec((prev) => ({
      ...prev,
      tables: prev.tables.map((t) => {
        if (t.id !== tableId) return t;
        const idx = SWATCH_CYCLE.indexOf(t.color);
        const next = SWATCH_CYCLE[(idx + 1) % SWATCH_CYCLE.length];
        return { ...t, color: next };
      }),
    }));
  }, []);

  const handleToggleJoinType = React.useCallback((joinId: string) => {
    setSpec((prev) => ({
      ...prev,
      joins: prev.joins.map((j) => {
        if (j.id !== joinId) return j;
        const nextType = JOIN_CYCLE[(JOIN_CYCLE.indexOf(j.type) + 1) % JOIN_CYCLE.length]!;
        return { ...j, type: nextType };
      }),
    }));
  }, []);

  const handleRemoveJoin = React.useCallback((joinId: string) => {
    setSpec((prev) => ({ ...prev, joins: prev.joins.filter((j) => j.id !== joinId) }));
  }, []);

  const handleFindLinks = React.useCallback(() => {
    let added = 0;
    setSpec((prev) => {
      const nextJoins = [...prev.joins];
      for (const fk of CATALOG_FK_SUGGESTIONS) {
        const left = prev.tables.find((t) => t.assetId === fk.fromAsset);
        const right = prev.tables.find((t) => t.assetId === fk.toAsset);
        if (!left || !right) continue;
        const exists = nextJoins.some(
          (j) =>
            (j.left.tableId === left.id && j.right.tableId === right.id && j.left.column === fk.fromCol && j.right.column === fk.toCol) ||
            (j.left.tableId === right.id && j.right.tableId === left.id && j.left.column === fk.toCol && j.right.column === fk.fromCol),
        );
        if (exists) continue;
        added += 1;
        nextJoins.push({
          id: `j-fk-${Date.now()}-${added}`,
          left: { tableId: left.id, column: fk.fromCol },
          right: { tableId: right.id, column: fk.toCol },
          type: "INNER",
          cardinality: fk.cardinality,
          origin: "fk",
          constraintName: fk.constraintName,
        });
      }
      return added > 0 ? { ...prev, joins: nextJoins } : prev;
    });
    setStatusNote(added > 0 ? `Added ${added} catalog FK link${added > 1 ? "s" : ""}.` : "All catalog FK links are already placed.");
    setTimeout(() => setStatusNote(null), 2600);
  }, []);

  const handleArrange = React.useCallback(() => {
    setSpec((prev) => ({
      ...prev,
      tables: prev.tables.map((t, idx) => ({
        ...t,
        x: 20 + idx * 310,
        y: 50,
      })),
    }));
    requestAnimationFrame(() => {
      void rf.fitView({ padding: 0.18, duration: 200 });
    });
  }, [rf]);

  const handleReset = React.useCallback(() => {
    setSpec(initialSpecFor(scene));
    setStatusNote(null);
    requestAnimationFrame(() => {
      void rf.fitView({ padding: 0.18, duration: 200 });
    });
  }, [scene, rf]);

  const nodes: Node[] = React.useMemo(() => {
    const tableNodes: DemoTableNodeType[] = spec.tables.map((table) => ({
      id: table.id,
      type: "demo-table",
      position: { x: table.x, y: table.y },
      data: {
        table,
        catalog: DEMO_CATALOG[table.assetId]!,
        joinedColumns: [...(joinedColsByTable.get(table.id) ?? [])],
        hasError: errorTableIds.has(table.id),
        onToggleColumn: handleToggleColumn,
        onToggleCollapse: handleToggleCollapse,
        onCycleColor: handleCycleColor,
      },
    }));

    if (scene === "data-request") {
      const pin: DemoPinNodeType = {
        id: "demo-comment-pin",
        type: "demo-pin",
        position: { x: 240, y: 245 },
        draggable: true,
        data: {
          anchorLabel: "c.email · Comment pin",
          text: "Keep email masked; we only need paid orders grouped by region.",
        },
      };
      return [...tableNodes, pin];
    }
    return tableNodes;
  }, [spec.tables, joinedColsByTable, errorTableIds, handleToggleColumn, handleToggleCollapse, handleCycleColor, scene]);

  const edges: DemoEdgeType[] = React.useMemo(() => {
    const byId = new Map(spec.tables.map((t) => [t.id, t]));
    return spec.joins.map((join) => {
      const lt = byId.get(join.left.tableId);
      const rt = byId.get(join.right.tableId);
      const leftIsLeft = (lt?.x ?? 0) <= (rt?.x ?? 0);
      return {
        id: join.id,
        type: "demo-relation",
        source: join.left.tableId,
        target: join.right.tableId,
        sourceHandle: colHandleId(leftIsLeft ? "r" : "l", join.left.column),
        targetHandle: colHandleId(leftIsLeft ? "l" : "r", join.right.column),
        data: {
          join,
          onToggleType: handleToggleJoinType,
          onRemove: handleRemoveJoin,
        },
      };
    });
  }, [spec.joins, spec.tables, handleToggleJoinType, handleRemoveJoin]);

  const onNodesChange = React.useCallback((changes: NodeChange<Node>[]) => {
    const moves: Record<string, { x: number; y: number }> = {};
    for (const c of changes) {
      if (c.type === "position" && c.position) {
        moves[c.id] = { x: Math.round(c.position.x), y: Math.round(c.position.y) };
      }
    }
    if (Object.keys(moves).length > 0) {
      setSpec((prev) => ({
        ...prev,
        tables: prev.tables.map((t) => (moves[t.id] ? { ...t, x: moves[t.id]!.x, y: moves[t.id]!.y } : t)),
      }));
    }
  }, []);

  const onConnect = React.useCallback((conn: Connection) => {
    if (!conn.source || !conn.target || conn.source === conn.target) return;
    const lc = parseColHandleId(conn.sourceHandle);
    const rc = parseColHandleId(conn.targetHandle);
    if (!lc || !rc) return;
    setSpec((prev) => ({
      ...prev,
      joins: [
        ...prev.joins,
        {
          id: `j-manual-${Date.now()}`,
          left: { tableId: conn.source!, column: lc },
          right: { tableId: conn.target!, column: rc },
          type: "INNER",
          cardinality: "N-1",
          origin: "manual",
        },
      ],
    }));
  }, []);

  return (
    <div
      className="visual-schema grid overflow-hidden rounded-[4px] border border-border bg-background lg:grid-cols-[minmax(0,1fr)_18.5rem]"
      style={{ height }}
    >
      {/* Left: Interactive React Flow Canvas */}
      <div className="relative h-full min-h-[280px] w-full">
        <ReactFlow
          className={mode === "pan" ? "vs-tool-pan" : "vs-tool-select"}
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          connectionMode={ConnectionMode.Loose}
          panOnDrag={mode === "pan"}
          selectionOnDrag={mode === "select"}
          selectionMode={SelectionMode.Partial}
          snapToGrid
          snapGrid={[20, 20]}
          minZoom={0.25}
          maxZoom={1.75}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          fitView
          fitViewOptions={{ padding: 0.18, maxZoom: 0.95 }}
          proOptions={{ hideAttribution: true }}
        >
          {/* Floating top-right action toolbar */}
          <Panel position="top-right" className="m-2.5">
            <div className="flex items-center gap-0.5 rounded-[6px] border-2 border-border bg-card p-1">
              <button
                type="button"
                onClick={handleFindLinks}
                className="flex h-7 items-center gap-1 rounded-[3px] px-2 font-mono text-[11px] font-semibold text-foreground hover:bg-muted"
                title="Find foreign-key links between placed tables"
              >
                <Sparkles className="size-3.5 text-[var(--accent-ink)]" />
                <span>Find links</span>
              </button>
              <button
                type="button"
                onClick={handleArrange}
                className="flex size-7 items-center justify-center rounded-[3px] text-foreground hover:bg-muted"
                title="Auto-arrange tables"
                aria-label="Auto-arrange tables"
              >
                <LayoutGrid className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setShowGrid((v) => !v)}
                className={cn(
                  "flex size-7 items-center justify-center rounded-[3px] transition-colors",
                  showGrid ? "bg-foreground text-background" : "text-foreground hover:bg-muted",
                )}
                title="Toggle grid"
                aria-label="Toggle grid"
              >
                <Grid3x3 className="size-3.5" />
              </button>
              <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
              <button
                type="button"
                onClick={handleReset}
                className="flex size-7 items-center justify-center rounded-[3px] text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Reset demo"
                aria-label="Reset demo"
              >
                <RotateCcw className="size-3.5" />
              </button>
            </div>
          </Panel>

          {/* Status pill */}
          {statusNote && (
            <Panel position="top-left" className="m-2.5">
              <div className="rounded-[4px] border border-border bg-card px-2.5 py-1 font-mono text-[11px] text-foreground">
                {statusNote}
              </div>
            </Panel>
          )}

          {/* Bottom-left vertical zoom + pan/select + minimap dock */}
          <Panel position="bottom-left" className="m-2.5">
            <div className="flex flex-col items-center gap-0.5 rounded-[6px] border-2 border-border bg-card p-1">
              <button
                type="button"
                onClick={() => void rf.zoomIn({ duration: 150 })}
                className="flex size-7 items-center justify-center rounded-[3px] text-foreground hover:bg-muted"
                title="Zoom in"
                aria-label="Zoom in"
              >
                <Plus className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void rf.zoomOut({ duration: 150 })}
                className="flex size-7 items-center justify-center rounded-[3px] text-foreground hover:bg-muted"
                title="Zoom out (below 45% switches to compact cards)"
                aria-label="Zoom out"
              >
                <Minus className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void rf.fitView({ padding: 0.18, duration: 200 })}
                className="flex size-7 items-center justify-center rounded-[3px] text-foreground hover:bg-muted"
                title="Fit view"
                aria-label="Fit view"
              >
                <Maximize2 className="size-3.5" />
              </button>
              <span className="my-0.5 h-px w-4 bg-border" aria-hidden />
              <button
                type="button"
                onClick={() => setMode("pan")}
                className={cn(
                  "flex size-7 items-center justify-center rounded-[3px]",
                  mode === "pan" ? "bg-foreground text-background" : "text-foreground hover:bg-muted",
                )}
                title="Pan mode"
                aria-label="Pan mode"
              >
                <Hand className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setMode("select")}
                className={cn(
                  "flex size-7 items-center justify-center rounded-[3px]",
                  mode === "select" ? "bg-foreground text-background" : "text-foreground hover:bg-muted",
                )}
                title="Select mode"
                aria-label="Select mode"
              >
                <MousePointer2 className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setShowMinimap((v) => !v)}
                className={cn(
                  "flex size-7 items-center justify-center rounded-[3px]",
                  showMinimap ? "bg-foreground text-background" : "text-foreground hover:bg-muted",
                )}
                title="Toggle minimap"
                aria-label="Toggle minimap"
              >
                <MapIcon className="size-3.5" />
              </button>
              <span className="pt-0.5 font-mono text-[9.5px] tabular-nums text-muted-foreground">
                {Math.round(zoom * 100)}%
              </span>
            </div>
          </Panel>

          {showMinimap && (
            <MiniMap
              pannable
              zoomable
              className="!rounded-[6px] !border-2 !border-border !bg-card"
              nodeColor={(n) => {
                const color = (n.data as { table?: DataRequestTable } | undefined)?.table?.color;
                return color ? SCHEMA_TABLE_COLOR_HEX[color] : "var(--foreground)";
              }}
            />
          )}

          {showGrid && (
            <Background variant={BackgroundVariant.Lines} gap={20} size={1} />
          )}
        </ReactFlow>
      </div>

      {/* Right: Live SQL / DBML Inspector */}
      <aside className="flex h-full min-h-0 flex-col border-t border-border bg-card lg:border-l lg:border-t-0">
        <div className="flex items-center gap-1 border-b border-border/60 px-2.5 py-2">
          <button
            type="button"
            onClick={() => setInspectorTab("sql")}
            className={cn(
              "inline-flex items-center gap-1 rounded-[3px] px-2 py-1 font-mono text-[11px] font-semibold transition-colors",
              inspectorTab === "sql"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Code2 className="size-3" />
            Live SQL
          </button>
          <button
            type="button"
            onClick={() => setInspectorTab("dbml")}
            className={cn(
              "inline-flex items-center gap-1 rounded-[3px] px-2 py-1 font-mono text-[11px] font-semibold transition-colors",
              inspectorTab === "dbml"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <FileCode2 className="size-3" />
            DBML
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-2.5">
          {inspectorTab === "sql" ? (
            <div className="space-y-2.5">
              {generated.diagnostics.length > 0 && (
                <div className="space-y-1">
                  {generated.diagnostics.map((d, i) => (
                    <div
                      key={`${d.code}-${i}`}
                      className="flex items-start gap-1.5 rounded-xs border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive"
                    >
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      <span>{d.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {generated.sql ? (
                <pre className="m-0 overflow-x-auto rounded-xs border border-border/60 bg-background p-2.5 font-mono text-[11px] leading-relaxed text-foreground">
                  <code>{generated.sql}</code>
                </pre>
              ) : (
                <p className="m-0 rounded-xs border border-dashed border-border px-2.5 py-3 text-xs text-muted-foreground">
                  Click <strong>Find links</strong> (top right) or drag between column handles to connect every table and generate valid SQL.
                </p>
              )}

              <div className="rounded-xs border border-[var(--cb-amber)]/50 bg-[var(--cb-amber-soft)]/35 px-2.5 py-2 text-[11px] text-foreground">
                <div className="flex items-start gap-1.5">
                  <Lock className="mt-0.5 size-3.5 shrink-0 text-[var(--cb-amber)]" />
                  <span>
                    <strong>crm_db.public.customers</strong> is locked: you can sketch joins visually and hand off to a <strong>Data Request</strong> without raw table access.
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="m-0 text-[11px] text-muted-foreground">
                Fail-closed DBML export: only columns visible to you are included. Hidden columns never appear.
              </p>
              <pre className="m-0 overflow-x-auto rounded-xs border border-border/60 bg-background p-2.5 font-mono text-[11px] leading-relaxed text-foreground">
                <code>{dbmlText}</code>
              </pre>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

export function VisualSchemaDemoInner({
  scene = "overview",
  height = 460,
}: {
  scene?: VisualSchemaSceneName;
  height?: number;
}) {
  return (
    <ReactFlowProvider>
      <VisualSchemaCanvasInner scene={scene} height={height} />
    </ReactFlowProvider>
  );
}
