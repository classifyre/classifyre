"use client";

import * as React from "react";
import { DuplicatesShell } from "@/components/review/duplicates-shell";
import { PortfolioLevel } from "@/components/review/portfolio-level";

/**
 * Duplicate review.
 *
 * This replaced a force-directed canvas of the whole correlation graph. A
 * canvas is a destination, not a step in a task: it has no completion state,
 * so someone working a backlog could never tell how much was left — and it was
 * slow for the same reason, fetching tens of thousands of nodes because a
 * canvas has no notion of what matters.
 */
export default function DuplicatesPage() {
  return <DuplicatesShell active="queue">{(ctx) => <PortfolioLevel {...ctx} />}</DuplicatesShell>;
}
