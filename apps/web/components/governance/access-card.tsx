"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { ConnectionsPanel } from "@/components/sql-connections/connections-panel";
import { ConnectIcon } from "@/components/sql-connections/connect-details";

/**
 * Who reaches this table or source from outside the app (DQ §5.7, GOV R5):
 * the SQL connections that read it, name it or are closed on it, with when
 * and how often — and, for its owner and stewards, giving a connection and
 * closing it here. Grants (who may read at all) sit on the Data tab.
 */
export function AccessCard({
  target,
}: {
  target: { type: "asset" | "source"; id: string; name: string };
}) {
  const { t } = useTranslation();
  return (
    <Card data-testid="governance-access">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <ConnectIcon className="h-4 w-4" />
          {t("sqlConnections.governanceTitle")}
        </CardTitle>
        <CardDescription>{t("sqlConnections.governanceLead")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ConnectionsPanel
          scope={{ kind: target.type, id: target.id }}
          target={target}
        />
      </CardContent>
    </Card>
  );
}
