"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLink, Lock } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { useTranslation } from "@/hooks/use-translation";
import { useNamespace } from "@/components/namespace-provider";
import { useCan } from "@/hooks/use-me";
import type { QueryCatalog, QueryCatalogTable } from "@/lib/data-query";
import { QueryWorkbench } from "./query-workbench";
import {
  GiveTableAccessDialog,
  useTableAccessGrants,
} from "./data-access-dialog";
import { TableAccessTabs } from "./table-access-tabs";
import { apiErrorMessage } from "@/lib/data-query";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import { api } from "@workspace/api-client";
import { toast } from "sonner";

/**
 * An asset's rows, queried in place: the editor starts with this table and
 * the result shows below. Who may query it is managed here too, by people
 * who manage access.
 */
export function AssetDataTab({
  catalog,
  table,
  sourceName,
}: {
  catalog: QueryCatalog;
  table: QueryCatalogTable;
  /** Display name of the table's source, for the access dialog. */
  sourceName?: string;
}) {
  const { t } = useTranslation();
  const { nsHref, namespace } = useNamespace();
  const canManage = useCan("access.manage");
  const sql = `SELECT *\nFROM ${table.sqlName}\nLIMIT 100`;
  const access = useTableAccessGrants(
    namespace?.id ?? "",
    table.assetId,
    table.sourceId,
  );

  React.useEffect(() => {
    if (canManage && namespace?.id) void access.reload();
  }, [canManage, namespace?.id, access.reload]);

  const remove = async (grant: { id: string; subjectLabel: string }) => {
    try {
      await api.access.workspaceAccessControllerRemoveGrant({ id: grant.id });
      toast.success(t("access.removed", { subject: grant.subjectLabel }));
      await access.reload();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.removeFailed")));
    }
  };

  const showOverview = canManage && (access.grants ?? []).length > 0;

  return (
    <div className="space-y-4" data-testid="asset-data-tab">
      {!table.queryable ? (
        <Notice title={t("dataQuery.notQueryable")}>
          {table.reason ?? t("dataQuery.notQueryable")}
        </Notice>
      ) : !table.canQuery ? (
        <Notice title={t("dataQuery.assetLockedTitle")} locked>
          {t("dataQuery.assetLocked")}
        </Notice>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {table.sqlName}
            </code>
            <div className="ml-auto flex flex-wrap items-center gap-1">
              {canManage && namespace?.id && (
                <GiveTableAccessDialog
                  access={access}
                  assetId={table.assetId}
                  sourceId={table.sourceId}
                  sourceName={sourceName ?? table.sourceId}
                  tableName={table.name}
                  onChanged={() => void access.reload()}
                />
              )}
              <Button asChild size="sm" variant="ghost">
                <Link
                  href={`${nsHref("/query")}?sql=${encodeURIComponent(sql)}`}
                  title={t("dataQuery.openInQueryHint")}
                >
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  {t("dataQuery.openInQuery")}
                </Link>
              </Button>
            </div>
          </div>
          <QueryWorkbench
            catalog={catalog}
            initialSql={sql}
            editorPath={`query://asset/${table.assetId}.sql`}
            editorHeight={140}
            resultHeight={380}
          />
          {showOverview && (
            <TableAccessTabs
              access={access}
              assetId={table.assetId}
              onRemove={(grant) => void remove(grant)}
            />
          )}
        </>
      )}
    </div>
  );
}

function Notice({
  title,
  children,
  locked = false,
}: {
  title: string;
  children: React.ReactNode;
  locked?: boolean;
}) {
  return (
    <div className="rounded-md border border-dashed p-6 text-sm">
      <div className="mb-1 flex items-center gap-2 font-medium">
        {locked && <Lock className="h-4 w-4" />}
        {title}
      </div>
      <p className="text-muted-foreground">{children}</p>
    </div>
  );
}
