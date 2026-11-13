"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { useDataConnections } from "@/lib/sql-connections";
import { ConnectIcon } from "./connect-details";
import { ConnectionsPanel } from "./connections-panel";

/** Settings → SQL connections: your own, and everyone's for managers. */
export function SqlConnectionsCard() {
  const { t } = useTranslation();
  const mine = useDataConnections({ kind: "mine" });
  const [view, setView] = useState<"mine" | "all">("mine");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ConnectIcon className="h-5 w-5" />
          {t("sqlConnections.title")}
        </CardTitle>
        <CardDescription>{t("sqlConnections.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {mine.data?.canManage && (
          <Tabs value={view} onValueChange={(v) => setView(v as "mine" | "all")}>
            <TabsList>
              <TabsTrigger value="mine">{t("sqlConnections.viewMine")}</TabsTrigger>
              <TabsTrigger value="all">{t("sqlConnections.viewAll")}</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        <ConnectionsPanel key={view} scope={{ kind: view }} />
      </CardContent>
    </Card>
  );
}
