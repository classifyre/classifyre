import type * as React from "react";
import type { Edge, Node, NodeTypes } from "@xyflow/react";
import {
  SCHEMA_TABLE_COLOR_HEX,
  SCHEMA_TABLE_COLORS,
  type DataRequestCardinality,
  type DataRequestFilter,
  type DataRequestJoin,
  type DataRequestJoinEndpoint,
  type DataRequestJoinOrigin,
  type DataRequestJoinType,
  type DataRequestSpec,
  type DataRequestTable,
  type RequestSqlDiagnostic,
  type SchemaTableColor,
} from "@workspace/schemas/data-request";
import type { QueryCatalog, QueryCatalogTable } from "@/lib/data-query";

export const SCHEMA_DRAG_MIME = "application/x-classifyre-schema-tables";
export const LEGACY_REQUEST_TABLE_DRAG_MIME =
  "application/x-classifyre-request-table";

export const VISUAL_SCHEMA_GRID_SNAP = 20;
export const SCHEMA_TABLE_WIDTH = 268;
export const LOD_ZOOM_THRESHOLD = 0.45;

export type CanvasInteractionMode = "pan" | "select";

export interface VisualSchemaCapabilities {
  canEdit: boolean;
  showColumnSelection: boolean;
  showFilters: boolean;
  showComments: boolean;
  /** Maximum tables allowed on the canvas, or null for unlimited. */
  maxTables: number | null;
  /** Hide `shared.*` datasets in the catalog rail (true in Data Requests). */
  hideSharedDatasets?: boolean;
  /** Allow placing non-queryable or locked tables for schema inspection. */
  allowLockedTables?: boolean;
}

export interface VisualSchemaRightTab {
  value: string;
  label: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  testId?: string;
  content: React.ReactNode;
}

export interface JoinPatch {
  type?: DataRequestJoinType;
  cardinality?: DataRequestCardinality;
  constraintName?: string;
  origin?: DataRequestJoinOrigin;
}

export interface VisualSchemaAdapter {
  capabilities: VisualSchemaCapabilities;
  spec: DataRequestSpec;
  catalog: QueryCatalog | null;
  catalogLoading?: boolean;
  diagnostics: RequestSqlDiagnostic[];
  saving?: boolean;
  dirty?: boolean;
  canUndo: boolean;
  canRedo: boolean;

  addTables: (
    tables: QueryCatalogTable[],
    positions?: Array<{ x: number; y: number }>,
  ) => DataRequestTable[];
  removeTables: (tableIds: string[]) => void;
  moveTables: (updates: Record<string, { x: number; y: number }>) => void;
  resizeTable: (tableId: string, height: number) => void;
  setTableColor: (
    tableIds: string[],
    color: SchemaTableColor | undefined,
  ) => void;
  toggleTableCollapsed: (tableId: string) => void;
  setTablesCollapsed: (tableIds: string[], collapsed: boolean) => void;
  setTablesHidden: (tableIds: string[], hidden: boolean) => void;
  renameAlias: (tableId: string, alias: string) => boolean;
  toggleColumn: (tableId: string, column: string) => void;
  setTableColumns: (tableId: string, columns: string[]) => void;
  setTablesColumns: (updates: Record<string, string[]>) => void;
  addFilter: (tableId: string, filter: DataRequestFilter) => void;
  removeFilter: (tableId: string, indexOrId: number | string) => void;
  addJoin: (
    left: DataRequestJoinEndpoint,
    right: DataRequestJoinEndpoint,
    options?: JoinPatch,
  ) => DataRequestJoin | null;
  addJoins?: (
    joins: Array<{
      left: DataRequestJoinEndpoint;
      right: DataRequestJoinEndpoint;
      options?: JoinPatch;
    }>,
  ) => DataRequestJoin[];
  updateJoin: (joinId: string, patch: JoinPatch) => void;
  removeJoin: (joinId: string) => void;
  removeTableJoins: (tableIds: string[]) => void;
  applyLayout: (positions: Record<string, { x: number; y: number }>) => void;
  clearCanvas: () => void;
  importSpec: (spec: DataRequestSpec) => DataRequestSpec | null | void;
  undo: () => void;
  redo: () => void;
  onRefreshCatalog?: () => void;
}

