"use client";

import { useState } from "react";
import { Check, Copy, Download, PlugZap } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import {
  connectionStrings,
  type DataConnectionEndpointDto,
} from "@/lib/sql-connections";

function CopyLine({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2">
      <code className="min-w-0 flex-1 break-all rounded-[4px] border bg-muted/40 px-2 py-1.5 font-mono text-xs">
        {value}
      </code>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-8 w-8 shrink-0"
        aria-label={t("sqlConnections.copy", { what: label })}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            toast.success(t("sqlConnections.copied", { what: label }));
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function downloadCa(pem: string) {
  const url = URL.createObjectURL(
    new Blob([pem], { type: "application/x-pem-file" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "classifyre-sql-ca.crt";
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * How a tool connects (docs/prd/DQ-data-query.md §5.7): host, port, database
 * and user, then the same as a psql line, a JDBC URL (DBeaver, Tableau,
 * Metabase), an ODBC string (Excel) and an Npgsql string (Power BI). Always
 * TLS with the certificate checked; the CA is offered when it is not a public
 * one.
 */
export function ConnectDetails({
  endpoint,
  username,
  password,
}: {
  endpoint: DataConnectionEndpointDto | null;
  username: string;
  password?: string;
}) {
  const { t } = useTranslation();
  if (!endpoint) return null;
  if (!endpoint.enabled) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("sqlConnections.gatewayOff")}
      </p>
    );
  }
  const strings = connectionStrings(endpoint, username, password);
  const facts: [string, string][] = [
    [t("sqlConnections.host"), endpoint.host ?? ""],
    [t("sqlConnections.port"), String(endpoint.port)],
    [t("sqlConnections.database"), endpoint.database],
    [t("sqlConnections.user"), username],
    [t("sqlConnections.ssl"), endpoint.sslMode],
  ];
  return (
    <div className="space-y-3" data-testid="sql-connect-details">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono text-xs leading-5">{value}</dd>
          </div>
        ))}
      </dl>
      <Tabs defaultValue="psql">
        <TabsList className="flex-wrap">
          <TabsTrigger value="psql">psql</TabsTrigger>
          <TabsTrigger value="jdbc">JDBC</TabsTrigger>
          <TabsTrigger value="odbc">ODBC</TabsTrigger>
          <TabsTrigger value="npgsql">Power BI</TabsTrigger>
          <TabsTrigger value="uri">URI</TabsTrigger>
        </TabsList>
        <TabsContent value="psql" className="space-y-1">
          <CopyLine value={strings.psql} label="psql" />
        </TabsContent>
        <TabsContent value="jdbc" className="space-y-1">
          <CopyLine value={strings.jdbc} label="JDBC" />
          <p className="text-xs text-muted-foreground">
            {t("sqlConnections.jdbcHint")}
          </p>
        </TabsContent>
        <TabsContent value="odbc" className="space-y-1">
          <CopyLine value={strings.odbc} label="ODBC" />
          <p className="text-xs text-muted-foreground">
            {t("sqlConnections.odbcHint")}
          </p>
        </TabsContent>
        <TabsContent value="npgsql" className="space-y-1">
          <CopyLine value={strings.npgsql} label="Npgsql" />
          <p className="text-xs text-muted-foreground">
            {t("sqlConnections.powerBiHint")}
          </p>
        </TabsContent>
        <TabsContent value="uri" className="space-y-1">
          <CopyLine value={strings.uri} label="URI" />
        </TabsContent>
      </Tabs>
      {endpoint.caCertificate && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => downloadCa(endpoint.caCertificate!)}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {t("sqlConnections.downloadCa")}
          </Button>
          <span>{t("sqlConnections.caHint")}</span>
        </div>
      )}
    </div>
  );
}

export function ConnectIcon({ className }: { className?: string }) {
  return <PlugZap className={className} aria-hidden />;
}
