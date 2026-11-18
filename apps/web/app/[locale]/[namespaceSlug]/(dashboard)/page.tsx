"use client";

import { NamespaceRedirect } from "@/components/namespace-redirect";

/** A workspace opens on its dashboard. */
export default function HomePage() {
  return <NamespaceRedirect to="/dashboard" />;
}
