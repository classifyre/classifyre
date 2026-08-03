"use client";

import * as React from "react";
import type { GraphNodeDto } from "@workspace/api-client";
import { ClusterDetailPanel } from "@/components/graph-explorer/cluster-panels";
import type { ClusterMeta } from "@/components/graph-explorer/use-clustered-graph";

/**
 * Test harness for {@link ClusterDetailPanel}.
 *
 * The panel resolves members through a `nodeByKey` lookup function, and
 * Playwright component tests cannot return values across the function-prop
 * bridge. This wrapper takes the members as plain data and builds the lookup
 * inside the browser, so the panel sees exactly what it does in the app.
 */
export function ClusterDetailHarness({
  meta,
  members,
}: {
  meta: ClusterMeta;
  /** Cluster members keyed the same way `meta.memberKeys` addresses them. */
  members: Array<{ key: string; node: GraphNodeDto }>;
}) {
  const byKey = React.useMemo(
    () => new Map(members.map((m) => [m.key, m.node])),
    [members],
  );

  return (
    <ClusterDetailPanel
      meta={meta}
      clusters={new Map([[meta.id, meta]])}
      renderEdges={[]}
      nodeByKey={(key) => byKey.get(key)}
      onFocusCluster={() => {}}
    />
  );
}
