"use client";

import dynamic from "next/dynamic";
import type { VisualSchemaSceneName } from "./visual-schema-demo-inner";

const VisualSchemaDemoInner = dynamic(
  () => import("./visual-schema-demo-inner").then((m) => m.VisualSchemaDemoInner),
  {
    ssr: false,
    loading: () => <div className="h-[460px] w-full animate-pulse rounded-[4px] border border-border bg-muted/40" />,
  },
);

/**
 * Interactive mocked Visual Schema canvas embedded directly in docs pages.
 * Readers can drag cards, tick columns, run Find Links, cycle join types,
 * draw new column-to-column joins, and inspect live DuckDB SQL & DBML.
 */
export function VisualSchemaDemo({
  scene = "overview",
  height = 460,
  caption,
}: {
  scene?: VisualSchemaSceneName;
  height?: number;
  caption?: string;
}) {
  return (
    <figure className="my-6">
      <VisualSchemaDemoInner scene={scene} height={height} />
      {caption && (
        <figcaption className="mt-2 text-sm text-muted-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
