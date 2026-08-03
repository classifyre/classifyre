"use client";

import * as React from "react";
import { isDesktopShell } from "@/lib/desktop";
import { useNsPath } from "@/lib/ns-path";

/** Anchor props for a namespace-scoped detail link. */
export interface DetailLinkProps {
  href: string;
  target?: "_blank";
  rel?: "noreferrer";
}

/**
 * Build anchor props for drilling into a detail page (source, document,
 * finding) from an exploratory view like the fingerprints graph.
 *
 * On the web the operator keeps their place in the graph and the detail opens
 * in a new tab. Inside the desktop shell there are no browser tabs, so the
 * same click navigates in place.
 *
 * `isDesktopShell()` reads a `window` global, which is unavailable while the
 * page is statically rendered. The runtime is therefore resolved after mount:
 * the first paint matches the server output (new tab) and the desktop shell
 * corrects it on hydration, so React never sees an attribute mismatch.
 */
export function useDetailLink(): (path: string) => DetailLinkProps {
  const nsPath = useNsPath();
  const [inDesktopShell, setInDesktopShell] = React.useState(false);

  React.useEffect(() => setInDesktopShell(isDesktopShell()), []);

  return React.useCallback(
    (path: string): DetailLinkProps =>
      inDesktopShell
        ? { href: nsPath(path) }
        : { href: nsPath(path), target: "_blank", rel: "noreferrer" },
    [nsPath, inDesktopShell],
  );
}
