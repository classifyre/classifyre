import * as React from "react";
import { NamespaceProvider } from "@/components/namespace-provider";
import { ConnectToolButton } from "@/components/sql-connections/connect-tool-button";
import { SqlConnectionsCard } from "@/components/sql-connections/sql-connections-card";

/** The SQL page's "Connect a tool" button, inside workspace `shop`. */
export function ConnectToolHarness() {
  return (
    <NamespaceProvider slug="shop">
      <div className="p-4">
        <ConnectToolButton />
      </div>
    </NamespaceProvider>
  );
}

/** Settings → SQL connections, inside workspace `shop`. */
export function SqlConnectionsCardHarness() {
  return (
    <NamespaceProvider slug="shop">
      <div className="p-4">
        <SqlConnectionsCard />
      </div>
    </NamespaceProvider>
  );
}
