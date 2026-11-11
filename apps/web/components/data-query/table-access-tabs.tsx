"use client";

import * as React from "react";
import { useTranslation } from "@/hooks/use-translation";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { AuditEventList } from "@/components/audit-history";
import { TableAccessOverview } from "./data-access-dialog";
import type { TableAccessGrants } from "./data-access-dialog";
import type { GrantDto } from "@workspace/api-client";

/**
 * "Who can query this table", as tabs: **Access** (the grants that reach
 * this table, like settings → Access) and **Activity** (everything the trail
 * recorded touching it — given/removed access, queries and exports that
 * read it). Rendered below the query when access rules exist.
 *
 * Server search cannot do "this row OR that row", so the trail is searched
 * for the one string every row of this asset carries — the asset id — which
 * matches per-table reads/exports (`asset/<id>`), grants on the table and
 * its source (`<ws>/<id>` scope ids), and query runs naming it.
 */
export function TableAccessTabs({
  access,
  assetId,
  onRemove,
}: {
  access: TableAccessGrants;
  assetId: string;
  onRemove: (grant: GrantDto) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = React.useState("access");

  return (
    <div data-testid="data-access-overview">
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="h-8 w-fit shrink-0 p-0.5">
          <TabsTrigger value="access" className="h-7 gap-1.5 px-2 text-xs">
            {t("dataQuery.access.title")}
          </TabsTrigger>
          <TabsTrigger value="activity" className="h-7 gap-1.5 px-2 text-xs">
            {t("dataQuery.access.activity")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="access" className="mt-2">
          <TableAccessOverview access={access} onRemove={onRemove} />
        </TabsContent>
        <TabsContent value="activity" className="mt-2">
          <p className="mb-2 text-xs text-muted-foreground">
            {t("dataQuery.access.activityHint")}
          </p>
          <AuditEventList filter={{ search: assetId }} showEntity={false} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
