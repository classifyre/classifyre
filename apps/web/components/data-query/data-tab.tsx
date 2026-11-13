"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLink, Lock } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { ConnectToolButton } from "@/components/sql-connections/connect-tool-button";
import { useNamespace } from "@/components/namespace-provider";
import { useCan } from "@/hooks/use-me";
import { useTranslation } from "@/hooks/use-translation";
import { previewSql, type QueryCatalog } from "@/lib/data-query";
import {
  DataAccessSection,
  GiveDataAccessButton,
  useDataAccessGrants,
  type DataScope,
} from "./data-access";
import { QueryExplorer } from "./query-explorer";
import { QueryWorkbench, type QueryWorkbenchHandle } from "./query-workbench";

/**
 * The one layout of a Data tab, on a table and on a source: the SQL name and
 * what it holds, then Give access and Open in SQL; the editor and its result
 * (with the source's tables beside it, for a source); then Access and
 * Activity for exactly this scope.
 */
export function DataTab({
  scope,
  catalog,
  sqlName,
  summary,
  initialSql,
  editorPath,
  explorer = false,
  testId,
}: {
  scope: DataScope;
  /** What the editor completes and the explorer lists: just this scope. */
  catalog: QueryCatalog;
  sqlName: string;
  summary?: React.ReactNode;
  initialSql: string;
  editorPath: string;
  /** Lists the scope's tables beside the editor (a source's tab). */
  explorer?: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  const { nsHref } = useNamespace();
  const canManage = useCan("access.manage");
  const access = useDataAccessGrants(scope);
  const workbench = React.useRef<QueryWorkbenchHandle>(null);
  const [sql, setSql] = React.useState(initialSql);

  const editor = (
    <QueryWorkbench
      ref={workbench}
      catalog={catalog}
      initialSql={initialSql}
      editorPath={editorPath}
      editorHeight={explorer ? 200 : 140}
      resultHeight={380}
      onRunFinished={(run) => setSql(run.sql)}
    />
  );

  return (
    <div className="space-y-4" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{sqlName}</code>
        {summary && (
          <span className="text-xs text-muted-foreground">{summary}</span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {canManage && <GiveDataAccessButton scope={scope} access={access} />}
          <ConnectToolButton />
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

      {explorer ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0">{editor}</div>
          <aside
            className="min-w-0 lg:max-h-[640px] lg:border-l lg:pl-3"
            aria-label={t("dataQuery.explorer.tables")}
          >
            <QueryExplorer
              catalog={catalog}
              tablesOnly
              onInsert={(text) => workbench.current?.insert(text)}
              onRunTable={(name) => {
                const next = previewSql(name);
                setSql(next);
                workbench.current?.setSql(next);
              }}
            />
          </aside>
        </div>
      ) : (
        editor
      )}

      <DataAccessSection scope={scope} access={access} />
    </div>
  );
}

/** Why a Data tab shows no editor: not queryable, or no access to the rows. */
export function DataNotice({
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
