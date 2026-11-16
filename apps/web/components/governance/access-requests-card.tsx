"use client";

import { KeyRound } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { useTranslation } from "@/hooks/use-translation";
import {
  AccessRequestsList,
  type RequestsFilter,
} from "@/components/access-requests/access-requests-list";

/**
 * Who asked to query this table or source, or every request waiting for you
 * (DQ §5.9): its owner decides, else a steward, or an access manager.
 */
export function AccessRequestsCard({
  filter,
  showTarget = false,
  lead,
}: {
  filter: RequestsFilter;
  showTarget?: boolean;
  lead?: string;
}) {
  const { t } = useTranslation();
  return (
    <Card data-testid="governance-access-requests">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4" />
          {t("accessRequests.listTitle")}
        </CardTitle>
        <CardDescription>
          {lead ?? t("accessRequests.listLead")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AccessRequestsList filter={filter} showTarget={showTarget} />
      </CardContent>
    </Card>
  );
}
