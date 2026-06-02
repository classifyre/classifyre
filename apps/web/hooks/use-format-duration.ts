import { useCallback } from "react";
import { breakdownDuration } from "@/lib/duration";
import { useTranslation } from "@/hooks/use-translation";

/**
 * Returns a compact, translated duration formatter (e.g. "3h 15m 10s").
 * Leading zero units are dropped ("15m 10s", "45s"); sub-second durations
 * round up to "0s" so a real run never renders as empty.
 */
export function useFormatDuration(): (ms?: number | null) => string {
  const { t } = useTranslation();

  return useCallback(
    (ms?: number | null) => {
      const parts = breakdownDuration(ms);
      if (!parts) return t("common.duration.empty");

      const segments: string[] = [];
      if (parts.hours > 0) {
        segments.push(t("common.duration.hours", { count: parts.hours }));
      }
      if (parts.minutes > 0 || parts.hours > 0) {
        segments.push(t("common.duration.minutes", { count: parts.minutes }));
      }
      segments.push(t("common.duration.seconds", { count: parts.seconds }));

      return segments.join(" ");
    },
    [t],
  );
}
