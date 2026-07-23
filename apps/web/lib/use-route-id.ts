"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { DYNAMIC_ID_SENTINEL } from "./dynamic-route";

// Route roots that are immediately followed by a dynamic `[id]` segment in the
// URL (e.g. /sources/<id>, /investigations/inquiries/<id>). Used only on a
// static-export hard load to recover the real id from the browser URL, where
// Next's router only knows the baked placeholder. Add a new entry here when
// introducing a new /<root>/[id] route.
const ID_PARENTS = new Set([
  "sources",
  "scans",
  "assets",
  "detectors",
  "findings",
  "investigations",
  "inquiries",
]);

function idFromLocationPath(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  // The id is the segment following the deepest matching route root, so that
  // /investigations/inquiries/<id> resolves against `inquiries`, not
  // `investigations`.
  let idIndex = -1;
  segments.forEach((segment, i) => {
    if (ID_PARENTS.has(segment) && i + 1 < segments.length) idIndex = i + 1;
  });
  return idIndex >= 0 ? decodeURIComponent(segments[idIndex]!) : "";
}

/**
 * Returns the `[id]` route param, correct for a normal Next runtime, normal
 * client-side navigation, AND the desktop static export.
 *
 * In the desktop static export each dynamic route ships a single placeholder
 * shell at the DYNAMIC_ID_SENTINEL segment (see dynamic-route.ts). Next's router
 * therefore reports the baked sentinel rather than the real id. Reading the real
 * id from the URL during the first render would make the client output differ
 * from the prerendered shell and trip a hydration mismatch (React #418), so we
 * defer to `useEffect`: the first render returns "" (matching the shell, which
 * renders its id-dependent content only once an id is present), and the real id
 * is resolved from the browser URL after mount. Pages already guard their data
 * fetches on a truthy id, so this simply shows their loading state for one frame.
 */
export function useRouteId(): string {
  const params = useParams();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const raw = params?.["id"];
  const fromParams = Array.isArray(raw) ? raw[0] : raw;

  // Normal runtime / client navigation: useParams already holds the real id.
  if (fromParams && fromParams !== DYNAMIC_ID_SENTINEL) return fromParams;

  // Static-export placeholder shell. Keep the first (hydrating) render id-free to
  // match the server shell, then resolve the real id from the URL after mount.
  if (!mounted || typeof window === "undefined") return "";
  return idFromLocationPath(window.location.pathname);
}

/** Recover a named static-export route param found after a known parent. */
export function useStaticRouteParam(
  paramName: string,
  parentSegment: string,
): string {
  const params = useParams();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const raw = params?.[paramName];
  const fromParams = Array.isArray(raw) ? raw[0] : raw;
  if (fromParams && fromParams !== DYNAMIC_ID_SENTINEL) return fromParams;
  if (!mounted || typeof window === "undefined") return "";

  const segments = window.location.pathname.split("/").filter(Boolean);
  const parentIndex = segments.lastIndexOf(parentSegment);
  return parentIndex >= 0 && parentIndex + 1 < segments.length
    ? decodeURIComponent(segments[parentIndex + 1]!)
    : "";
}
