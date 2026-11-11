import * as React from "react";
import { NamespaceProvider } from "@/components/namespace-provider";
import {
  DataAccessTabs,
  GiveDataAccessDialog,
  useDataAccessGrants,
  type DataScope,
} from "@/components/data-query/data-access";

function ScopedAccess({ scope }: { scope: DataScope }) {
  const access = useDataAccessGrants(scope);
  return (
    <div className="space-y-3 p-4">
      <GiveDataAccessDialog scope={scope} access={access} />
      <DataAccessTabs scope={scope} access={access} />
    </div>
  );
}

/** The Data tabs' access block for one scope, inside workspace `shop`. */
export function DataAccessHarness({ scope }: { scope: DataScope }) {
  return (
    <NamespaceProvider slug="shop">
      <ScopedAccess scope={scope} />
    </NamespaceProvider>
  );
}
