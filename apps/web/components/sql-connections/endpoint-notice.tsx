"use client";

import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import {
  endpointState,
  SQL_SETUP_DOCS_HREF,
  type DataConnectionEndpointDto,
} from "@/lib/sql-connections";

function GuideLink() {
  const { t } = useTranslation();
  return (
    <a
      href={SQL_SETUP_DOCS_HREF}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium underline underline-offset-4"
      data-testid="sql-setup-guide"
    >
      {t("sqlConnections.setupGuide")}
    </a>
  );
}

/**
 * Says what is missing before SQL connections work, wherever a connection is
 * shown or made: the gateway is switched off in this deployment, or it runs
 * but has no public address (host, and the port exposed). Renders nothing
 * while the endpoint loads and once it is ready. `compact` is one line, for
 * tabs that only mention connections in passing.
 */
export function SqlEndpointNotice({
  endpoint,
  compact = false,
  className,
}: {
  endpoint: DataConnectionEndpointDto | null;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const state = endpointState(endpoint);
  if (state !== "off" && state !== "unconfigured") return null;
  const off = state === "off";

  if (compact) {
    return (
      <p
        className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-[4px] border border-amber-500/40 bg-amber-50/50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300 ${className ?? ""}`}
        data-testid="sql-endpoint-notice"
        data-state={state}
      >
        <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          {off
            ? t("sqlConnections.gatewayOffShort")
            : t("sqlConnections.setupNeededShort")}
        </span>
        <GuideLink />
      </p>
    );
  }

  return (
    <Alert
      className={`border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20 ${className ?? ""}`}
      data-testid="sql-endpoint-notice"
      data-state={state}
    >
      <TriangleAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      <AlertTitle className="text-amber-800 dark:text-amber-300">
        {off
          ? t("sqlConnections.gatewayOffTitle")
          : t("sqlConnections.setupNeededTitle")}
      </AlertTitle>
      <AlertDescription className="space-y-2 text-amber-700 dark:text-amber-400">
        <p>
          {off
            ? t("sqlConnections.gatewayOff")
            : t("sqlConnections.setupNeededBody")}
        </p>
        <ul className="list-disc space-y-0.5 pl-4">
          {off ? (
            <>
              <li>
                {t("sqlConnections.setupHelm")}:{" "}
                <code className="font-mono text-xs">
                  sqlGateway.enabled: true
                </code>
              </li>
              <li>
                {t("sqlConnections.setupDocker")}:{" "}
                <code className="font-mono text-xs">
                  SQL_GATEWAY_ENABLED=true
                </code>
              </li>
            </>
          ) : (
            <>
              <li>
                {t("sqlConnections.setupHelm")}:{" "}
                <code className="font-mono text-xs">sqlGateway.publicHost</code>
                {", "}
                <code className="font-mono text-xs">
                  sqlGateway.service
                </code> /{" "}
                <code className="font-mono text-xs">sqlGateway.traefik</code>
              </li>
              <li>
                {t("sqlConnections.setupDocker")}:{" "}
                <code className="font-mono text-xs">
                  SQL_GATEWAY_PUBLIC_HOST
                </code>
                {", "}
                <code className="font-mono text-xs">-p 5433:5433</code>
              </li>
            </>
          )}
        </ul>
        <p>
          <GuideLink />
        </p>
      </AlertDescription>
    </Alert>
  );
}
