"use client";

import { useCallback, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Stable hook for reading and updating URL search params without triggering
 * a full navigation. Uses refs internally so `setParams` never changes
 * identity — safe in effect dependency arrays without causing extra renders.
 *
 * Usage:
 *   const { searchParams, setParams } = useUrlParams()
 *   // read
 *   const q = searchParams.get("q")
 *   const statuses = searchParams.getAll("status")
 *   // write (merges with current params, preserves others)
 *   setParams({ q: "foo", status: ["OPEN", "RESOLVED"], severity: null })
 */
export function useUrlParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Mutable ref holds the latest values so `setParams` can be stable ([] deps).
  const latest = useRef({ router, pathname, searchParams });
  latest.current = { router, pathname, searchParams };

  /**
   * Merge `updates` into the current search params and replace the history entry.
   * - `null` | `undefined`  → delete the key
   * - `string`              → set a single value
   * - `string[]`            → set multiple values (repeated keys: ?k=a&k=b)
   * - `[]` (empty array)    → delete the key
   */
  const setParams = useCallback(
    (updates: Record<string, string | string[] | null | undefined>) => {
      const { router, pathname, searchParams } = latest.current;
      const params = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(updates)) {
        params.delete(key);
        if (Array.isArray(value)) {
          for (const v of value) params.append(key, v);
        } else if (value != null && value !== "") {
          params.set(key, value);
        }
      }

      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [], // intentionally empty — uses `latest` ref
  );

  return { searchParams, setParams };
}
