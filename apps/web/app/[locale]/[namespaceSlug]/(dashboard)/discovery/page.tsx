"use client";

import { NamespaceRedirect } from "@/components/namespace-redirect";

/**
 * The old Overview. The dashboard took its place as the starting page; links
 * and bookmarks to /discovery land there instead.
 */
export default function DiscoveryRedirect() {
  return <NamespaceRedirect to="/dashboard" />;
}
