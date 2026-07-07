"use client";

import { useParams, usePathname } from "next/navigation";
import { DYNAMIC_ID_SENTINEL } from "./dynamic-route";

/**
 * Returns the `[id]` route param, correct for BOTH normal client navigation and
 * static-export hard loads / reloads (the desktop build).
 *
 * In the desktop static export, dynamic routes are emitted as a single
 * placeholder shell at the DYNAMIC_ID_SENTINEL segment (see dynamic-route.ts),
 * and the Electron protocol handler serves that shell for any real id. On such a
 * hard load Next's router reports the baked sentinel instead of the real id, so
 * we recover the real value from the browser URL by locating the sentinel's
 * position in the (baked) pathname template. On a normal client navigation
 * useParams already holds the real id and we return it directly.
 */
export function useRouteId(): string {
  const params = useParams();
  const pathname = usePathname();

  const raw = params?.["id"];
  const id = Array.isArray(raw) ? raw[0] : raw;

  // Normal client navigation: useParams already holds the real id.
  if (id && id !== DYNAMIC_ID_SENTINEL) return id;

  // Static-export hard load: the served shell baked the sentinel. Recover the
  // real id from the browser URL using the sentinel's position in the baked
  // pathname template.
  if (typeof window !== "undefined") {
    const template = (pathname ?? "").split("/").filter(Boolean);
    const actual = window.location.pathname.split("/").filter(Boolean);
    const i = template.indexOf(DYNAMIC_ID_SENTINEL);
    if (i >= 0 && i < actual.length) return decodeURIComponent(actual[i]!);
  }

  // Sentinel state we can't resolve yet (the first hydration render, before the
  // router reconciles the baked pathname). Return "" rather than the sentinel so
  // id-guarded effects (`if (id) …`) don't fire a request against the
  // placeholder; the next render resolves to the real id.
  return id === DYNAMIC_ID_SENTINEL ? "" : (id ?? "");
}
