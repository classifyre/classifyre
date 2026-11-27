"use client";

import * as React from "react";
import type {
  DataRequestFilter,
  SchemaTableColor,
} from "@workspace/schemas/data-request";
import type { QueryCatalogTable } from "@/lib/data-query";

export interface SchemaTableActions {
  onToggleCollapsed: (tableId: string) => void;
  onSetTablesCollapsed: (tableIds: string[], collapsed: boolean) => void;
  onToggleColumn: (tableId: string, column: string) => void;
  onSetTableColumns: (tableId: string, columns: string[]) => void;
  onSetTablesAllColumns: (tableIds: string[], selectAll: boolean) => void;
  onAddFilter: (tableId: string, filter: DataRequestFilter) => void;
  onRemoveFilter: (tableId: string, indexOrId: number | string) => void;
  onResizeTable: (tableId: string, height: number) => void;
  onSetColor: (tableIds: string[], color: SchemaTableColor | undefined) => void;
  onFindLinks: (tableIds: string[]) => void;
  onRemoveLinks: (tableIds: string[]) => void;
  onSetHidden: (tableIds: string[], hidden: boolean) => void;
  onRemoveTables: (tableIds: string[]) => void;
  onInspectTableData?: (table: QueryCatalogTable) => void;
  onPinComment?: (
    anchor: { tableId: string; column?: string },
    screen: { x: number; y: number },
  ) => void;
}

const SchemaTableActionsContext =
  React.createContext<SchemaTableActions | null>(null);

export const SchemaTableActionsProvider = SchemaTableActionsContext.Provider;

export function useSchemaTableActions(): SchemaTableActions {
  const ctx = React.useContext(SchemaTableActionsContext);
  if (!ctx) {
    throw new Error(
      "useSchemaTableActions must be used inside SchemaTableActionsProvider",
    );
  }
  return ctx;
}
