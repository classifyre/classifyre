"use client";

import * as React from "react";
import { DuplicatesExplore } from "@/components/review/duplicates-explore";
import { DuplicatesShell } from "@/components/review/duplicates-shell";

/** Every duplicate, or the ones a filter picks, on the Explore canvas. */
export default function DuplicatesExplorePage() {
  return (
    <DuplicatesShell active="explore" bare>
      {(ctx) => (
        <React.Suspense>
          <DuplicatesExplore portfolio={ctx.portfolio} />
        </React.Suspense>
      )}
    </DuplicatesShell>
  );
}
