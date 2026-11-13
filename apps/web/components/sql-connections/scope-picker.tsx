"use client";

import {
  Badge,
  MultiSelect,
  MultiSelectContent,
  MultiSelectGroup,
  MultiSelectItem,
  MultiSelectTrigger,
  MultiSelectValue,
  Spinner,
} from "@workspace/ui/components";
import { Database, Table2 } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";
import type { DataConnectionReachableSourceDto } from "@/lib/sql-connections";

/**
 * What a SQL connection is for (DQ §5.7), picked like *Give access* picks a
 * table or a source: a whole source (when the source is open to SQL
 * connections) or single tables, from what you may query and is open.
 * Values are `source:<id>` / `asset:<id>`; none means everything, offered
 * only to admins, owners, stewards and custodians.
 */
export function ScopePicker({
  sources,
  value,
  onChange,
}: {
  sources: DataConnectionReachableSourceDto[] | null;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const { t } = useTranslation();
  if (!sources) {
    return (
      <div className="flex h-9 items-center">
        <Spinner />
      </div>
    );
  }
  if (sources.length === 0) {
    return (
      <p className="rounded-[4px] border border-dashed px-3 py-2 text-xs text-muted-foreground">
        {t("sqlConnections.nothingOpen")}
      </p>
    );
  }
  return (
    <MultiSelect values={value} onValuesChange={onChange}>
      <MultiSelectTrigger className="w-full rounded-[4px] border-2 border-border">
        <MultiSelectValue placeholder={t("sqlConnections.scopePlaceholder")} />
      </MultiSelectTrigger>
      <MultiSelectContent
        search={{
          placeholder: t("sqlConnections.scopeSearch"),
          emptyMessage: t("sqlConnections.scopeEmpty"),
        }}
      >
        {sources.map((source) => (
          <MultiSelectGroup key={source.id} heading={source.name}>
            {source.open && (
              <MultiSelectItem
                value={`source:${source.id}`}
                badgeLabel={source.sqlName}
                keywords={[source.name, source.sqlName]}
              >
                <Database className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                {t("sqlConnections.wholeSource", { name: source.name })}
                <Badge variant="outline" className="ml-auto font-normal">
                  {source.tables.length}
                </Badge>
              </MultiSelectItem>
            )}
            {source.tables.map((table) => (
              <MultiSelectItem
                key={table.id}
                value={`asset:${table.id}`}
                badgeLabel={table.sqlName}
                keywords={[table.name, table.sqlName]}
              >
                <Table2 className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-mono text-xs">{table.sqlName}</span>
              </MultiSelectItem>
            ))}
          </MultiSelectGroup>
        ))}
      </MultiSelectContent>
    </MultiSelect>
  );
}
