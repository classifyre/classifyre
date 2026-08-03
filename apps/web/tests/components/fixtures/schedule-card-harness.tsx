"use client";

import * as React from "react";
import {
  ScheduleCard,
  defaultScheduleValue,
  type ScheduleValue,
} from "@/components/schedule-card";

/**
 * Drives the card the way the new-source page does: local state, and the same
 * Automatic default a brand-new source starts from.
 */
export function ScheduleCardHarness({
  initial = defaultScheduleValue({ mode: "AUTO" }),
}: {
  initial?: ScheduleValue;
}) {
  const [value, setValue] = React.useState<ScheduleValue>(initial);

  return <ScheduleCard value={value} onChange={setValue} />;
}
