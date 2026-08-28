"use client";

import * as React from "react";
import { DuplicatesShell } from "@/components/review/duplicates-shell";
import { DecisionsTable } from "@/components/review/decisions-table";

/**
 * The other half of the queue: what was judged, and what became of it.
 *
 * Judging a pair and watching it vanish makes the judgement worthless five
 * minutes later. This is where decisions live afterwards — filterable,
 * reversible, and actionable in bulk.
 */
export default function DecisionsPage() {
  return (
    <DuplicatesShell active="decisions" bare>
      {({ refresh }) => <DecisionsTable onChanged={refresh} />}
    </DuplicatesShell>
  );
}
