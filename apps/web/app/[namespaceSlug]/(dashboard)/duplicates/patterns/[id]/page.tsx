"use client";

import * as React from "react";
import { useRouteId } from "@/lib/use-route-id";
import { DuplicatesShell } from "@/components/review/duplicates-shell";
import { PatternLevel } from "@/components/review/pattern-level";

/** One failure signature: the rule it suggests, its clusters, and its pairs. */
export default function PatternPage() {
  const patternKey = useRouteId();
  return (
    <DuplicatesShell active="queue" patternKey={patternKey} bare>
      {({ pattern, ...ctx }) =>
        pattern ? <PatternLevel pattern={pattern} {...ctx} /> : null
      }
    </DuplicatesShell>
  );
}
