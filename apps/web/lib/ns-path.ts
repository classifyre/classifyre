import { getActiveNamespaceSlug } from "@workspace/api-client";

/**
 * Prefix an absolute app path with the active namespace slug for client-side
 * navigation (router.push / Link href), so links stay inside the current
 * workspace. Reads the slug from the api-client module state, which the
 * NamespaceProvider keeps in sync with the route.
 *
 * No-ops when there is no active namespace, when the path is not absolute, or
 * when it is already namespace-prefixed.
 */
export function nsPath(path: string): string {
  const slug = getActiveNamespaceSlug();
  if (!slug || !path.startsWith("/")) return path;
  if (path === `/${slug}` || path.startsWith(`/${slug}/`)) return path;
  return `/${slug}${path === "/" ? "" : path}`;
}
