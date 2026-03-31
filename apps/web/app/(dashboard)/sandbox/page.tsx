"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components";
import { SandboxRunsTable } from "@/components/sandbox-runs-table";
import { useTranslation } from "@/hooks/use-translation";

export default function SandboxPage() {
  const { t } = useTranslation();
  const [isPolling, setIsPolling] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              {t("sandbox.title")}
            </h1>
            <Badge
              variant={isPolling ? "default" : "outline"}
              className="text-[10px] uppercase tracking-[0.12em]"
            >
              {isPolling ? t("sandbox.livePolling") : t("sandbox.idle")}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("sandbox.monitorDesc")}
          </p>
        </div>

        <Button asChild className="w-full sm:w-auto">
          <Link href="/sandbox/new">
            <Plus className="mr-2 h-4 w-4" />
            {t("sandbox.newScan")}
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("sandbox.runResults")}</CardTitle>
          <CardDescription>{t("sandbox.autoRefresh")}</CardDescription>
        </CardHeader>
        <CardContent className="p-5">
          <SandboxRunsTable onPollingChange={setIsPolling} />
        </CardContent>
      </Card>
    </div>
  );
}
