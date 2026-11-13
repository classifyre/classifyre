"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { useNamespace } from "@/components/namespace-provider";
import type { DataScope } from "@/components/data-query/data-access";
import {
  useDataConnections,
  useReachable,
  useSqlEndpoint,
  type DataConnectionDto,
  type DataConnectionSecretDto,
} from "@/lib/sql-connections";
import { ConnectDetails, ConnectIcon } from "./connect-details";
import {
  ConnectionSecretDialog,
  CreateConnectionDialog,
} from "./connections-panel";

/** Whether an active connection reaches this table or source (by its own scope). */
function covers(connection: DataConnectionDto, scope?: DataScope): boolean {
  if (connection.status !== "active") return false;
  if (!scope || connection.scope.length === 0) return true;
  return connection.scope.some((item) =>
    scope.kind === "asset"
      ? (item.type === "asset" && item.id === scope.assetId) ||
        (item.type === "source" && item.id === scope.sourceId)
      : item.type === "source" && item.id === scope.sourceId,
  );
}

/**
 * "Connect a tool" next to the SQL editor (DQ §5.7): how to reach these
 * tables from a BI tool with one of your SQL connections. On a table's or
 * source's Data tab it says whether that is open to SQL connections, lists
 * your connections that reach it, and makes a new one for it.
 */
export function ConnectToolButton({ scope }: { scope?: DataScope }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<DataConnectionSecretDto | null>(null);
  const endpoint = useSqlEndpoint();
  const mine = useDataConnections(open ? { kind: "mine" } : null);
  const reachable = useReachable(open);
  const { nsHref } = useNamespace();
  const usable = (mine.data?.items ?? []).filter((c) => covers(c, scope));
  const [chosen, setChosen] = useState<string | null>(null);
  const current = usable.find((c) => c.id === chosen) ?? usable[0];
  if (endpoint && !endpoint.enabled) return null;

  const reachableHere =
    !scope || !reachable
      ? true
      : reachable.some((source) =>
          scope.kind === "source"
            ? source.id === scope.sourceId
            : source.tables.some((table) => table.id === scope.assetId),
        );
  const governanceHref =
    scope?.kind === "asset"
      ? nsHref(`/assets/${scope.assetId}?tab=governance`)
      : scope?.kind === "source"
        ? nsHref(`/sources/${scope.sourceId}?tab=governance`)
        : null;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        data-testid="connect-tool"
      >
        <ConnectIcon className="mr-1.5 h-4 w-4" />
        {t("sqlConnections.connectTool")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl" data-testid="connect-tool-dialog">
          <DialogHeader>
            <DialogTitle>
              {scope
                ? t("sqlConnections.connectToolFor", { name: scope.name })
                : t("sqlConnections.connectTool")}
            </DialogTitle>
            <DialogDescription>{t("sqlConnections.connectIntro")}</DialogDescription>
          </DialogHeader>
          {!reachableHere ? (
            <p className="rounded-[4px] border border-dashed px-3 py-3 text-sm text-muted-foreground">
              {t("sqlConnections.notOpenHere")}{" "}
              {governanceHref && (
                <Link href={governanceHref} className="font-medium underline underline-offset-4">
                  {t("sqlConnections.openOnGovernance")}
                </Link>
              )}
            </p>
          ) : usable.length > 0 && current ? (
            <div className="space-y-3">
              {usable.length > 1 && (
                <Select value={current.id} onValueChange={setChosen}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {usable.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} · {c.username}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <ConnectDetails endpoint={endpoint} username={current.username} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {scope
                ? t("sqlConnections.noConnectionHere")
                : t("sqlConnections.noConnectionYet")}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href={nsHref("/settings?tab=sql-connections")}
              className="text-sm font-medium underline underline-offset-4"
            >
              {t("sqlConnections.manage")}
            </Link>
            {reachableHere && mine.data?.canCreate && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                {scope
                  ? t("sqlConnections.createFor", { name: scope.name })
                  : t("sqlConnections.create")}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <CreateConnectionDialog
        open={creating}
        onOpenChange={setCreating}
        canConnectAll={Boolean(mine.data?.canConnectAll)}
        initialScope={
          scope
            ? [scope.kind === "asset" ? `asset:${scope.assetId}` : `source:${scope.sourceId}`]
            : []
        }
        onCreated={(created) => {
          setSecret(created);
          void mine.reload();
        }}
      />
      <ConnectionSecretDialog secret={secret} onClose={() => setSecret(null)} />
    </>
  );
}
