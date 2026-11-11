import * as React from "react";
import { NamespaceProvider } from "@/components/namespace-provider";
import {
  DataAccessSection,
  GiveDataAccessButton,
  useDataAccessGrants,
  type DataScope,
} from "@/components/data-query/data-access";

function ScopedAccess({ scope }: { scope: DataScope }) {
  const access = useDataAccessGrants(scope);
  return (
    <div className="space-y-3 p-4">
      <GiveDataAccessButton scope={scope} access={access} />
      <DataAccessSection scope={scope} access={access} />
    </div>
  );
}

/** A Data tab's access block for one source or table, inside workspace `shop`. */
export function DataAccessHarness({ scope }: { scope: DataScope }) {
  return (
    <NamespaceProvider slug="shop">
      <ScopedAccess scope={scope} />
    </NamespaceProvider>
  );
}
