"use client";

import * as React from "react";
import { CorrelationTuningPanel } from "@/components/correlation-tuning-panel";
import { SemanticIndexControls } from "@/components/semantic-index-controls";
import { DuplicateIndexControls } from "@/components/review/duplicate-index-controls";
import { DuplicatesShell } from "@/components/review/duplicates-shell";

/** Weights, thresholds, and the health of both indexes that feed the queue. */
export default function TunePage() {
  return (
    <DuplicatesShell active="tune" bare>
      {() => (
        <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <CorrelationTuningPanel layout="page" />
          {/* Both engines' health side by side: weights decide what matches,
              embeddings decide what reads as near-duplicate text. Tuning one
              without seeing the other is how the two drift apart. */}
          <div className="space-y-4">
            <DuplicateIndexControls />
            <SemanticIndexControls />
          </div>
        </div>
      )}
    </DuplicatesShell>
  );
}
