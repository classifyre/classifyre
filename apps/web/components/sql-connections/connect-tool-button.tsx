"use client";

import { useState } from "react";
import Link from "next/link";
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
import { useDataConnections, useSqlEndpoint } from "@/lib/sql-connections";
import { ConnectDetails, ConnectIcon } from "./connect-details";

/**
 * "Connect a tool" next to the SQL editor: how to reach these same tables
 * from a BI tool or driver with one of your SQL connections (DQ §5.7).
 */
export function ConnectToolButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const endpoint = useSqlEndpoint();
  const { data } = useDataConnections(open ? { kind: "mine" } : null);
  const { nsHref: href } = useNamespace();
  const usable = (data?.items ?? []).filter((c) => c.status === "active");
  const [chosen, setChosen] = useState<string | null>(null);
  const current = usable.find((c) => c.id === chosen) ?? usable[0];
  if (endpoint && !endpoint.enabled) return null;
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("sqlConnections.connectTool")}</DialogTitle>
            <DialogDescription>{t("sqlConnections.connectIntro")}</DialogDescription>
          </DialogHeader>
          {usable.length > 0 && current ? (
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
              {t("sqlConnections.noConnectionYet")}
            </p>
          )}
          <Link
            href={href("/settings?tab=sql-connections")}
            className="text-sm font-medium underline underline-offset-4"
          >
            {t("sqlConnections.manage")}
          </Link>
        </DialogContent>
      </Dialog>
    </>
  );
}
