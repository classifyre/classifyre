import { NamespaceProvider } from "@/components/namespace-provider";

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
