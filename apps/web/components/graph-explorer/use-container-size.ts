"use client";

import * as React from "react";

/**
 * ResizeObserver-backed size of a container element, ignoring sub-pixel
 * jitter. Shared by every graph view so the force layout re-centers on
 * real size changes only.
 */
export function useContainerSize(
  ref: React.RefObject<HTMLElement | null>,
  initial = { width: 900, height: 600 },
): { width: number; height: number } {
  const [size, setSize] = React.useState(initial);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize((prev) =>
          Math.abs(prev.width - rect.width) > 1 || Math.abs(prev.height - rect.height) > 1
            ? { width: rect.width, height: rect.height }
            : prev,
        );
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref]);

  return size;
}
