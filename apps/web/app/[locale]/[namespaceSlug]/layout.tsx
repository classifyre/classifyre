import { NamespaceProvider } from "@/components/namespace-provider";

// The desktop build is a static export. Emit one placeholder shell and let the
// app:// protocol handler map real runtime slugs onto it, just like entity-id
// routes do for sources/findings/scans.
export function generateStaticParams() {
  return [{ namespaceSlug: "__id__" }];
}

/**
 * Wraps the whole dashboard subtree in the namespace context, making the
 * `[namespaceSlug]` route segment the active tenant for all API calls.
 */
export default async function NamespaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ namespaceSlug: string }>;
}) {
  const { namespaceSlug } = await params;
  return <NamespaceProvider slug={namespaceSlug}>{children}</NamespaceProvider>;
}
