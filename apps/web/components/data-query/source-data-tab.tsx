"use client";

import * as React from "react";
import { useTranslation } from "@/hooks/use-translation";
import {
  catalogOfSource,
  previewSql,
  type QueryCatalog,
} from "@/lib/data-query";
import { DataNotice, DataTab } from "./data-tab";

/**
 * A source's tables, queried in place: the same layout as a table's Data
 * tab, with this source's tables beside the editor to pick from. Access
 * given here opens every table of the source; Activity shows reads of any
 * of them and access given on the source or one of its tables.
 */
export function SourceDataTab({
  catalog,
  sourceId,
  sourceName,
}: {
  catalog: QueryCatalog;
  sourceId: string;
  sourceName: string;
}) {
  const { t } = useTranslation();
  // Only this source, for the explorer and the editor's completions alike.
  const own = React.useMemo(
    () => catalogOfSource(catalog, sourceId),
    [catalog, sourceId],
  );
  const source = own.sources[0];
  const queryable = (source?.tables ?? []).filter((table) => table.canQuery);

  if (!source || !source.tables.some((table) => table.queryable)) {
    return (
      <DataNotice title={t("dataQuery.notQueryable")}>
        {source?.tables[0]?.reason ?? t("dataQuery.noTables")}
      </DataNotice>
    );
  }
  if (!queryable.length) {
    return (
      <DataNotice title={t("dataQuery.assetLockedTitle")} locked>
        {t("dataQuery.sourceLocked", { name: sourceName })}
      </DataNotice>
    );
  }
  return (
    <DataTab
      testId="source-data-tab"
      scope={{ kind: "source", sourceId, name: sourceName }}
      catalog={own}
      sqlName={source.sqlName}
      summary={t("dataQuery.sourceTables", {
        count: queryable.length,
        total: source.tables.length,
      })}
      initialSql={previewSql(queryable[0]!.sqlName)}
      editorPath={`query://source/${sourceId}.sql`}
      explorer
    />
  );
}
