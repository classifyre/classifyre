"use client";

import { useTranslation } from "@/hooks/use-translation";
import {
  previewSql,
  type QueryCatalog,
  type QueryCatalogTable,
} from "@/lib/data-query";
import { DataNotice, DataTab } from "./data-tab";

/**
 * A table's rows, queried in place: the editor starts with this table, the
 * result shows below, and who may query it (and who did) is right under it.
 * Access given here is always on this table; the whole source is given on
 * the source's own Data tab.
 */
export function AssetDataTab({
  catalog,
  table,
}: {
  catalog: QueryCatalog;
  table: QueryCatalogTable;
}) {
  const { t } = useTranslation();

  if (!table.queryable) {
    return (
      <DataNotice title={t("dataQuery.notQueryable")}>
        {table.reason ?? t("dataQuery.notQueryable")}
      </DataNotice>
    );
  }
  if (!table.canQuery) {
    return (
      <DataNotice title={t("dataQuery.assetLockedTitle")} locked>
        {t("dataQuery.assetLocked")}
      </DataNotice>
    );
  }
  return (
    <DataTab
      testId="asset-data-tab"
      scope={{
        kind: "asset",
        assetId: table.assetId,
        sourceId: table.sourceId,
        name: table.name,
      }}
      catalog={catalog}
      sqlName={table.sqlName}
      initialSql={previewSql(table.sqlName)}
      editorPath={`query://asset/${table.assetId}.sql`}
    />
  );
}
