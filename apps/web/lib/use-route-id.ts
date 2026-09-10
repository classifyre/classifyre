"use client";

import { useParams } from "next/navigation";

/** `decodeURIComponent` throws on a malformed sequence; an id is not worth a crash. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readParam(
  params: ReturnType<typeof useParams>,
  name: string,
): string {
  const raw = params?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ? safeDecode(value) : "";
}

/**
 * The `[id]` route param.
 *
 * Decoded, because an id is not always a uuid — a duplicate-pattern key can
 * carry reserved characters, and the encoded form is not what any caller wants
 * to hand to the API.
 */
export function useRouteId(): string {
  return readParam(useParams(), "id");
}

/**
 * A named route param, for the routes whose segment is not called `id`
 * (`[namespaceId]`, `[categoryId]`).
 *
 * `parentSegment` is vestigial: it named the segment the id followed, which is
 * how the value used to be recovered from `window.location` under a static
 * export, where the router only ever reported a baked placeholder. On a
 * server-rendered route the router has the real value and there is nothing to
 * recover. Kept so the two call sites stay readable at a glance.
 */
export function useStaticRouteParam(
  paramName: string,
  _parentSegment?: string,
): string {
  return readParam(useParams(), paramName);
}
