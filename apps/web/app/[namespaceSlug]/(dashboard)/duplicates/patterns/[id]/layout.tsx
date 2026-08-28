import type { Metadata } from "next";
import { dynamicIdParams } from "@/lib/dynamic-route";

export const metadata: Metadata = {
  title: "Pattern",
  description: "Clusters and pairs that matched for the same reason.",
};

// Static export: one placeholder shell for this dynamic segment. The page reads
// the real pattern key from the URL at runtime via `useRouteId`.
export function generateStaticParams() {
  return dynamicIdParams();
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
