"use client";

import { useEffect, useState } from "react";
import { api } from "@workspace/api-client";

/**
 * Custom detector key → the name the user gave it.
 *
 * Runner-asset rollups record a custom detector as `CUSTOM:<key>`, because the
 * key is the only stable identity the CLI has at scan time — the title can be
 * renamed afterwards and old rows must not go stale. Resolving it here means the
 * table shows what the detector is called *now*.
 *
 * Fetched once per mount and shared through the returned resolver. A miss
 * returns the key itself, which is still far more useful than "CUSTOM".
 */
export function useCustomDetectorNames() {
  const [names, setNames] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const detectors = await api.listCustomDetectors({
          includeInactive: true,
        });
        if (!active) return;
        setNames(new Map((detectors ?? []).map((d) => [d.key, d.name])));
      } catch (error) {
        // A missing title is cosmetic; the key still identifies the detector.
        console.error("Failed to load custom detector names:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (key: string) => names.get(key) ?? key;
}