export interface SchemaTableNodeData extends Record<string, unknown> {
  table: DataRequestTable;
  catalogTable: QueryCatalogTable | null;
  joinedColumns: string[];
  fkColumns: string[];
  canEdit: boolean;
  showColumnSelection: boolean;
  showFilters: boolean;
  showComments: boolean;
  hasError: boolean;
  isHiddenRevealed: boolean;
  selectedTableIds: string[];
}

export type SchemaTableFlowNode = Node<SchemaTableNodeData, "schema-table">;

export interface SchemaRelationEdgeData extends Record<string, unknown> {
  join: DataRequestJoin;
  canEdit: boolean;
  incidentToSelected: boolean;
  onToggleJoinType: (joinId: string) => void;
  onRemoveJoin: (joinId: string) => void;
}

export type SchemaRelationFlowEdge = Edge<
  SchemaRelationEdgeData,
  "schema-relation"
>;

export interface VisualSchemaExtensions {
  extraNodes?: Node[];
  extraNodeTypes?: NodeTypes;
  topLeftSlot?: React.ReactNode;
  rightTabs?: VisualSchemaRightTab[];
  defaultRightTab?: string;
  onInspectTableData?: (table: QueryCatalogTable) => void;
  onPinComment?: (
    anchor: { tableId: string; column?: string },
    screen: { x: number; y: number },
  ) => void;
  onPaneClick?: (event: React.MouseEvent, flowPos: { x: number; y: number }) => void;
  onEscape?: () => void;
  paneClassName?: string;
  canvasTestId?: string;
  railTestId?: string;
}

export function colHandleId(side: "l" | "r", column: string): string {
  return `col:${side}:${column}`;
}

export function parseColHandleId(
  handleId: string | null | undefined,
): string | null {
  if (!handleId || !handleId.startsWith("col:")) return null;
  const parts = handleId.split(":");
  return parts.length >= 3 ? parts.slice(2).join(":") : null;
}

export function snapSchemaCoord(value: number): number {
  return Math.round(value / VISUAL_SCHEMA_GRID_SNAP) * VISUAL_SCHEMA_GRID_SNAP;
}

export function formatRowCount(count: number | undefined): string | null {
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
    return null;
  }
  if (count >= 1_000_000) {
    return `~${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (count >= 1_000) {
    return `~${(count / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `~${count}`;
}

export const SWATCH_CSS_VAR: Readonly<Record<SchemaTableColor, string>> = {
  gray: "var(--cb-gray)",
  green: "var(--cb-green)",
  amber: "var(--cb-amber)",
  blue: "var(--cb-blue)",
  violet: "var(--cb-violet)",
  pink: "var(--cb-pink)",
  yellow: "var(--cb-yellow)",
  red: "var(--cb-red)",
};

export const SWATCH_SOFT_CSS_VAR: Readonly<Record<SchemaTableColor, string>> = {
  gray: "var(--cb-gray-soft)",
  green: "var(--cb-green-soft)",
  amber: "var(--cb-amber-soft)",
  blue: "var(--cb-blue-soft)",
  violet: "var(--cb-violet-soft)",
  pink: "var(--cb-pink-soft)",
  yellow: "var(--cb-yellow-soft)",
  red: "var(--cb-red-soft)",
};

export function swatchCssColor(color?: SchemaTableColor): string {
  return color ? SWATCH_CSS_VAR[color] : "var(--foreground)";
}

export function swatchMinimapHex(color?: SchemaTableColor): string {
  return color ? SCHEMA_TABLE_COLOR_HEX[color] : "var(--foreground)";
}

export { SCHEMA_TABLE_COLORS };
